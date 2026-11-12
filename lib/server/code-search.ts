import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { BM25, chunkText, tokenize } from '../text'
import { resolveWorkspacePath, SKIP_DIRS } from './workspace'

// Поиск по коду в рабочей папке — три инструмента, как у агентов-программистов:
//  • search_code — точный поиск по регулярному выражению (ripgrep, если установлен);
//  • find_files — файлы по маске;
//  • codebase_search — поиск по смыслу запроса: BM25 по фрагментам кода, где
//    идентификаторы разобраны на слова (getUserById → get user by id).
//    Индекс живёт в памяти и обновляется только по изменённым файлам.
// Векторные эмбеддинги здесь не нужны: на коде лексический поиск по
// идентификаторам плюс grep работают быстро, бесплатно и без отдельной модели.

const MAX_FILE_BYTES = 1_000_000
const MAX_FILES = 20_000
const MAX_INDEX_FILES = 5_000
const GREP_TIMEOUT_MS = 20_000

const BINARY_EXT = new Set(
  'png jpg jpeg gif webp ico bmp tiff pdf zip gz tgz bz2 xz 7z rar jar war class exe dll so dylib o a bin wasm mp3 mp4 mov avi mkv wav flac ogg woff woff2 ttf otf eot sqlite db lock'.split(' '),
)

const isBinaryName = (name: string) => BINARY_EXT.has(name.split('.').pop()?.toLowerCase() ?? '')

// ─── Маски файлов ────────────────────────────────────────────────────────

/** Маска в стиле gitignore: *, **, ?, {a,b}. Без «/» сравнивается с именем файла */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) re += '\\{'
      else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(',')
          .map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
          .join('|')})`
        i = end
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

export function matchGlob(glob: string, rel: string): boolean {
  const re = globToRegExp(glob.replace(/^\.\//, ''))
  return glob.includes('/') ? re.test(rel) : re.test(rel.split('/').pop() ?? rel)
}

// ─── Обход файлов ────────────────────────────────────────────────────────

/** Все текстовые файлы рабочей папки (без node_modules, .git, сборок и скрытых папок) */
export async function walkFiles(sub = ''): Promise<{ root: string; files: string[]; prefix: string }> {
  const { abs: start, root, prefix } = await resolveWorkspacePath(sub)
  const files: string[] = []
  async function walk(dir: string) {
    if (files.length >= MAX_FILES) return
    const entries = await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (e) => {
        if (e.name.startsWith('.') && e.name !== '.github') return
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(abs)
        } else if (e.isFile() && !isBinaryName(e.name) && files.length < MAX_FILES) {
          files.push(path.relative(root, abs).split(path.sep).join('/'))
        }
      }),
    )
  }
  const st = await fs.stat(/* turbopackIgnore: true */ start).catch(() => null)
  if (st?.isFile()) files.push(path.relative(root, start).split(path.sep).join('/'))
  else await walk(start)
  return { root, files: files.sort(), prefix }
}

export async function findFiles(glob: string, sub = '', limit = 200): Promise<string[]> {
  const { files, prefix } = await walkFiles(sub)
  const found = glob.trim() ? files.filter((f) => matchGlob(glob.trim(), f)) : files
  return found.slice(0, limit).map((f) => prefix + f)
}

// ─── Точный поиск ────────────────────────────────────────────────────────

export interface GrepHit {
  path: string
  line: number
  text: string
}

export interface GrepOptions {
  /** Искать как обычный текст, а не регулярное выражение */
  literal?: boolean
  ignoreCase?: boolean
  /** Маска файлов, например *.ts или src/**\/*.py */
  glob?: string
  /** Подпапка или файл, где искать */
  path?: string
  maxResults?: number
  signal?: AbortSignal
  /** Движок поиска; по умолчанию ripgrep, если установлен */
  engine?: 'rg' | 'node'
}

let rgAvailable: boolean | null = null

export function hasRipgrep(): boolean {
  if (rgAvailable == null) {
    try {
      rgAvailable = spawnSync('rg', ['--version'], { timeout: 3000, windowsHide: true }).status === 0
    } catch {
      rgAvailable = false
    }
  }
  return rgAvailable
}

const clipLine = (s: string) => (s.length > 300 ? s.slice(0, 300) + '…' : s)

async function grepWithRipgrep(pattern: string, o: GrepOptions, max: number): Promise<GrepHit[]> {
  const { abs, root, prefix } = await resolveWorkspacePath(o.path ?? '')
  const args = ['--line-number', '--no-heading', '--color', 'never', '--max-columns', '400', '--max-count', '50']
  if (o.literal) args.push('--fixed-strings')
  if (o.ignoreCase) args.push('--ignore-case')
  if (o.glob) args.push('--glob', o.glob)
  for (const d of SKIP_DIRS) args.push('--glob', `!${d}/`)
  args.push('--', pattern, abs)
  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, { cwd: root, windowsHide: true })
    const hits: GrepHit[] = []
    let buf = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), GREP_TIMEOUT_MS)
    const onAbort = () => child.kill()
    o.signal?.addEventListener('abort', onAbort)
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        // путь:строка:текст (на Windows путь может начинаться с «C:»)
        const m = line.match(/^(.*?):(\d+):(.*)$/)
        if (!m) continue
        hits.push({ path: prefix + path.relative(root, m[1]).split(path.sep).join('/'), line: Number(m[2]), text: clipLine(m[3]) })
        if (hits.length >= max) child.kill()
      }
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      // rg: 0 — найдено, 1 — ничего, 2 — ошибка (например, неверное выражение)
      if (code === 2 && !hits.length) reject(new Error(err.trim().split('\n').slice(-3).join(' ') || 'Ошибка поиска'))
      else resolve(hits.slice(0, max))
    })
  })
}

async function grepWithNode(pattern: string, o: GrepOptions, max: number): Promise<GrepHit[]> {
  const flags = o.ignoreCase ? 'i' : ''
  let re: RegExp
  try {
    re = new RegExp(o.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, flags)
  } catch (e) {
    throw new Error(`Неверное регулярное выражение: ${e instanceof Error ? e.message : String(e)}`)
  }
  const { root, files, prefix } = await walkFiles(o.path ?? '')
  const hits: GrepHit[] = []
  for (const rel of o.glob ? files.filter((f) => matchGlob(o.glob!, f)) : files) {
    if (hits.length >= max || o.signal?.aborted) break
    const abs = path.join(root, rel)
    const st = await fs.stat(/* turbopackIgnore: true */ abs).catch(() => null)
    if (!st || st.size > MAX_FILE_BYTES) continue
    const text = await fs.readFile(/* turbopackIgnore: true */ abs, 'utf8').catch(() => '')
    if (text.includes('\0')) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (re.test(lines[i])) hits.push({ path: prefix + rel, line: i + 1, text: clipLine(lines[i].replace(/\r$/, '')) })
    }
  }
  return hits
}

export async function searchCode(pattern: string, o: GrepOptions = {}): Promise<GrepHit[]> {
  if (!pattern) throw new Error('Пустой шаблон поиска')
  const max = Math.min(Math.max(o.maxResults ?? 100, 1), 500)
  const engine = o.engine ?? (hasRipgrep() ? 'rg' : 'node')
  return engine === 'rg' ? grepWithRipgrep(pattern, o, max) : grepWithNode(pattern, o, max)
}

export function formatGrepHits(pattern: string, hits: GrepHit[], max: number): string {
  if (!hits.length) return `Совпадений с «${pattern}» не найдено.`
  const byFile = new Map<string, GrepHit[]>()
  for (const h of hits) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h])
  const body = [...byFile].map(([file, hs]) => `${file}\n${hs.map((h) => `  ${h.line}: ${h.text.trim()}`).join('\n')}`).join('\n\n')
  return `${hits.length >= max ? `Показаны первые ${max} совпадений — уточните запрос или маску.\n\n` : ''}${body}`
}

// ─── Поиск по смыслу ─────────────────────────────────────────────────────

const CODE_EXT = new Set(
  'ts tsx js jsx mjs cjs py rb go rs java kt kts scala swift c h cc cpp hpp cs php lua sh bash zsh ps1 sql graphql proto vue svelte astro html css scss less md mdx txt rst json yaml yml toml ini cfg env xml gradle dockerfile makefile tf'.split(' '),
)

function isIndexable(rel: string): boolean {
  const name = rel.split('/').pop()!.toLowerCase()
  if (name === 'dockerfile' || name === 'makefile') return true
  if (/(^|\.)(min\.js|map)$/.test(name) || /lock(\.json)?$/.test(name)) return false
  return CODE_EXT.has(name.split('.').pop() ?? '')
}

/** Слова из идентификаторов: getUserById → get user by id, MAX_RETRY_COUNT → max retry count */
export function codeTokenize(text: string): string[] {
  const split = text
    .replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-$]+/g, ' ')
  // Идентификатор целиком тоже ищется: «getUserById» найдёт точное имя
  const whole = (text.match(/[A-Za-z_$][\w$]{3,}/g) ?? []).map((w) => w.toLowerCase())
  return [...tokenize(split), ...whole]
}

interface IndexedFile {
  mtimeMs: number
  size: number
  chunks: { startLine: number; endLine: number; text: string }[]
}

interface CodeIndex {
  files: Map<string, IndexedFile>
  bm25: BM25
  refreshing?: Promise<void>
}

const indexes = new Map<string, CodeIndex>()

async function refreshIndex(root: string, idx: CodeIndex): Promise<void> {
  const { files } = await walkFiles('')
  const wanted = files.filter(isIndexable).slice(0, MAX_INDEX_FILES)
  const seen = new Set(wanted)
  for (const rel of [...idx.files.keys()]) {
    if (seen.has(rel)) continue
    idx.files.get(rel)!.chunks.forEach((_, i) => idx.bm25.remove(`${rel}#${i}`))
    idx.files.delete(rel)
  }
  // Читаем файлы пачками, чтобы не упереться в лимит открытых файлов
  for (let i = 0; i < wanted.length; i += 64) {
    await Promise.all(
      wanted.slice(i, i + 64).map(async (rel) => {
        const abs = path.join(root, rel)
        const st = await fs.stat(/* turbopackIgnore: true */ abs).catch(() => null)
        if (!st || st.size > MAX_FILE_BYTES) return
        const prev = idx.files.get(rel)
        if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return
        const text = await fs.readFile(/* turbopackIgnore: true */ abs, 'utf8').catch(() => '')
        if (text.includes('\0')) return
        prev?.chunks.forEach((_, j) => idx.bm25.remove(`${rel}#${j}`))
        const chunks = chunkText(text, 1500, 3)
        // Путь к файлу — часть фрагмента: «auth middleware» найдёт src/auth/middleware.ts
        chunks.forEach((c, j) => idx.bm25.add(`${rel}#${j}`, codeTokenize(`${rel.replace(/[/.]/g, ' ')}\n${c.text}`)))
        idx.files.set(rel, { mtimeMs: st.mtimeMs, size: st.size, chunks })
      }),
    )
  }
}

export interface CodeHit {
  path: string
  startLine: number
  endLine: number
  score: number
  text: string
}

export async function codebaseSearch(query: string, limit = 8): Promise<CodeHit[]> {
  const { root } = await resolveWorkspacePath('')
  let idx = indexes.get(root)
  if (!idx) indexes.set(root, (idx = { files: new Map(), bm25: new BM25() }))
  // Параллельные запросы ждут одно и то же обновление индекса
  idx.refreshing ??= refreshIndex(root, idx).finally(() => (idx!.refreshing = undefined))
  await idx.refreshing
  const hits = idx.bm25.search(codeTokenize(query), Math.min(limit, 20) * 2)
  const out: CodeHit[] = []
  const perFile = new Map<string, number>()
  for (const h of hits) {
    const [rel, i] = [h.id.slice(0, h.id.lastIndexOf('#')), Number(h.id.slice(h.id.lastIndexOf('#') + 1))]
    // Не больше двух фрагментов из одного файла — разнообразнее выдача
    if ((perFile.get(rel) ?? 0) >= 2) continue
    const c = idx.files.get(rel)?.chunks[i]
    if (!c) continue
    perFile.set(rel, (perFile.get(rel) ?? 0) + 1)
    out.push({ path: rel, startLine: c.startLine, endLine: c.endLine, score: h.score, text: c.text })
    if (out.length >= limit) break
  }
  return out
}

export function formatCodeHits(query: string, hits: CodeHit[]): string {
  if (!hits.length) return `По запросу «${query}» в коде ничего не найдено. Попробуйте search_code с точным именем.`
  return hits
    .map((h) => {
      const lines = h.text.split('\n')
      const shown = lines.slice(0, 30)
      const body = shown.map((l, i) => `${String(h.startLine + i).padStart(5)}│ ${l}`).join('\n')
      return `${h.path} (строки ${h.startLine}–${h.endLine})\n${body}${lines.length > shown.length ? '\n     │ …' : ''}`
    })
    .join('\n\n')
}

/** Для тестов */
export function resetCodeIndex() {
  indexes.clear()
  rgAvailable = null
}
