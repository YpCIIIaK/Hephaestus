import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { DATA_DIR } from './paths'
import { readJson, writeJson } from './json-file'
import { getProjectDir } from './settings'
import { SKIP_DIRS, withFileLock } from './workspace'

// Копии проекта для параллельных правок. Каждый участник работает в своей
// копии, поэтому модели не затирают правки друг друга и не ломают друг другу
// тесты. Потом пользователь сравнивает изменения (diff) и применяет лучшие.
//
// Копируется рабочее дерево вместе с незакоммиченными правками: в git-проекте
// — то, что не скрыто .gitignore, иначе всё, кроме сборок и зависимостей.
// Тяжёлые папки зависимостей не копируются, а подключаются ссылкой, чтобы
// тесты и сборка работали. Хэши исходных файлов запоминаются: так строится
// diff и видно, если оригинал за это время изменился.

const ROOT = path.join(DATA_DIR, 'sandboxes')
const MAX_FILES = 20_000
const MAX_BYTES = 300 * 1024 * 1024
const MAX_DIFF_CHARS = 400_000
const KEEP_DAYS = 7
/** Папки зависимостей подключаются ссылкой, а не копируются */
const LINKED_DIRS = ['node_modules', '.venv', 'venv']

export class SandboxError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

interface Meta {
  id: string
  label: string
  project: string
  createdAt: number
  /** Хэши файлов на момент копирования (или последнего применения) */
  baseline: Record<string, string>
}

export interface SandboxFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
}

export interface SandboxDiff {
  id: string
  label: string
  files: SandboxFileChange[]
  patch: string
  truncated: boolean
}

const ID_RE = /^sb_[a-z0-9]+$/

const sha1 = (buf: Buffer | string) => crypto.createHash('sha1').update(buf).digest('hex')
const toPosix = (p: string) => p.split(path.sep).join('/')

function dirOf(id: string): string {
  if (!ID_RE.test(id)) throw new SandboxError('Некорректный id копии')
  return path.join(ROOT, id)
}

export async function sandboxTree(id: string): Promise<string> {
  const tree = path.join(dirOf(id), 'tree')
  const st = await fs.stat(/* turbopackIgnore: true */ tree).catch(() => null)
  if (!st?.isDirectory()) throw new SandboxError('Копия проекта не найдена — возможно, её уже удалили', 404)
  return tree
}

async function loadMeta(id: string): Promise<Meta> {
  const meta = await readJson<Meta | null>(path.join(dirOf(id), 'meta.json'), null)
  if (!meta) throw new SandboxError('Копия проекта не найдена — возможно, её уже удалили', 404)
  return meta
}

/** Файлы проекта: в git — отслеживаемые и новые неигнорируемые, иначе обход папки */
export async function projectFiles(root: string): Promise<string[]> {
  const git = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (git.status === 0 && git.stdout) {
    const files = git.stdout.split('\0').filter(Boolean)
    // git ls-files перечисляет и удалённые, но не закоммиченные файлы — оставляем существующие
    const exists = await Promise.all(files.map((f) => fs.stat(/* turbopackIgnore: true */ path.join(root, f)).then((s) => s.isFile(), () => false)))
    return files.filter((f, i) => exists[i] && !f.split('/').some((part) => LINKED_DIRS.includes(part)))
  }
  const out: string[] = []
  async function walk(dir: string) {
    for (const e of await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length > MAX_FILES) return
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && e.name !== '.git' && !LINKED_DIRS.includes(e.name)) await walk(abs)
      } else if (e.isFile()) out.push(toPosix(path.relative(root, abs)))
    }
  }
  await walk(root)
  return out
}

async function hashFiles(root: string, files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (let i = 0; i < files.length; i += 64) {
    await Promise.all(
      files.slice(i, i + 64).map(async (f) => {
        const buf = await fs.readFile(/* turbopackIgnore: true */ path.join(root, f)).catch(() => null)
        if (buf) out[f] = sha1(buf)
      }),
    )
  }
  return out
}

/** Удаляет копии старше недели — они остаются, если пользователь забыл их убрать */
async function collectGarbage() {
  const entries = await fs.readdir(/* turbopackIgnore: true */ ROOT).catch(() => [] as string[])
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  await Promise.all(
    entries.filter((e) => ID_RE.test(e)).map(async (id) => {
      const meta = await readJson<Meta | null>(path.join(ROOT, id, 'meta.json'), null)
      if (!meta || meta.createdAt < cutoff) await fs.rm(/* turbopackIgnore: true */ path.join(ROOT, id), { recursive: true, force: true })
    }),
  )
}

export async function createSandbox(label: string): Promise<{ id: string; files: number }> {
  void collectGarbage().catch(() => {})
  const project = await getProjectDir()
  await fs.mkdir(/* turbopackIgnore: true */ project, { recursive: true })
  const files = await projectFiles(project)
  if (files.length > MAX_FILES) throw new SandboxError(`В проекте больше ${MAX_FILES} файлов — копия для каждой модели была бы слишком тяжёлой`)
  let bytes = 0
  for (const f of files) bytes += (await fs.stat(/* turbopackIgnore: true */ path.join(project, f)).catch(() => ({ size: 0 }))).size
  if (bytes > MAX_BYTES) throw new SandboxError(`Проект занимает больше ${MAX_BYTES >> 20} МБ без зависимостей — копия для каждой модели была бы слишком тяжёлой`)

  const id = `sb_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  const tree = path.join(dirOf(id), 'tree')
  await fs.mkdir(/* turbopackIgnore: true */ tree, { recursive: true })
  for (let i = 0; i < files.length; i += 64) {
    await Promise.all(
      files.slice(i, i + 64).map(async (f) => {
        const dst = path.join(tree, f)
        await fs.mkdir(/* turbopackIgnore: true */ path.dirname(dst), { recursive: true })
        await fs.copyFile(/* turbopackIgnore: true */ path.join(project, f), dst)
      }),
    )
  }
  for (const d of LINKED_DIRS) {
    const src = path.join(project, d)
    if (await fs.stat(/* turbopackIgnore: true */ src).then((s) => s.isDirectory(), () => false)) {
      await fs.symlink(src, path.join(tree, d), process.platform === 'win32' ? 'junction' : 'dir').catch(() => {})
    }
  }
  const meta: Meta = { id, label, project, createdAt: Date.now(), baseline: await hashFiles(project, files) }
  await writeJson(path.join(dirOf(id), 'meta.json'), meta)
  return { id, files: files.length }
}

/**
 * Файлы копии без подключённых ссылкой зависимостей. В служебные папки
 * (dist, build, target…) заходим, только если там были исходные файлы:
 * иначе это артефакты сборки, которую модель запускала в копии.
 */
async function treeFiles(tree: string, baseline: Record<string, string>): Promise<string[]> {
  const known = Object.keys(baseline)
  const out: string[] = []
  async function walk(dir: string) {
    for (const e of await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name)
      if (e.isSymbolicLink() || e.name === '.git') continue
      const rel = toPosix(path.relative(tree, abs))
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) || known.some((k) => k.startsWith(`${rel}/`))) await walk(abs)
      } else if (e.isFile()) out.push(rel)
    }
  }
  await walk(tree)
  return out
}

/** Новые файлы, которые проект игнорирует (.gitignore), — артефакты, а не правки */
function dropIgnored(project: string, files: string[]): string[] {
  if (!files.length) return files
  const res = spawnSync('git', ['-C', project, 'check-ignore', '--no-index', '-z', '--stdin'], { input: files.join('\0'), encoding: 'utf8', windowsHide: true })
  if (res.status !== 0 && res.status !== 1) return files // не git-проект
  const ignored = new Set(res.stdout.split('\0').filter(Boolean))
  return files.filter((f) => !ignored.has(f))
}

const isBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0)

async function changes(id: string) {
  const meta = await loadMeta(id)
  const tree = await sandboxTree(id)
  const files = await treeFiles(tree, meta.baseline)
  const added = new Set(dropIgnored(meta.project, files.filter((f) => !(f in meta.baseline))))
  const current = await hashFiles(tree, files.filter((f) => f in meta.baseline || added.has(f)))
  const paths = [...new Set([...Object.keys(meta.baseline), ...Object.keys(current)])].sort()
  const changed = paths.filter((p) => meta.baseline[p] !== current[p])
  return { meta, tree, current, changed }
}

export async function diffSandbox(id: string): Promise<SandboxDiff> {
  const { meta, tree, current, changed } = await changes(id)
  const files: SandboxFileChange[] = []
  let patch = ''
  let truncated = false
  for (const p of changed) {
    const status: SandboxFileChange['status'] = !meta.baseline[p] ? 'added' : !current[p] ? 'deleted' : 'modified'
    // Старая версия — из оригинала; если его успели поменять, diff покажет и это
    const before = status === 'added' ? Buffer.from('') : await fs.readFile(/* turbopackIgnore: true */ path.join(meta.project, p)).catch(() => Buffer.from(''))
    const after = status === 'deleted' ? Buffer.from('') : await fs.readFile(/* turbopackIgnore: true */ path.join(tree, p))
    if (isBinary(before) || isBinary(after)) {
      files.push({ path: p, status, additions: 0, deletions: 0 })
      patch += `Бинарный файл ${p}: ${status}\n`
      continue
    }
    const text = createTwoFilesPatch(status === 'added' ? '/dev/null' : `a/${p}`, status === 'deleted' ? '/dev/null' : `b/${p}`, before.toString('utf8'), after.toString('utf8'), '', '', { context: 3 })
    const body = text.split('\n').slice(2)
    files.push({
      path: p,
      status,
      additions: body.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
      deletions: body.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
    })
    if (patch.length + text.length > MAX_DIFF_CHARS) truncated = true
    else patch += text.replace(/^=+\n/m, '')
  }
  return { id, label: meta.label, files, patch, truncated }
}

export interface ApplyResult {
  applied: string[]
  /** Файлы, которые в проекте изменились с момента копирования — их не трогаем */
  conflicts: string[]
}

/** Переносит изменения копии в проект. Файлы, изменённые в проекте с тех пор, пропускаются */
export async function applySandbox(id: string, only?: string[]): Promise<ApplyResult> {
  const { meta, tree, current, changed } = await changes(id)
  const project = await getProjectDir()
  if (path.resolve(project) !== path.resolve(meta.project)) throw new SandboxError('Рабочая папка в настройках сменилась — эта копия относится к другому проекту', 409)
  const targets = only ? changed.filter((p) => only.includes(p)) : changed
  const applied: string[] = []
  const conflicts: string[] = []
  for (const p of targets) {
    const dst = path.join(project, p)
    await withFileLock(dst, async () => {
      const now = await fs.readFile(/* turbopackIgnore: true */ dst).then(sha1, () => undefined)
      if (now !== meta.baseline[p] && now !== current[p]) {
        conflicts.push(p)
        return
      }
      if (current[p]) {
        await fs.mkdir(/* turbopackIgnore: true */ path.dirname(dst), { recursive: true })
        await fs.copyFile(/* turbopackIgnore: true */ path.join(tree, p), dst)
      } else await fs.rm(/* turbopackIgnore: true */ dst, { force: true })
      applied.push(p)
    })
  }
  // Применённое становится новой точкой отсчёта: дальше diff покажет только новые правки
  for (const p of applied) {
    if (current[p]) meta.baseline[p] = current[p]
    else delete meta.baseline[p]
  }
  await writeJson(path.join(dirOf(id), 'meta.json'), meta)
  return { applied, conflicts }
}

export async function removeSandbox(id: string): Promise<void> {
  await fs.rm(/* turbopackIgnore: true */ dirOf(id), { recursive: true, force: true })
}
