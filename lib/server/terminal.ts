import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getTerminalSettings, getToolsDir } from './settings'
import { resolveWorkspacePath, WorkspaceError } from './workspace'

// Терминал для моделей: команды выполняются в рабочей папке с правами
// пользователя, который запустил Hephaestus. Включается в настройках.
// Ключи и токены из окружения сервера в команды не передаются.

const HEAD_BYTES = 6_000
const TAIL_BYTES = 20_000
const MAX_PARALLEL = 4
const MAX_BACKGROUND = 6
const KILL_GRACE_MS = 2000

export class TerminalError extends Error {}

/** Переменные с секретами не должны попасть в команды, которые придумала модель */
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSW(OR)?D|CREDENTIAL|COOKIE|SESSION|AUTH)/i

/**
 * Настройки git через окружение (GIT_CONFIG_COUNT + GIT_CONFIG_KEY_n/VALUE_n)
 * убираем целиком: KEY_n отсеялся бы фильтром секретов, а без него git падает
 * на любой команде («missing config key»). Да и значения там бывают с токенами.
 */
const GIT_ENV_CONFIG = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/

export function commandEnv(base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(base)) if (!SECRET_ENV.test(k) && !GIT_ENV_CONFIG.test(k)) env[k] = v
  // Неинтерактивный режим: без пейджеров, вопросов git и цветных кодов
  return { ...env, CI: '1', GIT_TERMINAL_PROMPT: '0', PAGER: 'cat', GIT_PAGER: 'cat', NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' }
}

// Защита от случайных катастроф, а не от злонамеренности: полный доступ
// означает права пользователя, обойти такой список при желании можно.
const CATASTROPHIC: [RegExp, string][] = [
  [/\brm\s+(-\w*\s+)*(-\w*[rR]\w*\s+)(-\w*\s+)*(\/|~|\$HOME|\/\*)(\s|$)/, 'удаление корня диска или домашней папки'],
  [/\bmkfs(\.\w+)?\b/, 'форматирование диска'],
  [/\bdd\b[^|]*\bof=\/dev\/(sd|nvme|hd|disk)/, 'запись поверх диска'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork-бомба'],
  [/\b(shutdown|reboot|halt|poweroff)\b/, 'выключение компьютера'],
  [/\bformat\s+[a-z]:/i, 'форматирование диска'],
]

export function checkCommand(command: string): void {
  if (!command.trim()) throw new TerminalError('Пустая команда')
  for (const [re, what] of CATASTROPHIC) if (re.test(command)) throw new TerminalError(`Команда отклонена: ${what}`)
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g

/** Копит вывод: начало и хвост, середина выбрасывается — ошибки обычно в конце */
class OutputBuffer {
  private head = ''
  private tail = ''
  total = 0
  push(chunk: string) {
    this.total += chunk.length
    if (this.head.length < HEAD_BYTES) {
      const take = HEAD_BYTES - this.head.length
      this.head += chunk.slice(0, take)
      chunk = chunk.slice(take)
    }
    if (chunk) this.tail = (this.tail + chunk).slice(-TAIL_BYTES)
  }
  text(): string {
    const skipped = this.total - this.head.length - this.tail.length
    const out = skipped > 0 ? `${this.head}\n…[пропущено ${skipped} символов]…\n${this.tail}` : this.head + this.tail
    return out.replace(ANSI, '').replace(/\r(?!\n)/g, '\n')
  }
}

function shellFor(): { shell: string | true } {
  if (process.platform === 'win32') return { shell: true }
  return { shell: fs.existsSync('/bin/bash') ? '/bin/bash' : true }
}

function killTree(child: ChildProcess) {
  if (child.pid == null || child.exitCode != null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM') // вся группа процессов
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      // уже завершился
    }
  }, KILL_GRACE_MS).unref()
}

async function prepare(command: string, cwd?: string) {
  const { mode, timeoutSec } = await getTerminalSettings()
  if (mode !== 'full') throw new TerminalError('Терминал выключен. Включите его в настройках: Настройки → Рабочая папка и терминал')
  checkCommand(command)
  const dir = await resolveWorkspacePath(cwd ?? '')
  const st = await fs.promises.stat(/* turbopackIgnore: true */ dir.abs).catch(() => null)
  if (!st?.isDirectory()) throw new WorkspaceError(`Папка не найдена: ${dir.rel || '.'}`, 404)
  return { dir, timeoutSec }
}

/**
 * Общая папка инструментов в окружении команд: её bin и Python-окружение — в
 * PATH, глобальные npm-пакеты ставятся туда же. Так установленный один раз
 * инструмент виден во всех проектах и копиях, а не скачивается заново.
 */
export function toolsEnv(tools: string, basePath = process.env.PATH ?? ''): Record<string, string> {
  const venvBin = path.join(tools, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin')
  // npm на Windows кладёт команды прямо в prefix, на остальных системах — в prefix/bin
  const dirs = [path.join(tools, 'bin'), venvBin, ...(process.platform === 'win32' ? [tools] : [])]
  return {
    HEPHAESTUS_TOOLS: tools,
    PATH: [...dirs, basePath].filter(Boolean).join(path.delimiter),
    NPM_CONFIG_PREFIX: tools,
  }
}

export function spawnEnv(): NodeJS.ProcessEnv {
  const base = commandEnv()
  // На Windows переменная пути зовётся «Path»: не держим две записи с разным регистром
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const { [pathKey]: basePath, ...rest } = base
  return { ...rest, ...toolsEnv(getToolsDir(), basePath ?? '') } as NodeJS.ProcessEnv
}

function start(command: string, cwdAbs: string): ChildProcess {
  return spawn(command, {
    ...shellFor(),
    cwd: cwdAbs,
    env: spawnEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // своя группа процессов, чтобы убить всё дерево
    windowsHide: true,
  })
}

// ─── Обычные команды ─────────────────────────────────────────────────────

export interface CommandResult {
  command: string
  cwd: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  output: string
}

let running = 0
const waiting: (() => void)[] = []

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

export async function runCommand(command: string, opts: { cwd?: string; timeoutSec?: number; signal?: AbortSignal } = {}): Promise<CommandResult> {
  const { dir, timeoutSec } = await prepare(command, opts.cwd)
  const limit = Math.min(opts.timeoutSec ?? timeoutSec, timeoutSec)
  return slot(
    () =>
      new Promise<CommandResult>((resolve, reject) => {
        const started = Date.now()
        const out = new OutputBuffer()
        let timedOut = false
        const child = start(command, dir.abs)
        child.stdout!.setEncoding('utf8').on('data', (d: string) => out.push(d))
        child.stderr!.setEncoding('utf8').on('data', (d: string) => out.push(d))
        const timer = setTimeout(() => {
          timedOut = true
          killTree(child)
        }, limit * 1000)
        const onAbort = () => killTree(child)
        opts.signal?.addEventListener('abort', onAbort)
        child.on('error', (e) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          reject(new TerminalError(`Не удалось запустить команду: ${e.message}`))
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve({ command, cwd: dir.rel || '.', exitCode: code, timedOut, durationMs: Date.now() - started, output: out.text() })
        })
      }),
  )
}

export function formatCommandResult(r: CommandResult): string {
  const status = r.timedOut ? `прервана по таймауту` : `код выхода ${r.exitCode ?? '—'}`
  return `$ ${r.command}\n(папка: ${r.cwd}, ${status}, ${(r.durationMs / 1000).toFixed(1)} с)\n\n${r.output.trim() || '[нет вывода]'}`
}

// ─── Фоновые процессы: dev-серверы, watch-режимы ─────────────────────────

interface BackgroundProcess {
  id: string
  command: string
  cwd: string
  child: ChildProcess
  out: OutputBuffer
  /** Сколько символов уже отдано модели — следующий вызов вернёт только новое */
  readFrom: number
  log: string
  startedAt: number
  exitCode?: number | null
}

const background = new Map<string, BackgroundProcess>()
let nextId = 1

if (typeof process !== 'undefined' && process.on) {
  process.on('exit', () => {
    for (const p of background.values()) killTree(p.child)
  })
}

export async function startBackground(command: string, cwd?: string): Promise<{ id: string; output: string }> {
  const { dir } = await prepare(command, cwd)
  const alive = [...background.values()].filter((p) => p.exitCode === undefined)
  if (alive.length >= MAX_BACKGROUND) throw new TerminalError(`Уже запущено ${alive.length} фоновых процессов — остановите ненужные (stop_process)`)
  const id = `p${nextId++}`
  const child = start(command, dir.abs)
  const proc: BackgroundProcess = { id, command, cwd: dir.rel || '.', child, out: new OutputBuffer(), readFrom: 0, log: '', startedAt: Date.now() }
  const onData = (d: string) => {
    proc.out.push(d)
    proc.log = (proc.log + d).slice(-TAIL_BYTES)
  }
  child.stdout!.setEncoding('utf8').on('data', onData)
  child.stderr!.setEncoding('utf8').on('data', onData)
  child.on('close', (code) => (proc.exitCode = code))
  child.on('error', (e) => {
    onData(`\n[ошибка запуска: ${e.message}]\n`)
    proc.exitCode = -1
  })
  background.set(id, proc)
  // Даём процессу пару секунд стартовать, чтобы сразу показать первые строки
  await new Promise((r) => setTimeout(r, 2000))
  return { id, output: readBackground(id) }
}

export function readBackground(id: string): string {
  const p = background.get(id)
  if (!p) throw new TerminalError(`Нет фонового процесса ${id}`)
  const fresh = p.out.total - p.readFrom
  const text = fresh > 0 ? p.log.slice(-Math.min(fresh, p.log.length)) : ''
  p.readFrom = p.out.total
  const state = p.exitCode === undefined ? 'работает' : `завершён, код выхода ${p.exitCode}`
  return `[${p.id}] $ ${p.command} (папка: ${p.cwd}, ${state})\n\n${text.replace(ANSI, '').trim() || '[нового вывода нет]'}`
}

export function stopBackground(id: string): string {
  const p = background.get(id)
  if (!p) throw new TerminalError(`Нет фонового процесса ${id}`)
  killTree(p.child)
  background.delete(id)
  return `Процесс ${id} остановлен`
}

export function listBackground(): string {
  if (!background.size) return 'Фоновых процессов нет'
  return [...background.values()]
    .map((p) => `${p.id}: ${p.command} (папка: ${p.cwd}, ${p.exitCode === undefined ? 'работает' : `завершён, код ${p.exitCode}`})`)
    .join('\n')
}
