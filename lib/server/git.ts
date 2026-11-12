import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnEnv } from './terminal'
import { resolveWorkspacePath, withFileLock } from './workspace'

// Клонирование репозиториев для моделей: утилиты — в общую папку @tools,
// проекты для работы — в рабочую папку. Повторный вызов для того же
// репозитория не скачивает его заново, а подтягивает обновления.

const CLONE_TIMEOUT_MS = 5 * 60_000

export class GitError extends Error {}

/**
 * Разрешены только https:// и git@host:owner/repo — без file://, ext:: и
 * локальных путей: через транспорт ext:: git может выполнить команду.
 */
export function parseRepoUrl(raw: string): { url: string; name: string } {
  const url = raw.trim()
  const https = url.match(/^https:\/\/[\w.-]+(?::\d+)?\/([\w.-]+\/)*([\w.-]+?)(\.git)?\/?$/)
  const ssh = url.match(/^git@[\w.-]+:([\w.-]+\/)*([\w.-]+?)(\.git)?$/)
  const m = https ?? ssh
  if (!m || url.startsWith('-')) throw new GitError('Нужна ссылка вида https://github.com/owner/repo или git@github.com:owner/repo.git')
  // Ссылка на файл в репозитории (…/blob/main/x.md) — берём сам репозиторий
  const blob = url.match(/^(https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+)\/(blob|tree)\//)
  if (blob) return parseRepoUrl(blob[1])
  return { url, name: m[2] }
}

function git(args: string[], cwd?: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: { ...spawnEnv(), GIT_TERMINAL_PROMPT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), CLONE_TIMEOUT_MS)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new GitError(`git не запустился: ${e.message}. Установите git`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out: out.trim().slice(-4000) })
    })
  })
}

export interface CloneResult {
  /** Путь для инструментов модели: @tools/repos/x или repos/x */
  path: string
  updated: boolean
  commit: string
  listing: string[]
  note?: string
}

export async function gitClone(rawUrl: string, opts: { into?: 'tools' | 'workspace'; ref?: string } = {}): Promise<CloneResult> {
  const { url, name } = parseRepoUrl(rawUrl)
  if (opts.ref && !/^[\w./-]+$/.test(opts.ref)) throw new GitError('Некорректное имя ветки или тега')
  const target = await resolveWorkspacePath(`${opts.into === 'workspace' ? '' : '@tools/'}repos/${name}`)
  return withFileLock(target.abs, async () => {
    const exists = await fs.stat(/* turbopackIgnore: true */ path.join(target.abs, '.git')).then(
      () => true,
      () => false,
    )
    let updated = false
    let note = ''
    if (exists) {
      const remote = (await git(['-C', target.abs, 'remote', 'get-url', 'origin'])).out
      if (remote.replace(/\.git$/, '') !== url.replace(/\.git$/, '')) throw new GitError(`В ${target.rel} уже лежит другой репозиторий (${remote})`)
      // Модель могла работать в своей ветке (например, дорабатывала инструмент) — её не трогаем,
      // а только скачиваем обновления основной ветки
      const upstream = await git(['-C', target.abs, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      if (upstream.code === 0) {
        const pull = await git(['-C', target.abs, 'pull', '--ff-only', '--depth', '1'])
        if (pull.code !== 0) throw new GitError(`Не удалось обновить ${target.rel}: ${pull.out}`)
      } else {
        const branch = (await git(['-C', target.abs, 'branch', '--show-current'])).out || 'отделённый HEAD'
        const fetch = await git(['-C', target.abs, 'fetch', '--depth', '1', 'origin'])
        if (fetch.code !== 0) throw new GitError(`Не удалось скачать обновления ${target.rel}: ${fetch.out}`)
        note = `Локальная ветка «${branch}» сохранена как есть; обновления основной ветки скачаны (origin/HEAD). Вернуться на основную ветку: git switch <её имя>.`
      }
      updated = true
    } else {
      await fs.mkdir(/* turbopackIgnore: true */ path.dirname(target.abs), { recursive: true })
      const args = ['clone', '--depth', '1', ...(opts.ref ? ['--branch', opts.ref] : []), '--', url, target.abs]
      const clone = await git(args)
      if (clone.code !== 0) throw new GitError(`Не удалось склонировать ${url}: ${clone.out}`)
    }
    const commit = (await git(['-C', target.abs, 'rev-parse', '--short', 'HEAD'])).out
    const listing = (await fs.readdir(/* turbopackIgnore: true */ target.abs, { withFileTypes: true }))
      .filter((e) => e.name !== '.git')
      .map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`)
      .sort()
    return { path: target.rel, updated, commit, listing, note: note || undefined }
  })
}

export function formatClone(r: CloneResult): string {
  return `${r.updated ? 'Обновлён' : 'Склонирован'} ${r.path} (коммит ${r.commit})${r.note ? `\n${r.note}` : ''}\n\n${r.listing.join('\n')}\n\nДальше: прочитай README (read_file ${r.path}/README.md), команды выполняй с cwd «${r.path}».`
}
