import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CLAUDE_CODE_PREFIX, CODEX_PREFIX, providerOf, splitEffort, upstreamModelId, withEffort } from '../models'
import type { Effort, LLMEvent, LLMMessage, LLMRequest, ModelInfo, ToolsetId, Usage } from '../types'
import { sessionContext } from './sessions'
import { parseLimitLine, recordExhausted, recordLimits } from './sub-limits'
import { getTerminalSettings, getToolsDir, getWorkspaceDir, loadServerSettings } from './settings'
import { toolsEnv } from './terminal'

// Модели по подписке: запросы идут через официальные CLI — Claude Code
// (подписка Claude Pro/Max) и Codex (подписка ChatGPT) — в режиме без
// интерфейса. Авторизация — их собственная (`claude` → /login, `codex login`),
// ключи и токены Hephaestus их не касаются. Инструменты — встроенные в CLI,
// они работают в рабочей папке проекта (или в копии участника).

export type SubscriptionId = 'claude-code' | 'codex'

/** Алиасы Claude Code — всегда последняя версия семейства */
const CLAUDE_ALIASES = ['fable', 'opus', 'sonnet', 'haiku']
/** Уровни усилия Claude Code (флаг --effort) */
export const CLAUDE_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
/** Модели Anthropic из каталога старше этого в подписке обычно уже недоступны */
const CLAUDE_MAX_AGE_DAYS = 400

const LABELS: Record<SubscriptionId, string> = { 'claude-code': 'Claude Code (подписка)', codex: 'Codex (подписка ChatGPT)' }
const MAX_RUN_MS = 60 * 60_000

export interface SubscriptionSettings {
  enabled?: boolean
  /** Команда или путь к CLI; по умолчанию claude / codex */
  bin?: string
  /** Дополнительные модели через запятую — если какой-то нет в автоматическом списке */
  models?: string
}

export async function subscriptionConfig(id: SubscriptionId): Promise<{ enabled: boolean; bin: string; models: string[] }> {
  const s = (await loadServerSettings()).subscriptions?.[id] ?? {}
  const models = (s.models ?? '')
    .split(/[,\s]+/)
    .map((m) => m.trim())
    .filter(Boolean)
  return { enabled: !!s.enabled, bin: s.bin?.trim() || (id === 'codex' ? 'codex' : 'claude'), models }
}

/** Куда на самом деле отправить запрос: модель OpenRouter можно перенаправить на подписку */
export async function routeModel(model: string): Promise<string> {
  const routes = (await loadServerSettings()).subscriptionRoutes ?? {}
  const { base, effort } = splitEffort(model)
  const target = routes[base]
  if (!target) return model
  const p = providerOf(target)
  if (p !== 'claude-code' && p !== 'codex') return model
  // Усилие, выбранное у модели OpenRouter, сохраняется и для подписки
  return (await subscriptionConfig(p)).enabled ? withEffort(splitEffort(target).base, effort ?? splitEffort(target).effort) : model
}

// ─── Проверка, что CLI установлен ────────────────────────────────────────

const versionCache = new Map<string, { at: number; version: string | null; error?: string }>()

export function resetCliCache() {
  versionCache.clear()
}

export async function cliVersion(bin: string): Promise<{ version: string | null; error?: string }> {
  const hit = versionCache.get(bin)
  if (hit && Date.now() - hit.at < 60_000) return hit
  const r = await new Promise<{ version: string | null; error?: string }>((resolve) => {
    // PATH как у запусков: CLI, установленный кнопкой, лежит в общей папке инструментов
    const child = spawn(bin, ['--version'], { env: subscriptionEnv(), shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ version: null, error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'не установлен' : e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? { version: out.trim().split('\n')[0].slice(0, 80) } : { version: null, error: `код выхода ${code}` })
    })
  })
  versionCache.set(bin, { at: Date.now(), ...r })
  return r
}

/** «anthropic/claude-opus-5.5» → «claude-opus-5-5»: так модель называется в Claude Code */
export function claudeCodeName(openrouterId: string): string | null {
  const m = openrouterId.match(/^anthropic\/(claude-[a-z0-9.-]+)$/)
  return m ? m[1].replace(/\./g, '-') : null
}

interface CodexModel {
  slug: string
  display_name?: string
  description?: string
  visibility?: string
  priority?: number
  supported_reasoning_levels?: { effort: string }[]
}

let codexCache: { at: number; bin: string; models: CodexModel[] } | null = null

/** Каталог моделей Codex — тот, что показывает сам CLI (`codex debug models`) */
export async function codexCatalog(bin: string): Promise<CodexModel[]> {
  if (codexCache && codexCache.bin === bin && Date.now() - codexCache.at < 10 * 60_000) return codexCache.models
  const out = await new Promise<string>((resolve) => {
    const child = spawn(bin, ['debug', 'models'], { env: subscriptionEnv(), shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let buf = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (buf += d))
    child.on('error', () => resolve(''))
    child.on('close', () => {
      clearTimeout(timer)
      resolve(buf)
    })
  })
  let models: CodexModel[] = []
  try {
    models = ((JSON.parse(out) as { models?: CodexModel[] }).models ?? []).filter((m) => m.slug && m.visibility !== 'hide')
  } catch {
    models = []
  }
  models.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  codexCache = { at: Date.now(), bin, models }
  return models
}

const DESCRIPTION = (cli: string) => `Через ${cli} по подписке: расход идёт из лимитов подписки, а не с баланса OpenRouter`

/** Модели подписок: все свежие модели Anthropic для Claude Code, каталог самого Codex, плюс добавленные вручную */
export async function subscriptionModels(openrouter: ModelInfo[] = []): Promise<ModelInfo[]> {
  const out: ModelInfo[] = []
  const seen = new Set<string>()
  const push = (m: ModelInfo) => {
    if (seen.has(m.id)) return
    seen.add(m.id)
    out.push(m)
  }
  const base = (id: SubscriptionId, name: string, slug: string, efforts: Effort[], extra: Partial<ModelInfo> = {}): ModelInfo => ({
    id: `${id === 'codex' ? CODEX_PREFIX : CLAUDE_CODE_PREFIX}${slug}`,
    name: `${name} · подписка`,
    provider: id,
    vendor: id,
    description: DESCRIPTION(id === 'codex' ? 'Codex CLI' : 'Claude Code CLI'),
    pricing: { prompt: 0, completion: 0 },
    supportsTools: true,
    supportsReasoning: efforts.length > 0,
    efforts,
    ...extra,
  })

  const claude = await subscriptionConfig('claude-code')
  if (claude.enabled) {
    const cutoff = Date.now() / 1000 - CLAUDE_MAX_AGE_DAYS * 86400
    const fresh = openrouter
      .filter((m) => m.provider === 'openrouter' && m.id.startsWith('anthropic/') && !m.id.includes(':') && (m.created ?? 0) >= cutoff)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    for (const m of fresh) {
      const slug = claudeCodeName(m.id)
      if (slug) push(base('claude-code', m.name.replace(/^Anthropic:\s*/, ''), slug, CLAUDE_EFFORTS, { contextLength: m.contextLength, created: m.created }))
    }
    for (const a of CLAUDE_ALIASES) push(base('claude-code', `${a} (последняя версия)`, a, CLAUDE_EFFORTS))
    for (const m of claude.models) push(base('claude-code', m, m, CLAUDE_EFFORTS))
  }

  const codex = await subscriptionConfig('codex')
  if (codex.enabled) {
    const list = await codexCatalog(codex.bin)
    for (const m of list) {
      const efforts = (m.supported_reasoning_levels ?? []).map((l) => l.effort as Effort).filter((e) => (['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as string[]).includes(e))
      push(base('codex', m.display_name || m.slug, m.slug, efforts, { description: [m.description, DESCRIPTION('Codex CLI')].filter(Boolean).join(' · ') }))
    }
    if (!list.length) push(base('codex', 'модель по умолчанию', 'default', ['low', 'medium', 'high', 'xhigh']))
    for (const m of codex.models) push(base('codex', m, m, ['low', 'medium', 'high', 'xhigh']))
  }
  return out
}

// ─── Запрос к модели ─────────────────────────────────────────────────────

/** История диалога одним текстом: CLI принимает один запрос, а не список сообщений */
export function promptFromMessages(messages: LLMMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content ?? '')
    .filter(Boolean)
    .join('\n\n')
  const rest = messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
  const last = rest[rest.length - 1]
  const history = (last?.role === 'user' ? rest.slice(0, -1) : rest).map((m) => `[${m.role === 'user' ? 'Пользователь' : 'Ассистент'}]\n${m.content}`)
  const current = last?.role === 'user' ? (last.content ?? '') : 'Продолжи.'
  const prompt = history.length ? `Предыдущая часть диалога:\n\n${history.join('\n\n')}\n\n---\nТекущий запрос пользователя:\n\n${current}` : current
  return { system, prompt }
}

const CLAUDE_TOOLS: Partial<Record<ToolsetId, string[]>> = {
  files_read: ['Read', 'Glob', 'Grep', 'LS'],
  code: ['Read', 'Glob', 'Grep'],
  files_write: ['Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep', 'LS'],
  terminal: ['Bash'],
  web: ['WebSearch', 'WebFetch'],
}

/** Инструменты Claude Code, соответствующие наборам Hephaestus */
export function claudeToolList(sets: ToolsetId[] | undefined, terminal: boolean): string[] {
  const tools = new Set<string>()
  for (const s of sets ?? []) {
    if (s === 'terminal' && !terminal) continue
    for (const t of CLAUDE_TOOLS[s] ?? []) tools.add(t)
  }
  return [...tools]
}

/** Системный промпт — файлом: в аргументах командной строки он мог бы быть истолкован оболочкой (Windows) */
export function claudeArgs(model: string, systemFile: string | null, tools: string[], extraDirs: string[], effort?: Effort): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence']
  if (model && model !== 'default') args.push('--model', model)
  if (effort) args.push('--effort', effort === 'ultra' ? 'max' : effort === 'minimal' ? 'low' : effort)
  if (systemFile) args.push('--append-system-prompt-file', systemFile)
  // Разрешаем ровно выданные инструменты, остальное без вопросов запрещено
  args.push('--tools', tools.join(','), '--permission-mode', 'dontAsk')
  if (tools.length) args.push('--allowedTools', tools.join(','))
  for (const d of extraDirs) args.push('--add-dir', d)
  return args
}

export function codexArgs(model: string, sandbox: 'read-only' | 'workspace-write', effort?: Effort): string[] {
  // Рабочая папка задаётся cwd процесса — путь в аргументы не попадает
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', sandbox]
  if (model && model !== 'default') args.push('-m', model)
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`)
  args.push('-')
  return args
}

/** Окружение CLI: без API-ключей — иначе Claude Code тратит деньги с ключа вместо подписки */
export function subscriptionEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete env[k]
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const tools = toolsEnv(getToolsDir(), env[pathKey] ?? '')
  delete env[pathKey]
  return { ...env, PATH: tools.PATH, HEPHAESTUS_TOOLS: tools.HEPHAESTUS_TOOLS, NO_COLOR: '1' }
}

// ─── Разбор потоков событий ──────────────────────────────────────────────

interface ParseState {
  usage: Usage | null
  error?: string
  /** Текст уже пришёл по кусочкам — итоговое сообщение не дублируем */
  streamedText: boolean
  pendingTools: Map<string, string>
}

const newState = (): ParseState => ({ usage: null, streamedText: false, pendingTools: new Map() })

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => str(obj(c).text ?? c)).join('\n')
  return str(content)
}

/** Одна строка stream-json Claude Code → события Hephaestus */
export function parseClaudeLine(line: string, st: ParseState): LLMEvent[] {
  let e: Json
  try {
    e = JSON.parse(line)
  } catch {
    return []
  }
  const out: LLMEvent[] = []
  if (e.type === 'stream_event') {
    const ev = obj(e.event)
    if (ev.type === 'content_block_delta') {
      const d = obj(ev.delta)
      if (d.type === 'text_delta' && d.text) {
        st.streamedText = true
        out.push({ t: 'text', v: str(d.text) })
      } else if (d.type === 'thinking_delta' && d.thinking) out.push({ t: 'reasoning', v: str(d.thinking) })
    }
  } else if (e.type === 'assistant') {
    for (const block of (obj(e.message).content as unknown[]) ?? []) {
      const b = obj(block)
      if (b.type === 'tool_use') {
        const id = str(b.id)
        st.pendingTools.set(id, str(b.name))
        out.push({ t: 'tool_call', id, name: str(b.name), args: JSON.stringify(b.input ?? {}) })
      } else if (b.type === 'text' && b.text && !st.streamedText) out.push({ t: 'text', v: str(b.text) })
    }
    // Между шагами с инструментами текст снова пойдёт кусочками
    st.streamedText = false
  } else if (e.type === 'user') {
    for (const block of (obj(e.message).content as unknown[]) ?? []) {
      const b = obj(block)
      if (b.type !== 'tool_result') continue
      const id = str(b.tool_use_id)
      out.push({ t: 'tool_result', id, name: st.pendingTools.get(id) ?? 'tool', ok: !b.is_error, preview: toolResultText(b.content).slice(0, 600) })
    }
  } else if (e.type === 'result') {
    const u = obj(e.usage)
    const prompt = Number(u.input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0)
    st.usage = { promptTokens: prompt, completionTokens: Number(u.output_tokens ?? 0), cost: 0 }
    if (e.is_error || (e.subtype && e.subtype !== 'success')) st.error = str(e.result) || `Claude Code: ${str(e.subtype)}`
  }
  return out
}

/** Одна строка JSONL Codex (`codex exec --json`) → события Hephaestus */
export function parseCodexLine(line: string, st: ParseState): LLMEvent[] {
  let e: Json
  try {
    e = JSON.parse(line)
  } catch {
    return []
  }
  const out: LLMEvent[] = []
  const item = obj(e.item)
  const id = str(item.id)
  if (e.type === 'item.started' && item.type === 'command_execution') {
    st.pendingTools.set(id, 'run_command')
    out.push({ t: 'tool_call', id, name: 'run_command', args: JSON.stringify({ command: str(item.command) }) })
  } else if (e.type === 'item.completed') {
    if (item.type === 'agent_message') out.push({ t: 'text', v: str(item.text) })
    else if (item.type === 'reasoning' && item.text) out.push({ t: 'reasoning', v: `${str(item.text)}\n` })
    else if (item.type === 'command_execution') {
      if (!st.pendingTools.has(id)) out.push({ t: 'tool_call', id, name: 'run_command', args: JSON.stringify({ command: str(item.command) }) })
      out.push({ t: 'tool_result', id, name: 'run_command', ok: item.exit_code === 0 || item.status === 'completed', preview: str(item.aggregated_output).slice(-600) })
    } else if (item.type === 'file_change') {
      const changes = ((item.changes as unknown[]) ?? []).map((c) => `${str(obj(c).kind)} ${str(obj(c).path)}`)
      out.push({ t: 'tool_call', id, name: 'edit_file', args: JSON.stringify({ path: changes.join(', ') }) })
      out.push({ t: 'tool_result', id, name: 'edit_file', ok: item.status !== 'failed', preview: changes.join('\n') })
    } else if (item.type === 'web_search') {
      out.push({ t: 'tool_call', id, name: 'web_search', args: JSON.stringify({ query: str(item.query) }) })
      out.push({ t: 'tool_result', id, name: 'web_search', ok: true, preview: '' })
    } else if (item.type === 'error') st.error = str(item.message)
  } else if (e.type === 'turn.completed') {
    const u = obj(e.usage)
    st.usage = { promptTokens: Number(u.input_tokens ?? 0), completionTokens: Number(u.output_tokens ?? 0), cost: 0 }
  } else if (e.type === 'turn.failed') st.error = str(obj(e.error).message) || 'Codex: ход завершился ошибкой'
  else if (e.type === 'error') st.error = str(e.message) || 'Codex: ошибка'
  return out
}

function explain(id: SubscriptionId, error: string): string {
  const hint =
    id === 'codex'
      ? 'Войдите в подписку: выполните `codex login` в терминале на этом компьютере'
      : 'Войдите в подписку: запустите `claude` в терминале на этом компьютере и выполните /login'
  return /auth|login|log in|401|unauthori|credential|api key/i.test(error) ? `${error}\n${hint}` : error
}

/** На Windows CLI запускаются через cmd.exe: путь с пробелами берём в кавычки */
function winQuote(arg: string): string {
  return process.platform === 'win32' && /\s/.test(arg) ? `"${arg}"` : arg
}

async function emptyDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), 'hephaestus-empty')
  await fs.mkdir(/* turbopackIgnore: true */ dir, { recursive: true })
  return dir
}

/**
 * Запрос к модели подписки. cwd — рабочая папка проекта (или копия участника),
 * если модели выданы файловые инструменты; иначе пустая папка.
 */
export async function* runSubscription(req: LLMRequest, signal?: AbortSignal): AsyncGenerator<LLMEvent> {
  const id = providerOf(req.model) as SubscriptionId
  const cfg = await subscriptionConfig(id)
  if (!cfg.enabled) {
    yield { t: 'error', message: `Подписка ${LABELS[id]} выключена — включите её в настройках`, status: 400 }
    return
  }
  const model = upstreamModelId(req.model)
  const effort = splitEffort(req.model).effort
  if (!/^[\w.:@[\]-]{1,100}$/.test(model)) {
    yield { t: 'error', message: `Некорректное имя модели: ${model}`, status: 400 }
    return
  }
  const terminal = (await getTerminalSettings()).mode === 'full'
  const project = (req.tools ?? []).some((t) => t !== 'web' && t !== 'knowledge' && t !== 'skills')
  const cwd = project ? await getWorkspaceDir() : await emptyDir()
  const unsupported = (req.tools ?? []).filter((t) => t === 'knowledge' || t === 'skills')
  if (unsupported.length) yield { t: 'notice', v: 'База знаний и навыки Hephaestus моделям по подписке недоступны — у них свои инструменты' }

  const { system, prompt } = promptFromMessages(req.messages)
  const session = req.session ? await sessionContext(req.session, false).catch(() => '') : ''
  const fullSystem = [system, session, project ? `Рабочая папка проекта: ${cwd}. Общая папка инструментов: ${getToolsDir()}.` : ''].filter(Boolean).join('\n\n')

  let args: string[]
  let input = prompt
  let systemFile: string | null = null
  if (id === 'claude-code') {
    if (fullSystem) {
      systemFile = path.join(os.tmpdir(), `hephaestus-system-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`)
      await fs.writeFile(/* turbopackIgnore: true */ systemFile, fullSystem, 'utf8')
    }
    const dirs = project && !/["%^&|<>!]/.test(getToolsDir()) ? [getToolsDir()] : []
    args = claudeArgs(model, systemFile, claudeToolList(req.tools, terminal), dirs, effort).map(winQuote)
  } else {
    const write = (req.tools ?? []).some((t) => t === 'files_write' || (t === 'terminal' && terminal))
    args = codexArgs(model, write ? 'workspace-write' : 'read-only', effort)
    // У codex exec нет отдельного системного промпта — передаём инструкции в начале запроса
    if (fullSystem) input = `<instructions>\n${fullSystem}\n</instructions>\n\n${prompt}`
  }

  const child = spawn(cfg.bin, args, { cwd, env: subscriptionEnv(), shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const st = newState()
  const parse = id === 'codex' ? parseCodexLine : parseClaudeLine
  const queue: LLMEvent[] = []
  let wake: (() => void) | null = null
  let done = false
  let spawnError = ''
  let stderr = ''
  let buf = ''
  let exitCode: number | null = null
  const notify = () => {
    wake?.()
    wake = null
  }
  const kill = () => child.kill('SIGTERM')
  signal?.addEventListener('abort', kill)
  const timer = setTimeout(kill, MAX_RUN_MS)

  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    buf += d
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      queue.push(...parse(line, st))
      const limits = parseLimitLine(id, line)
      if (limits) void recordLimits(id, limits)
    }
    notify()
  })
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
  child.on('error', (e) => {
    spawnError = (e as NodeJS.ErrnoException).code === 'ENOENT' ? `${cfg.bin} не найден. Установите ${id === 'codex' ? 'Codex CLI (npm i -g @openai/codex)' : 'Claude Code (npm i -g @anthropic-ai/claude-code)'} или укажите путь в настройках` : e.message
  })
  child.on('close', (code) => {
    exitCode = code
    if (buf.trim()) queue.push(...parse(buf.trim(), st))
    done = true
    notify()
  })
  child.stdin.on('error', () => {})
  child.stdin.end(input)

  try {
    while (true) {
      while (queue.length) yield queue.shift()!
      if (done) break
      await new Promise<void>((r) => (wake = r))
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', kill)
    if (!done) kill()
    if (systemFile) void fs.rm(/* turbopackIgnore: true */ systemFile, { force: true })
  }
  if (signal?.aborted) return
  if (st.usage) yield { t: 'usage', usage: st.usage, model: req.model }
  const error = spawnError || st.error || (exitCode !== 0 ? stderr.trim() || `CLI завершился с кодом ${exitCode}` : '')
  if (error) {
    void recordExhausted(id, error)
    yield { t: 'error', message: explain(id, error), status: 502 }
    return
  }
  yield { t: 'done', finish: 'stop' }
}
