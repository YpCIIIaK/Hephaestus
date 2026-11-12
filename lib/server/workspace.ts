import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceEntry } from '../types'
import { getWorkspaceDir } from './settings'

// Песочница для файловых инструментов ИИ: рабочая папка из настроек.
// Все пути относительные и не могут выйти за её пределы — ни через «..»,
// ни через символические ссылки.

const MAX_READ_BYTES = 2_000_000
const MAX_TREE_ENTRIES = 2000
export const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', '.venv', 'venv', 'dist', 'build', 'target', 'coverage', '.cache', '.turbo'])

export class WorkspaceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export async function ensureWorkspace(): Promise<string> {
  const root = await getWorkspaceDir()
  await fs.mkdir(/* turbopackIgnore: true */ root, { recursive: true })
  return root
}

// Несколько моделей могут работать с папкой одновременно: запись, правка и
// удаление одного файла выполняются по очереди, чтобы правки не терялись.
const locks = new Map<string, Promise<unknown>>()

export async function withFileLock<T>(abs: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(abs) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  locks.set(abs, tail)
  try {
    return await run
  } finally {
    if (locks.get(abs) === tail) locks.delete(abs)
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Превращает пользовательский путь в абсолютный внутри песочницы */
export async function resolveWorkspacePath(input: string): Promise<{ abs: string; rel: string; root: string }> {
  const raw = String(input ?? '').trim()
  if (raw.includes('\0')) throw new WorkspaceError('Недопустимый путь')
  const root = await ensureWorkspace()
  // Модели часто передают абсолютный путь из описания рабочей папки — внутри неё он допустим.
  // Иначе ведущий «/» означает корень проекта: «/src/app.ts» — это src/app.ts.
  const asAbsolute = path.resolve(raw || '.')
  const insideAsIs = (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) && isInside(root, asAbsolute)
  const cleaned = raw
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/^workspace\//, '')
  const abs = insideAsIs ? asAbsolute : path.resolve(root, cleaned || '.')
  if (!isInside(root, abs)) throw new WorkspaceError('Путь выходит за пределы рабочей папки', 403)

  // Проверяем реальный путь ближайшего существующего предка: ссылка внутри
  // песочницы не должна вести наружу.
  const realRoot = await fs.realpath(/* turbopackIgnore: true */ root)
  let probe = abs
  for (;;) {
    try {
      const real = await fs.realpath(/* turbopackIgnore: true */ probe)
      if (!isInside(realRoot, real)) throw new WorkspaceError('Путь выходит за пределы рабочей папки', 403)
      break
    } catch (e) {
      if (e instanceof WorkspaceError) throw e
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  return { abs, rel: path.relative(root, abs).split(path.sep).join('/'), root }
}

/** Дерево рабочей папки или её подпапки; depth ограничивает глубину */
export async function listTree(sub = '', depth = Infinity): Promise<WorkspaceEntry[]> {
  const { abs: start, root } = await resolveWorkspacePath(sub)
  let count = 0
  async function walk(dir: string, level: number): Promise<WorkspaceEntry[]> {
    const entries = await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true }).catch(() => {
      throw new WorkspaceError(`Папка не найдена: ${sub}`, 404)
    })
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    const out: WorkspaceEntry[] = []
    for (const e of entries) {
      if (count++ > MAX_TREE_ENTRIES) break
      if (e.name.startsWith('.') && e.name !== '.env.example') continue
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        out.push({ path: rel, name: e.name, type: 'dir', children: level < depth ? await walk(abs, level + 1) : undefined })
      } else if (e.isFile()) {
        const st = await fs.stat(/* turbopackIgnore: true */ abs)
        out.push({ path: rel, name: e.name, type: 'file', size: st.size })
      }
    }
    return out
  }
  return walk(start, 1)
}

export function flattenTree(tree: WorkspaceEntry[]): string[] {
  const out: string[] = []
  const visit = (items: WorkspaceEntry[]) => {
    for (const it of items) {
      if (it.type === 'file') out.push(it.path)
      else if (it.children) visit(it.children)
      else out.push(`${it.path}/`)
    }
  }
  visit(tree)
  return out
}

export async function readWorkspaceFile(
  p: string,
  range?: { startLine?: number; endLine?: number },
): Promise<{ path: string; content: string; totalLines: number }> {
  const { abs, rel } = await resolveWorkspacePath(p)
  let st
  try {
    st = await fs.stat(/* turbopackIgnore: true */ abs)
  } catch {
    throw new WorkspaceError(`Файл не найден: ${rel}`, 404)
  }
  if (!st.isFile()) throw new WorkspaceError(`Это не файл: ${rel}`)
  if (st.size > MAX_READ_BYTES) throw new WorkspaceError(`Файл слишком большой (${Math.round(st.size / 1024)} КБ)`)
  const content = await fs.readFile(/* turbopackIgnore: true */ abs, 'utf-8')
  const lines = content.split('\n')
  if (range?.startLine || range?.endLine) {
    const start = Math.max(1, range.startLine ?? 1)
    const end = Math.min(lines.length, range.endLine ?? lines.length)
    return { path: rel, content: lines.slice(start - 1, end).join('\n'), totalLines: lines.length }
  }
  return { path: rel, content, totalLines: lines.length }
}

export async function writeWorkspaceFile(p: string, content: string): Promise<{ path: string; bytes: number; created: boolean }> {
  const { abs, rel } = await resolveWorkspacePath(p)
  if (!rel || rel === '.') throw new WorkspaceError('Укажите имя файла')
  return withFileLock(abs, async () => {
    const existed = await fs
      .stat(/* turbopackIgnore: true */ abs)
      .then((s) => s.isFile())
      .catch(() => false)
    await fs.mkdir(/* turbopackIgnore: true */ path.dirname(abs), { recursive: true })
    await fs.writeFile(/* turbopackIgnore: true */ abs, content, 'utf-8')
    return { path: rel, bytes: Buffer.byteLength(content, 'utf-8'), created: !existed }
  })
}

/** Номера строк в стиле read_file («  12│ »), которые модель могла скопировать во фрагмент */
const LINE_NUMBER_PREFIX = /^ *\d+│ ?/gm

/**
 * Замена фрагмента: oldText должен встречаться в файле ровно один раз (или
 * все вхождения при replaceAll). Чтение, замена и запись идут под одной
 * блокировкой, чтобы параллельные правки разных моделей не затирали друг друга.
 */
export async function editWorkspaceFile(
  p: string,
  oldText: string,
  newText: string,
  opts: { replaceAll?: boolean } = {},
): Promise<{ path: string; replacements: number }> {
  if (!oldText) throw new WorkspaceError('Пустой фрагмент для замены')
  const { abs, rel } = await resolveWorkspacePath(p)
  return withFileLock(abs, async () => {
    const { content } = await readWorkspaceFile(rel)
    // Модели иногда копируют фрагмент вместе с номерами строк или с другими переводами строк
    const crlf = content.includes('\r\n')
    const candidates = [oldText, oldText.replace(LINE_NUMBER_PREFIX, '')].flatMap((t) => [t, crlf ? t.replace(/\r?\n/g, '\r\n') : t.replace(/\r\n/g, '\n')])
    const needle = candidates.find((t) => t && content.includes(t))
    if (!needle) throw new WorkspaceError('Фрагмент для замены не найден в файле — перечитайте файл и скопируйте фрагмент точно')
    const replacement = needle === oldText ? newText : newText.replace(LINE_NUMBER_PREFIX, '')
    const count = content.split(needle).length - 1
    if (count > 1 && !opts.replaceAll) {
      throw new WorkspaceError(`Фрагмент встречается ${count} раз — добавьте больше контекста или укажите replace_all`)
    }
    const next = opts.replaceAll ? content.split(needle).join(replacement) : content.replace(needle, () => replacement)
    await fs.writeFile(/* turbopackIgnore: true */ abs, next, 'utf-8')
    return { path: rel, replacements: opts.replaceAll ? count : 1 }
  })
}

export async function deleteWorkspacePath(p: string): Promise<{ path: string }> {
  const { abs, rel } = await resolveWorkspacePath(p)
  if (!rel || rel === '.') throw new WorkspaceError('Нельзя удалить корень рабочей папки', 403)
  return withFileLock(abs, async () => {
    await fs.rm(/* turbopackIgnore: true */ abs, { recursive: true, force: false }).catch(() => {
      throw new WorkspaceError(`Не найдено: ${rel}`, 404)
    })
    return { path: rel }
  })
}

export async function moveWorkspacePath(from: string, to: string): Promise<{ from: string; to: string }> {
  const src = await resolveWorkspacePath(from)
  const dst = await resolveWorkspacePath(to)
  if (!src.rel || src.rel === '.') throw new WorkspaceError('Нельзя переместить корень рабочей папки', 403)
  const exists = await fs.stat(/* turbopackIgnore: true */ src.abs).catch(() => null)
  if (!exists) throw new WorkspaceError(`Не найдено: ${src.rel}`, 404)
  if (await fs.stat(/* turbopackIgnore: true */ dst.abs).catch(() => null)) throw new WorkspaceError(`Уже существует: ${dst.rel}`, 409)
  return withFileLock(src.abs, () =>
    withFileLock(dst.abs, async () => {
      await fs.mkdir(/* turbopackIgnore: true */ path.dirname(dst.abs), { recursive: true })
      await fs.rename(/* turbopackIgnore: true */ src.abs, dst.abs)
      return { from: src.rel, to: dst.rel }
    }),
  )
}

/** Текст с номерами строк — так модели проще ссылаться на места в файле */
export function numberLines(content: string, firstLine = 1): string {
  const lines = content.split('\n')
  const width = String(firstLine + lines.length - 1).length
  return lines.map((l, i) => `${String(firstLine + i).padStart(width)}│ ${l}`).join('\n')
}
