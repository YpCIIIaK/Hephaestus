import { spawn, type ChildProcess } from 'node:child_process'
import { resetCliCache, subscriptionConfig, subscriptionEnv, type SubscriptionId } from './subscriptions'

// Установка и вход в подписки кнопками из интерфейса. Команды фиксированные:
// установка — npm в общую папку инструментов (без прав администратора),
// вход — штатный вход самих CLI. CLI сам открывает браузер на этом
// компьютере и принимает ответ на localhost; если он просит вставить код,
// его можно передать из интерфейса. Токены остаются у CLI.

export type AuthAction = 'install' | 'login' | 'logout'

export interface AuthJob {
  action: AuthAction
  state: 'running' | 'done' | 'failed'
  output: string
  /** Ссылка из вывода CLI — открыть, если браузер не открылся сам */
  url?: string
  startedAt: number
  exitCode?: number | null
}

const PACKAGES: Record<SubscriptionId, string> = { 'claude-code': '@anthropic-ai/claude-code', codex: '@openai/codex' }
const JOB_TIMEOUT_MS = 10 * 60_000
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g

const jobs = new Map<SubscriptionId, { job: AuthJob; child?: ChildProcess }>()

export class AuthError extends Error {}

async function commandFor(id: SubscriptionId, action: AuthAction): Promise<{ bin: string; args: string[] }> {
  if (action === 'install') return { bin: process.env.HEPHAESTUS_NPM || 'npm', args: ['install', '-g', PACKAGES[id]] }
  const { bin } = await subscriptionConfig(id)
  if (id === 'codex') return { bin, args: action === 'login' ? ['login'] : ['logout'] }
  return { bin, args: action === 'login' ? ['auth', 'login', '--claudeai'] : ['auth', 'logout'] }
}

export function getJob(id: SubscriptionId): AuthJob | null {
  return jobs.get(id)?.job ?? null
}

export async function startJob(id: SubscriptionId, action: AuthAction): Promise<AuthJob> {
  const current = jobs.get(id)
  if (current?.job.state === 'running') throw new AuthError('Уже выполняется — дождитесь окончания или отмените')
  const { bin, args } = await commandFor(id, action)
  const job: AuthJob = { action, state: 'running', output: '', startedAt: Date.now() }
  // npm i -g ставит пакет в общую папку инструментов: её prefix задан в окружении
  const child = spawn(bin, args, { env: { ...subscriptionEnv(), ...(action === 'install' ? { NPM_CONFIG_PREFIX: subscriptionEnv().HEPHAESTUS_TOOLS } : {}) }, shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const entry: { job: AuthJob; child?: ChildProcess } = { job, child }
  jobs.set(id, entry)
  const onData = (d: string) => {
    job.output = (job.output + d.replace(ANSI, '').replace(/\r(?!\n)/g, '\n')).slice(-6000)
    job.url ??= job.output.match(/https:\/\/[^\s"'<>]+/)?.[0]
  }
  child.stdout!.setEncoding('utf8').on('data', onData)
  child.stderr!.setEncoding('utf8').on('data', onData)
  child.stdin!.on('error', () => {})
  const timer = setTimeout(() => child.kill('SIGTERM'), JOB_TIMEOUT_MS)
  child.on('error', (e) => {
    job.state = 'failed'
    onData(`\n${(e as NodeJS.ErrnoException).code === 'ENOENT' ? `${bin} не найден${action === 'install' ? ' — установите Node.js (в нём есть npm)' : ' — сначала установите CLI'}` : e.message}\n`)
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    job.exitCode = code
    if (job.state === 'running') job.state = code === 0 ? 'done' : 'failed'
    entry.child = undefined
    resetCliCache()
  })
  return job
}

/** Код подтверждения, если CLI попросил вставить его из браузера */
export function sendCode(id: SubscriptionId, code: string): void {
  const entry = jobs.get(id)
  if (!entry?.child || entry.job.state !== 'running') throw new AuthError('Вход не выполняется')
  entry.child.stdin!.write(`${code.trim()}\n`)
}

export function cancelJob(id: SubscriptionId): void {
  const entry = jobs.get(id)
  if (entry?.child) {
    entry.job.state = 'failed'
    entry.job.output += '\nОтменено\n'
    entry.child.kill('SIGTERM')
  }
}

/** Выполнен ли вход в подписку: по штатной команде статуса самого CLI */
export async function loginStatus(id: SubscriptionId): Promise<{ loggedIn: boolean | null; detail?: string }> {
  const { bin } = await subscriptionConfig(id)
  const args = id === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json']
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: subscriptionEnv(), shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ loggedIn: null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (id === 'codex') {
        const text = out.replace(ANSI, '').trim()
        return resolve({ loggedIn: code === 0 && !/not logged in/i.test(text), detail: text.split('\n')[0]?.slice(0, 120) })
      }
      try {
        const j = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string }
        // Вход по API-ключу консоли — это оплата за токены, а не подписка
        const detail = [j.authMethod, j.apiProvider && j.apiProvider !== 'firstParty' ? j.apiProvider : ''].filter(Boolean).join(' · ')
        resolve({ loggedIn: !!j.loggedIn, detail })
      } catch {
        resolve({ loggedIn: code === 0 ? null : false })
      }
    })
  })
}
