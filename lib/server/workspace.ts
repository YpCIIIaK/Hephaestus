import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceEntry } from '../types'
import { WORKSPACE_DIR } from './paths'

// Песочница для файловых инструментов ИИ. Все пути относительные и не могут
// выйти за пределы WORKSPACE_DIR — ни через «..», ни через символические ссылки.

const MAX_READ_BYTES = 2_000_000
const MAX_TREE_ENTRIES = 2000
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', '.venv'])

export class WorkspaceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export async function ensureWorkspace(): Promise<void> {
  await fs.mkdir(/* turbopackIgnore: true */ WORKSPACE_DIR, { recursive: true })
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Превращает пользовательский путь в абсолютный внутри песочницы */
export async function resolveWorkspacePath(input: string): Promise<{ abs: string; rel: string }> {
  const cleaned = String(input ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^workspace\//, '')
    .trim()
  if (cleaned.includes('\0')) throw new WorkspaceError('Недопустимый путь')
  const abs = path.resolve(WORKSPACE_DIR, cleaned || '.')
  if (!isInside(WORKSPACE_DIR, abs)) throw new WorkspaceError('Путь выходит за пределы workspace', 403)

  // Проверяем реальный путь ближайшего существующего предка: ссылка внутри
  // песочницы не должна вести наружу.
  await ensureWorkspace()
  const realRoot = await fs.realpath(/* turbopackIgnore: true */ WORKSPACE_DIR)
  let probe = abs
  for (;;) {
    try {
      const real = await fs.realpath(/* turbopackIgnore: true */ probe)
      if (!isInside(realRoot, real)) throw new WorkspaceError('Путь выходит за пределы workspace', 403)
      break
    } catch (e) {
      if (e instanceof WorkspaceError) throw e
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  return { abs, rel: path.relative(WORKSPACE_DIR, abs).split(path.sep).join('/') }
}

export async function listTree(): Promise<WorkspaceEntry[]> {
  await ensureWorkspace()
  let count = 0
  async function walk(dir: string): Promise<WorkspaceEntry[]> {
    const entries = await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true })
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    const out: WorkspaceEntry[] = []
    for (const e of entries) {
      if (count++ > MAX_TREE_ENTRIES) break
      if (e.name.startsWith('.') && e.name !== '.env.example') continue
      const abs = path.join(dir, e.name)
      const rel = path.relative(WORKSPACE_DIR, abs).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        out.push({ path: rel, name: e.name, type: 'dir', children: await walk(abs) })
      } else if (e.isFile()) {
        const st = await fs.stat(/* turbopackIgnore: true */ abs)
        out.push({ path: rel, name: e.name, type: 'file', size: st.size })
      }
    }
    return out
  }
  return walk(WORKSPACE_DIR)
}

export function flattenTree(tree: WorkspaceEntry[]): string[] {
  const out: string[] = []
  const visit = (items: WorkspaceEntry[]) => {
    for (const it of items) {
      if (it.type === 'file') out.push(it.path)
      else if (it.children) visit(it.children)
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
  const existed = await fs
    .stat(/* turbopackIgnore: true */ abs)
    .then((s) => s.isFile())
    .catch(() => false)
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(abs), { recursive: true })
  await fs.writeFile(/* turbopackIgnore: true */ abs, content, 'utf-8')
  return { path: rel, bytes: Buffer.byteLength(content, 'utf-8'), created: !existed }
}

/** Замена фрагмента: oldText должен встречаться в файле ровно один раз */
export async function editWorkspaceFile(p: string, oldText: string, newText: string): Promise<{ path: string }> {
  const { content, path: rel } = await readWorkspaceFile(p)
  if (!oldText) throw new WorkspaceError('Пустой фрагмент для замены')
  const first = content.indexOf(oldText)
  if (first === -1) throw new WorkspaceError('Фрагмент для замены не найден в файле')
  if (content.indexOf(oldText, first + oldText.length) !== -1) {
    throw new WorkspaceError('Фрагмент встречается несколько раз — добавьте больше контекста')
  }
  await writeWorkspaceFile(rel, content.slice(0, first) + newText + content.slice(first + oldText.length))
  return { path: rel }
}

export async function deleteWorkspacePath(p: string): Promise<{ path: string }> {
  const { abs, rel } = await resolveWorkspacePath(p)
  if (!rel || rel === '.') throw new WorkspaceError('Нельзя удалить корень workspace', 403)
  await fs.rm(/* turbopackIgnore: true */ abs, { recursive: true, force: false }).catch(() => {
    throw new WorkspaceError(`Не найдено: ${rel}`, 404)
  })
  return { path: rel }
}
