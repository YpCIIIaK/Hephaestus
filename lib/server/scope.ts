import fs from 'node:fs/promises'
import path from 'node:path'
import { sandboxTree } from './sandboxes'
import { getProjectDir } from './settings'

/**
 * Область, в которой работают инструменты запроса: копия проекта участника
 * и/или подпапка проекта («папка проекта для всех блоков» пайплайна).
 * null — обычная рабочая папка.
 */
export async function resolveScope(sandbox?: string, sub?: string): Promise<{ root: string; sandbox: boolean } | null> {
  const dir = sub?.trim().replace(/^\.\/?/, '').replace(/\/+$/, '')
  if (!sandbox && !dir) return null
  const base = sandbox ? await sandboxTree(sandbox) : await getProjectDir()
  if (!dir) return { root: base, sandbox: true }
  const root = path.resolve(/* turbopackIgnore: true */ base, dir)
  if (root !== base && !root.startsWith(base + path.sep)) throw new Error(`Папка проекта «${sub}» выходит за пределы рабочей папки`)
  const st = await fs.stat(/* turbopackIgnore: true */ root).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`Папка проекта «${sub}» не найдена в рабочей папке`)
  return { root, sandbox: !!sandbox }
}
