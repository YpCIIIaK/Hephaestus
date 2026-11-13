import type { Agent } from '../agents'
import { asString, extractJson } from '../json'
import { addUsage, ZERO_USAGE } from '../models'
import { renderTemplate } from '../template'
import type { LLMEvent, LLMResult, ToolsetId, ToolTrace, Usage } from '../types'
import { isAbort, throwIfAborted, type DecideCall, type LLMCall } from './llm'
import { detectRefusal, REFUSAL_CLARIFICATION } from './refusal'

/** С какой вероятностью «да» модель решений принимает ответ без LLM; ниже — решает LLM и пишет замечания */
const DECIDER_PASS = 0.7

// ─── Модель графа ────────────────────────────────────────────────────────

export type NodeKind = 'input' | 'agent' | 'foreach' | 'command' | 'search' | 'knowledge' | 'file' | 'router' | 'merge' | 'validator' | 'write' | 'output'

export interface RouteDef {
  id: string
  label: string
  /** Для режима «ключевые слова»: слова через запятую */
  keywords?: string
}

export interface NodeConfig {
  // Агент / модель
  agentId?: string
  model?: string
  systemPrompt?: string
  prompt?: string
  temperature?: number
  maxTokens?: number
  tools?: ToolsetId[]
  jsonMode?: boolean
  fallbackModels?: string[]
  retries?: number
  // Поиск / знания / файлы
  query?: string
  limit?: number
  readPages?: number
  path?: string
  // Маршрутизатор
  routerMode?: 'llm' | 'keyword'
  routes?: RouteDef[]
  // Объединение / выход
  template?: string
  /** Вход: подсказка, что писать при запуске */
  hint?: string
  // Проверка
  criteria?: string
  maxAttempts?: number
  /** Проверка командой: прошло, если команда завершилась с кодом 0 (например, тесты) */
  checkCommand?: string
  // Агент: своя копия проекта — правки не трогают оригинал, пока их не примут
  isolate?: boolean
  // Команда
  command?: string
  cwd?: string
  timeoutSec?: number
  /** Ненулевой код выхода не считать ошибкой */
  allowFail?: boolean
  /** Выполнить в копии проекта другого узла (id агента со своей копией); по умолчанию — копия входящего узла, если есть */
  sandboxFrom?: string
  // Для каждого
  splitBy?: 'lines' | 'blocks' | 'json'
  /** Сколько элементов обрабатывать одновременно */
  concurrency?: number
  /** «Для каждого»: брать элементы из файла (путь в папке проекта), а не из ответа предыдущего блока */
  itemsFile?: string
}

export interface PipelineNode {
  id: string
  kind: NodeKind
  label: string
  position: { x: number; y: number }
  config: NodeConfig
}

export interface PipelineEdge {
  id: string
  source: string
  target: string
  /** Для маршрутизатора — id ветки */
  sourceHandle?: string | null
}

export interface Pipeline {
  id: string
  name: string
  description: string
  emoji: string
  interactions?: boolean
  /** Общая память запуска: блоки записывают находки (session_note) и видят записи друг друга. По умолчанию включена */
  sharedMemory?: boolean
  /**
   * Папка проекта для всех блоков — подпапка рабочей папки, можно шаблоном
   * ({{Выбор репозитория.target}}). Агенты, команды и файлы работают в ней,
   * как будто это и есть рабочая папка. Пока шаблон не вычислен — вся рабочая папка.
   */
  workdir?: string
  /** Общая инструкция: добавляется к системному промпту каждого агента (можно шаблоны) */
  sharedPrompt?: string
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  createdAt: string
  updatedAt: string
}

// ─── Состояние запуска ───────────────────────────────────────────────────

export type NodeStatus = 'idle' | 'running' | 'done' | 'skipped' | 'error'

export interface NodeRun {
  status: NodeStatus
  /** Exact context and prompt supplied to this node during the latest attempt. */
  received?: { label: string; output: string }[]
  prompt?: string
  systemPrompt?: string
  output?: string
  error?: string
  note?: string
  startedAt?: number
  endedAt?: number
  usage?: Usage
  model?: string
  attempts?: number
  route?: string
  tools?: ToolTrace[]
  reasoning?: string
  /** Копия проекта, в которой работал узел (id из /api/sandboxes) */
  sandbox?: string
  /** «Для каждого»: сколько элементов обработано */
  items?: { done: number; total: number; failed: number }
  /** «Для каждого»: результат по каждому элементу — при перезапуске успешные не пересчитываются */
  itemResults?: { item: string; text: string; ok: boolean; pending?: boolean }[]
  /** Модели, которые отказались выполнять задачу блока */
  refusals?: string[]
  /** Результат взят из прошлого запуска (перезапуск с блока или «повторить упавшие») */
  reused?: boolean
}

export interface PipelineRun {
  id: string
  pipelineId: string
  pipelineName: string
  input: string
  status: 'running' | 'done' | 'error' | 'aborted'
  startedAt: number
  endedAt?: number
  nodes: Record<string, NodeRun>
  output?: string
  error?: string
  usage: Usage
  /** id общей памяти запуска (/api/sessions); перезапуск продолжает ту же память */
  memoryId?: string
  interactions?: { nodeId: string; label: string; text: string; at: number }[]
}

export interface PipelineDeps {
  llm: LLMCall
  /** Модель решений для маршрутизаторов и проверок; без неё решает LLM */
  decide?: DecideCall
  tool: (name: string, args: Record<string, unknown>, signal?: AbortSignal, opts?: { sandbox?: string; root?: string }) => Promise<{ ok: boolean; output: string }>
  /** Создаёт копию проекта для узла со «своей копией» */
  sandbox?: { create: (label: string) => Promise<string> }
  getAgent: (id: string) => Agent | undefined
  /** Модели по умолчанию для маршрутизатора и проверки, если в узле модель не выбрана */
  defaults?: { router?: string; validator?: string }
}

export interface PipelineHooks {
  onNode?: (nodeId: string, patch: Partial<NodeRun>) => void
  onInteraction?: (entry: NonNullable<PipelineRun['interactions']>[number]) => void
  /** Вызывается перед запуском каждого узла; пошаговый режим ждёт здесь нажатия «Дальше» */
  beforeNode?: (node: PipelineNode) => Promise<void>
}

export const NODE_META: Record<NodeKind, { title: string; hint: string }> = {
  input: { title: 'Вход', hint: 'Запрос пользователя — {{input}}' },
  agent: { title: 'Агент', hint: 'Вызов модели или агента из библиотеки' },
  foreach: { title: 'Для каждого', hint: 'Разбивает вход на элементы и обрабатывает их агентом параллельно' },
  command: { title: 'Команда', hint: 'Запускает команду терминала без модели: сканеры, тесты, сборка' },
  search: { title: 'Веб-поиск', hint: 'Ищет в интернете и читает страницы' },
  knowledge: { title: 'База знаний', hint: 'Достаёт фрагменты из ваших документов' },
  file: { title: 'Файл', hint: 'Читает файл из workspace' },
  router: { title: 'Маршрутизатор', hint: 'Выбирает одну ветку по смыслу или ключевым словам' },
  merge: { title: 'Объединение', hint: 'Склеивает входы по шаблону, без модели' },
  validator: { title: 'Проверка', hint: 'Проверяет ответ по критериям и отправляет на доработку' },
  write: { title: 'Запись в файл', hint: 'Сохраняет результат в workspace' },
  output: { title: 'Результат', hint: 'Итог пайплайна' },
}

// ─── Анализ графа ────────────────────────────────────────────────────────

export function findCycle(nodes: PipelineNode[], edges: PipelineEdge[]): string[] | null {
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const e of edges) adj.get(e.source)?.push(e.target)
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const dfs = (id: string): string[] | null => {
    state.set(id, 1)
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0
      if (s === 1) return stack.slice(stack.indexOf(next))
      if (s === 0) {
        const c = dfs(next)
        if (c) return c
      }
    }
    stack.pop()
    state.set(id, 2)
    return null
  }
  for (const n of nodes) {
    if ((state.get(n.id) ?? 0) === 0) {
      const c = dfs(n.id)
      if (c) return c
    }
  }
  return null
}

export interface GraphIssue {
  nodeId?: string
  level: 'error' | 'warning'
  message: string
}

export function validatePipeline(p: Pick<Pipeline, 'nodes' | 'edges'>): GraphIssue[] {
  const issues: GraphIssue[] = []
  if (!p.nodes.length) return [{ level: 'error', message: 'Пайплайн пуст — добавьте узлы' }]
  const cycle = findCycle(p.nodes, p.edges)
  if (cycle) {
    const names = cycle.map((id) => p.nodes.find((n) => n.id === id)?.label ?? id)
    issues.push({ level: 'error', nodeId: cycle[0], message: `Цикл: ${names.join(' → ')}. Для повторов используйте узел «Проверка»` })
  }
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  for (const e of p.edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1)
  }
  for (const n of p.nodes) {
    if (n.kind === 'command' && !n.config.command?.trim()) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: не указана команда` })
    if (n.kind === 'foreach' && !n.config.agentId && !n.config.model) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: не выбрана модель или агент` })
    if (n.kind === 'agent' && !n.config.agentId && !n.config.model) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: не выбрана модель или агент` })
    if (n.kind === 'router') {
      const routes = n.config.routes ?? []
      if (routes.length < 2) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: нужно минимум две ветки` })
      for (const r of routes) {
        if (!p.edges.some((e) => e.source === n.id && e.sourceHandle === r.id)) {
          issues.push({ level: 'warning', nodeId: n.id, message: `«${n.label}»: ветка «${r.label}» никуда не ведёт` })
        }
      }
    }
    if (n.kind === 'file' && !n.config.path) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: не указан путь к файлу` })
    if (n.kind === 'write' && !n.config.path) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: не указан путь для записи` })
    if (n.kind === 'validator' && !(incoming.get(n.id) ?? 0)) issues.push({ level: 'error', nodeId: n.id, message: `«${n.label}»: проверке нечего проверять — подключите вход` })
    if (n.kind !== 'input' && !(incoming.get(n.id) ?? 0) && !(outgoing.get(n.id) ?? 0) && p.nodes.length > 1) {
      issues.push({ level: 'warning', nodeId: n.id, message: `«${n.label}» ни с чем не соединён` })
    }
  }
  return issues
}

// ─── Исполнение ──────────────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 4

interface ExecContext {
  input: string
  prevText: string
  prevParts: { label: string; output: string }[]
  byLabel: Record<string, string>
}

function joinParts(parts: { label: string; output: string }[]): string {
  if (parts.length === 1) return parts[0].output
  return parts.map((p) => `### ${p.label}\n${p.output}`).join('\n\n')
}

export function effectiveAgentConfig(node: PipelineNode, getAgent: PipelineDeps['getAgent']) {
  const agent = node.config.agentId ? getAgent(node.config.agentId) : undefined
  const c = node.config
  return {
    model: c.model || agent?.model || '@default',
    systemPrompt: c.systemPrompt?.trim() ? c.systemPrompt : agent?.systemPrompt ?? '',
    temperature: c.temperature ?? agent?.temperature ?? 0.7,
    maxTokens: c.maxTokens ?? agent?.maxTokens ?? 2000,
    tools: c.tools?.length ? c.tools : agent?.tools ?? [],
    agentName: agent?.name,
  }
}

/** Блоки, которые нужно выполнить заново: выбранные и всё, что от них зависит */
export function rerunSet(pipeline: Pick<Pipeline, 'edges'>, seeds: string[]): Set<string> {
  const out = new Set(seeds)
  const stack = [...seeds]
  while (stack.length) {
    const id = stack.pop()!
    for (const e of pipeline.edges) if (e.source === id && !out.has(e.target)) out.add(e.target), stack.push(e.target)
  }
  return out
}

/** Результаты прошлого запуска, которые берутся как есть: всё, что не зависит от перезапускаемых блоков */
export function reusedNodes(pipeline: Pick<Pipeline, 'nodes' | 'edges'>, previous: PipelineRun, rerun: string[]): Record<string, NodeRun> {
  const redo = rerunSet(pipeline, rerun)
  const out: Record<string, NodeRun> = {}
  for (const n of pipeline.nodes) {
    const old = previous.nodes[n.id]
    if (old && !redo.has(n.id) && (old.status === 'done' || old.status === 'skipped')) out[n.id] = { ...old, reused: true }
  }
  return out
}

/** Упавшие и незавершённые блоки прошлого запуска — для «Повторить упавшие» */
export function failedNodes(run: PipelineRun): string[] {
  return Object.entries(run.nodes)
    .filter(([, r]) => r.status === 'error' || r.status === 'idle' || r.status === 'running' || (r.items?.failed ?? 0) > 0)
    .map(([id]) => id)
}

export async function runPipeline(
  pipeline: Pick<Pipeline, 'id' | 'name' | 'nodes' | 'edges' | 'interactions' | 'sharedMemory' | 'workdir' | 'sharedPrompt'>,
  input: string,
  deps: PipelineDeps,
  hooks: PipelineHooks = {},
  opts: { signal?: AbortSignal; concurrency?: number; runId?: string; resume?: { previous: PipelineRun; rerun: string[] } } = {},
): Promise<PipelineRun> {
  const { nodes, edges } = pipeline
  const signal = opts.signal
  const runId = opts.runId ?? `run_${Date.now().toString(36)}`
  // Перезапуск: всё, что не зависит от выбранных блоков, берём из прошлого запуска как есть
  const previous = opts.resume?.previous
  const reused = previous ? reusedNodes(pipeline, previous, opts.resume!.rerun) : {}
  const run: PipelineRun = {
    id: runId,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    input,
    status: 'running',
    startedAt: Date.now(),
    nodes: Object.fromEntries(nodes.map((n) => [n.id, reused[n.id] ?? ({ status: 'idle' } as NodeRun)])),
    usage: { ...ZERO_USAGE },
    memoryId: pipeline.sharedMemory === false ? undefined : (previous?.memoryId ?? runId.replace(/[^\w-]/g, '_')),
    interactions: [],
  }

  const update = (id: string, patch: Partial<NodeRun>) => {
    run.nodes[id] = { ...run.nodes[id], ...patch }
    hooks.onNode?.(id, patch)
  }

  const cycle = findCycle(nodes, edges)
  if (cycle) {
    run.status = 'error'
    run.error = 'В графе есть цикл'
    run.endedAt = Date.now()
    return run
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inEdges = new Map<string, PipelineEdge[]>(nodes.map((n) => [n.id, []]))
  for (const e of edges) if (byId.has(e.source) && byId.has(e.target)) inEdges.get(e.target)!.push(e)

  const terminal = (s: NodeStatus) => s === 'done' || s === 'skipped' || s === 'error'
  const edgeActive = (e: PipelineEdge) => {
    const src = run.nodes[e.source]
    if (src.status !== 'done') return false
    const srcNode = byId.get(e.source)!
    if (srcNode.kind === 'router') return !!e.sourceHandle && e.sourceHandle === src.route
    return true
  }

  const byLabel = () => {
    const out: Record<string, string> = {}
    for (const n of nodes) {
      const r = run.nodes[n.id]
      if (r.status === 'done' && r.output != null) out[n.label] = r.output
    }
    return out
  }

  const contextFor = (node: PipelineNode): ExecContext => {
    const parts = inEdges
      .get(node.id)!
      .filter(edgeActive)
      .map((e) => ({ label: byId.get(e.source)!.label, output: run.nodes[e.source].output ?? '' }))
    return { input, prevParts: parts, prevText: parts.length ? joinParts(parts) : input, byLabel: byLabel() }
  }

  const render = (tpl: string | undefined, ctx: ExecContext, fallback: string) =>
    tpl?.trim() ? renderTemplate(tpl, { input: ctx.input, prev: ctx.prevText, byLabel: ctx.byLabel }) : fallback

  /** Папка проекта для блока: шаблон из настроек пайплайна; не вычислен или «.» — вся рабочая папка */
  const rootFor = (ctx: ExecContext): string | undefined => {
    const r = render(pipeline.workdir, ctx, '').trim()
    return !r || r === '.' || r.includes('{{') ? undefined : r
  }

  const addRunUsage = (u?: Usage) => {
    if (u) run.usage = addUsage(run.usage, u)
  }

  // Вызов модели с повторами и запасными моделями
  const callAgent = async (node: PipelineNode, ctx: ExecContext, extraFeedback?: string, override: { user?: string; quiet?: boolean; tag?: string } = {}): Promise<LLMResult> => {
    const cfg = effectiveAgentConfig(node, deps.getAgent)
    let user = override.user ?? render(node.config.prompt, ctx, ctx.prevText)
    // Параллельные вызовы «Для каждого» не пишут поток в один и тот же узел
    const show = override.quiet ? () => {} : (patch: Partial<NodeRun>) => update(node.id, patch)
    const sandbox = node.config.isolate ? await ensureSandbox(node) : undefined
    const shared = ctx.prevParts.map((part) => `### ${part.label}\n${part.output}`).join('\n\n')
    const conversation = pipeline.interactions ? run.interactions!.filter((entry) => entry.nodeId !== node.id).map((entry) => `${entry.label}: ${entry.text}`).join('\n\n') : ''
    const common = render(pipeline.sharedPrompt, ctx, '').trim()
    const root = rootFor(ctx)
    const systemPrompt = [cfg.systemPrompt, common, shared && `Контекст от других узлов этого пайплайна:\n\n${shared}`, conversation && `Общий разговор агентов этого пайплайна. Ты видишь ответы других участников; учитывай их и явно обращайся к ним по имени, если дополняешь или оспариваешь вывод:\n\n${conversation}`].filter(Boolean).join('\n\n')
    if (extraFeedback) user += `\n\n---\n${extraFeedback}`
    const messages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user' as const, content: user },
    ]
    show({ prompt: user, systemPrompt })
    const models = [cfg.model, ...(node.config.fallbackModels ?? []).filter(Boolean)]
    const retries = Math.max(0, Math.min(node.config.retries ?? 1, 5))
    let lastError = 'Неизвестная ошибка'
    const refusals: string[] = []
    let streamed = ''
    let reasoning = ''
    const tools: ToolTrace[] = []
    for (const model of models) {
      let clarified = false
      for (let attempt = 0; attempt <= retries; attempt++) {
        throwIfAborted(signal)
        streamed = ''
        reasoning = ''
        show({ model, output: '', note: attempt ? `Повтор ${attempt}` : model !== cfg.model ? `Запасная модель` : undefined })
        const onEvent = (e: LLMEvent) => {
          if (e.t === 'text') {
            streamed += e.v
            show({ output: streamed })
          } else if (e.t === 'reasoning') {
            reasoning += e.v
            show({ reasoning })
          } else if (e.t === 'tool_call') {
            tools.push({ id: e.id, name: e.name, args: e.args })
            show({ tools: [...tools] })
          } else if (e.t === 'tool_result') {
            const t = tools.find((x) => x.id === e.id)
            if (t) Object.assign(t, { ok: e.ok, preview: e.preview })
            show({ tools: [...tools] })
          }
        }
        const res = await deps.llm(
          {
            model,
            messages: clarified ? [...messages, { role: 'user' as const, content: REFUSAL_CLARIFICATION }] : messages,
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            tools: cfg.tools,
            jsonMode: node.config.jsonMode,
            sandbox,
            root,
            session: run.memoryId,
            sessionAuthor: override.tag ? `${node.label} · ${override.tag}` : node.label,
          },
          { signal, onEvent, meta: { source: 'pipeline', label: node.label } },
        )
        addRunUsage(res.usage)
        if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
        if (!res.error) {
          // Отказ — не ошибка API, но и не результат: один повтор с уточнением задачи, потом следующая модель
          const refusal = detectRefusal(res.text, res.tools.length)
          if (!refusal) return res
          refusals.push(model)
          if (!override.quiet) update(node.id, { refusals: [...refusals] })
          lastError = refusal === 'empty' ? `Модель ${model} вернула пустой ответ` : `Модель ${model} отказалась: ${res.text.trim().slice(0, 300)}`
          if (refusal === 'refusal' && !clarified) {
            clarified = true
            show({ note: `Отказ ${model} — повтор с уточнением задачи` })
            attempt-- // повтор с уточнением не расходует попытки на ошибки
            continue
          }
          break
        }
        lastError = res.error
        // Ошибки ключа и бюджета повторять бессмысленно
        if (/ключ|бюджет|лимит расходов|401|402/i.test(res.error)) throw new Error(res.error)
        if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
      }
    }
    throw new Error(refusals.length ? `${lastError}${models.length > 1 ? ' (запасные модели тоже не справились)' : ' — добавьте блоку запасную модель'}` : lastError)
  }

  // Своя копия проекта узла: создаётся один раз за запуск, доработки после проверки идут в ней же
  const sandboxes = new Map<string, Promise<string>>()
  const ensureSandbox = (node: PipelineNode): Promise<string> => {
    if (!deps.sandbox) throw new Error('Своя копия проекта недоступна в этом режиме запуска')
    let p = sandboxes.get(node.id)
    if (!p) {
      p = deps.sandbox.create(`${pipeline.name}: ${node.label}`).then((id) => {
        update(node.id, { sandbox: id })
        return id
      })
      sandboxes.set(node.id, p)
    }
    return p
  }

  /** В какой копии выполнять команду: указанной в узле или входящего узла со своей копией */
  const sandboxFor = (node: PipelineNode): string | undefined => {
    if (node.config.sandboxFrom) return run.nodes[node.config.sandboxFrom]?.sandbox
    for (const e of inEdges.get(node.id)!) if (edgeActive(e) && run.nodes[e.source].sandbox) return run.nodes[e.source].sandbox
    return undefined
  }

  const runShell = async (node: PipelineNode, command: string, ctx: ExecContext) => {
    const sandbox = sandboxFor(node)
    // Папку можно задать шаблоном: например, {{Выбор репозитория.target}}
    const cwd = render(node.config.cwd, ctx, '').trim()
    const r = await deps.tool('run_command', { command, cwd: cwd || undefined, timeout_sec: node.config.timeoutSec, raw: true }, signal, { sandbox, root: rootFor(ctx) })
    return { ...r, sandbox }
  }

  /** Отправляет на доработку все агенты, которые подали ответ в проверку; возвращает новый кандидат */
  const reviseUpstream = async (agents: PipelineNode[], attempt: number, feedback: string, checker: PipelineNode): Promise<string> => {
    for (const agentNode of agents) {
      const agentCtx = contextFor(agentNode)
      update(agentNode.id, { status: 'running', note: `Доработка ${attempt}` })
      const prevAnswer = run.nodes[agentNode.id].output ?? ''
      const res2 = await callAgent(
        agentNode,
        agentCtx,
        `Твой предыдущий результат не прошёл проверку.\n\nПредыдущий ответ:\n${prevAnswer}\n\nЗамечания проверки:\n${feedback}\n\nИсправь с учётом замечаний и выдай полную новую версию.`,
      )
      update(agentNode.id, { status: 'done', output: res2.text, attempts: attempt + 1, note: `Версия ${attempt + 1}` })
    }
    return joinParts(
      inEdges
        .get(checker.id)!
        .filter(edgeActive)
        .map((e) => ({ label: byId.get(e.source)!.label, output: run.nodes[e.source].output ?? '' })),
    )
  }

  const execute = async (node: PipelineNode): Promise<Partial<NodeRun>> => {
    const ctx = contextFor(node)
    update(node.id, { received: ctx.prevParts })
    switch (node.kind) {
      case 'input':
        return { output: input }

      case 'agent': {
        const res = await callAgent(node, ctx)
        if (pipeline.interactions) {
          const entry = { nodeId: node.id, label: node.label, text: res.text, at: Date.now() }
          run.interactions!.push(entry)
          hooks.onInteraction?.(entry)
        }
        return { output: res.text, usage: res.usage, model: res.model }
      }

      case 'command': {
        const command = render(node.config.command, ctx, '').trim()
        if (!command) throw new Error('Пустая команда')
        update(node.id, { prompt: command })
        const r = await runShell(node, command, ctx)
        throwIfAborted(signal)
        const where = r.sandbox ? ' · в копии проекта' : ''
        if (!r.ok && !node.config.allowFail) throw new Error(`Команда завершилась с ошибкой${where}:\n${r.output.slice(-3000)}`)
        return { output: r.output, note: `${r.ok ? 'код выхода 0' : 'ошибка, но разрешено'}${where}` }
      }

      case 'foreach': {
        // Элементы — из файла, если он задан и читается (модели часто пишут список в файл, а отвечают текстом)
        let source = ctx.prevText
        let from = ''
        const file = render(node.config.itemsFile, ctx, '').trim()
        if (file) {
          const r = await deps.tool('read_file', { path: file, raw: true }, signal, { root: rootFor(ctx) })
          if (r.ok && r.output.trim()) {
            source = r.output
            from = ` · из ${file}`
          }
        }
        let parsed: string[]
        try {
          parsed = splitItems(source, node.config.splitBy ?? 'blocks')
        } catch (e) {
          throw new Error(`${e instanceof Error ? e.message : String(e)}. ${file ? `Файл ${file} не найден или пуст, а ` : ''}Предыдущий блок ответил текстом без массива — пусть он отвечает только JSON-массивом${file ? '' : ', или укажите в блоке «Элементы из файла», куда он сохраняет список'}`)
        }
        const items = parsed.slice(0, Math.max(1, Math.min(node.config.limit ?? 20, 200)))
        if (!items.length) return { output: 'Нет элементов для обработки', note: '0 элементов' }
        const parallel = Math.max(1, Math.min(node.config.concurrency ?? 3, 10))
        const results: string[] = new Array(items.length)
        const itemResults: NonNullable<NodeRun['itemResults']> = new Array(items.length)
        // Перезапуск: успешные элементы прошлого запуска не пересчитываем
        const cached = new Map((previous?.nodes[node.id]?.itemResults ?? []).filter((r) => r?.ok).map((r) => [r.item, r.text]))
        let usage: Usage = { ...ZERO_USAGE }
        let done = 0
        let failed = 0
        let reusedItems = 0
        update(node.id, { items: { done, total: items.length, failed }, note: `0 из ${items.length}${from}` })
        let next = 0
        const worker = async () => {
          while (next < items.length) {
            const i = next++
            throwIfAborted(signal)
            const user = render((node.config.prompt?.trim() || '{{item}}').replace(/\{\{\s*(item|элемент)\s*\}\}/gi, () => items[i]).replace(/\{\{\s*(index|номер)\s*\}\}/gi, String(i + 1)), ctx, items[i])
            const hit = cached.get(items[i])
            if (hit != null) {
              reusedItems++
              results[i] = hit
              itemResults[i] = { item: items[i], text: hit, ok: true }
            } else {
              try {
                const res = await callAgent(node, ctx, undefined, { user, quiet: true, tag: `элемент ${i + 1}` })
                usage = addUsage(usage, res.usage)
                results[i] = res.text
                itemResults[i] = { item: items[i], text: res.text, ok: true }
              } catch (e) {
                if (isAbort(e) || signal?.aborted) throw e
                failed++
                results[i] = `[ошибка: ${e instanceof Error ? e.message : String(e)}]`
                itemResults[i] = { item: items[i], text: results[i], ok: false }
              }
            }
            done++
            // Результаты по элементам — по мере готовности: в логах блока видно, что уже проверено
            update(node.id, { items: { done, total: items.length, failed }, itemResults: Array.from(itemResults, (r, k) => r ?? { item: items[k], text: '', ok: false, pending: true }), note: `${done} из ${items.length}${failed ? `, ошибок ${failed}` : ''}` })
          }
        }
        await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker))
        if (failed === items.length) throw new Error(`Все ${items.length} элементов завершились ошибкой: ${results[0]}`)
        const title = (item: string) => itemTitle(item)
        const tail = `${failed ? `, ошибок ${failed}` : ''}${reusedItems ? `, из прошлого запуска ${reusedItems}` : ''}${from}`
        return { output: results.map((r, i) => `### ${i + 1}. ${title(items[i])}\n${r}`).join('\n\n'), usage, itemResults, note: `${done} из ${items.length}${tail}` }
      }

      case 'search': {
        const query = render(node.config.query, ctx, ctx.prevText).slice(0, 400)
        const found = await deps.tool('web_search', { query }, signal)
        if (!found.ok) throw new Error(found.output)
        let out = `Запрос: ${query}\n\n${found.output}`
        const pages = Math.max(0, Math.min(node.config.readPages ?? 0, 5))
        if (pages) {
          const urls = Array.from(found.output.matchAll(/^(https?:\/\/\S+)$/gm), (m) => m[1]).slice(0, pages)
          const texts = await Promise.all(urls.map((url) => deps.tool('fetch_url', { url }, signal)))
          out += texts.filter((t) => t.ok).map((t) => `\n\n---\n${t.output.slice(0, 6000)}`).join('')
        }
        return { output: out, note: query }
      }

      case 'knowledge': {
        const query = render(node.config.query, ctx, ctx.prevText).slice(0, 1000)
        const r = await deps.tool('knowledge_search', { query, limit: node.config.limit ?? 5 }, signal)
        if (!r.ok) throw new Error(r.output)
        return { output: r.output, note: query }
      }

      case 'file': {
        const path = render(node.config.path, ctx, '')
        const r = await deps.tool('read_file', { path }, signal, { root: rootFor(ctx) })
        if (!r.ok) throw new Error(r.output)
        return { output: r.output, note: path }
      }

      case 'write': {
        const path = render(node.config.path, ctx, '')
        const content = render(node.config.template, ctx, ctx.prevText)
        const r = await deps.tool('write_file', { path, content }, signal, { root: rootFor(ctx) })
        if (!r.ok) throw new Error(r.output)
        return { output: content, note: r.output }
      }

      case 'merge':
        return { output: render(node.config.template, ctx, ctx.prevText) }

      case 'output':
        return { output: render(node.config.template, ctx, ctx.prevText) }

      case 'router': {
        const routes = node.config.routes ?? []
        if (!routes.length) throw new Error('Нет веток')
        const text = ctx.prevText
        if (node.config.routerMode === 'keyword') {
          const lower = text.toLowerCase()
          const hit =
            routes.find((r) =>
              (r.keywords ?? '')
                .split(',')
                .map((k) => k.trim().toLowerCase())
                .filter(Boolean)
                .some((k) => lower.includes(k)),
            ) ?? routes[routes.length - 1]
          return { output: text, route: hit.id, note: `→ ${hit.label}` }
        }
        // Модель решений выбирает ветку сразу с вероятностью — без генерации и разбора JSON
        if (deps.decide) {
          const d = await deps.decide(
            {
              state: text.slice(0, 32_000),
              questions: {
                route: {
                  type: 'choice',
                  instructions: 'Какой ветке обработки лучше всего подходит этот текст?',
                  criteria: Object.fromEntries(routes.map((r) => [r.id, `${r.label}${r.keywords ? `: ${r.keywords}` : ''}`])),
                },
              },
            },
            { signal, meta: { source: 'pipeline', label: node.label } },
          )
          addRunUsage(d.usage)
          throwIfAborted(signal)
          const a = d.answers.route
          const chosen = a?.type === 'choice' ? routes.find((r) => r.id === a.choice) : undefined
          if (!d.error && chosen) {
            const p = a?.type === 'choice' ? (a.probabilities[a.choice] ?? a.confidence) : 0
            return { output: text, route: chosen.id, usage: d.usage, note: `→ ${chosen.label} (модель решений, ${Math.round(p * 100)}%)` }
          }
        }
        const cfg = effectiveAgentConfig(node, deps.getAgent)
        const list = routes.map((r, i) => `${i + 1}. ${r.label}${r.keywords ? ` — ${r.keywords}` : ''}`).join('\n')
        const res = await deps.llm(
          {
            model: node.config.model || deps.defaults?.router || '@fast',
            temperature: 0,
            maxTokens: 300,
            jsonMode: true,
            messages: [
              {
                role: 'system',
                content: `${cfg.systemPrompt ? cfg.systemPrompt + '\n\n' : ''}Ты — маршрутизатор. Выбери ровно одну ветку, которая лучше всего подходит для текста. Ответь JSON: {"route": <номер ветки>, "reason": "<коротко почему>"}`,
              },
              { role: 'user', content: `Ветки:\n${list}\n\nТекст:\n${text.slice(0, 8000)}` },
            ],
          },
          { signal, meta: { source: 'pipeline', label: node.label } },
        )
        addRunUsage(res.usage)
        if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
        if (res.error) throw new Error(res.error)
        const parsed = extractJson<{ route?: unknown; reason?: unknown }>(res.text)
        const idx = Number(parsed?.route ?? res.text.match(/\d+/)?.[0]) - 1
        const byName = routes.find((r) => res.text.toLowerCase().includes(r.label.toLowerCase()))
        const chosen = routes[idx] ?? byName ?? routes[0]
        return { output: text, route: chosen.id, usage: res.usage, note: `→ ${chosen.label}${parsed?.reason ? `: ${asString(parsed.reason)}` : ''}` }
      }

      case 'validator': {
        const maxAttempts = Math.max(1, Math.min(node.config.maxAttempts ?? 2, 5))
        const criteria = node.config.criteria?.trim() || 'Ответ полный, точный, без фактических ошибок и отвечает на исходный запрос.'
        const upstreamAgents = inEdges
          .get(node.id)!
          .filter(edgeActive)
          .map((e) => byId.get(e.source)!)
          .filter((n) => n.kind === 'agent')
        let candidate = ctx.prevText
        let feedback = ''
        const checkCommand = render(node.config.checkCommand, ctx, '').trim()
        for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
          throwIfAborted(signal)
          update(node.id, { attempts: attempt, note: `Проверка ${attempt}` })
          if (checkCommand) {
            // Проверка командой: решает код выхода (тесты, сборка, повторный скан), а не мнение модели
            const r = await runShell(node, checkCommand, ctx)
            throwIfAborted(signal)
            if (r.ok) return { output: candidate, attempts: attempt, note: `Команда проверки прошла с ${attempt}-й попытки${r.sandbox ? ' (в копии проекта)' : ''}` }
            feedback = `Команда проверки \`${checkCommand}\` завершилась с ошибкой. Вывод (конец):\n${r.output.slice(-4000)}`
            if (attempt > maxAttempts || !upstreamAgents.length) break
            candidate = await reviseUpstream(upstreamAgents, attempt, feedback, node)
            continue
          }
          // Модель решений принимает хороший ответ сразу; замечания для доработки пишет только LLM
          if (deps.decide) {
            const d = await deps.decide(
              {
                state: { request: input.slice(0, 16_000), criteria, answer: candidate.slice(0, 32_000) },
                questions: {
                  pass: {
                    type: 'noul',
                    instructions: 'Соответствует ли answer критериям criteria и отвечает ли на request?',
                    criteria: { true: 'Ответ выполняет все критерии и отвечает на запрос.', false: 'Есть нарушения критериев, ошибки или ответ не по запросу.' },
                  },
                },
              },
              { signal, meta: { source: 'pipeline', label: node.label } },
            )
            addRunUsage(d.usage)
            throwIfAborted(signal)
            const a = d.answers.pass
            if (!d.error && a?.type === 'noul' && a.noul >= DECIDER_PASS) {
              return { output: candidate, attempts: attempt, note: `Принято с ${attempt}-й попытки (модель решений, ${Math.round(a.noul * 100)}%)` }
            }
          }
          const res = await deps.llm(
            {
              model: node.config.model || deps.defaults?.validator || '@smart',
              temperature: 0,
              maxTokens: 800,
              jsonMode: true,
              messages: [
                {
                  role: 'system',
                  content:
                    'Ты — строгий проверяющий. Оцени ответ по критериям. Верни JSON: {"pass": true|false, "score": 0-10, "feedback": "<что именно исправить, если не прошёл>"}',
                },
                { role: 'user', content: `Исходный запрос:\n${input}\n\nКритерии:\n${criteria}\n\nОтвет на проверку:\n${candidate}` },
              ],
            },
            { signal, meta: { source: 'pipeline', label: node.label } },
          )
          addRunUsage(res.usage)
          if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
          if (res.error) throw new Error(res.error)
          const verdict = extractJson<{ pass?: unknown; score?: unknown; feedback?: unknown }>(res.text)
          const pass = verdict?.pass === true || verdict?.pass === 'true'
          feedback = asString(verdict?.feedback, res.text)
          if (pass) return { output: candidate, attempts: attempt, note: `Принято с ${attempt}-й попытки${verdict?.score != null ? ` · ${asString(verdict.score)}/10` : ''}` }
          if (attempt > maxAttempts || !upstreamAgents.length) break
          candidate = await reviseUpstream(upstreamAgents, attempt, feedback, node)
        }
        return { output: candidate, note: `Не прошло проверку: ${feedback.slice(0, 300)}` }
      }
    }
  }

  // Планировщик: запускаем узел, как только все его входы завершились
  const concurrency = pipeline.interactions ? 1 : Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
  const running = new Set<Promise<void>>()
  const started = new Set<string>(nodes.filter((n) => run.nodes[n.id].reused).map((n) => n.id))
  let fatal: Error | null = null

  const launch = (node: PipelineNode) => {
    started.add(node.id)
    const p = (async () => {
      try {
        if (hooks.beforeNode) await hooks.beforeNode(node)
        throwIfAborted(signal)
        update(node.id, { status: 'running', startedAt: Date.now(), error: undefined })
        const result = await execute(node)
        update(node.id, { ...result, status: 'done', endedAt: Date.now() })
      } catch (e) {
        if (isAbort(e) || signal?.aborted) {
          update(node.id, { status: 'error', error: 'Остановлено', endedAt: Date.now() })
          fatal ??= Object.assign(new Error('Остановлено'), { name: 'AbortError' })
        } else {
          update(node.id, { status: 'error', error: e instanceof Error ? e.message : String(e), endedAt: Date.now() })
        }
      }
    })()
    running.add(p)
    p.finally(() => running.delete(p))
  }

  for (;;) {
    if (fatal || signal?.aborted) break
    let progressed = false
    for (const node of nodes) {
      if (started.has(node.id)) continue
      const ins = inEdges.get(node.id)!
      if (!ins.every((e) => terminal(run.nodes[e.source].status))) continue
      if (ins.length && !ins.some(edgeActive)) {
        started.add(node.id)
        const anyError = ins.some((e) => run.nodes[e.source].status === 'error')
        update(node.id, { status: 'skipped', note: anyError ? 'Вход завершился ошибкой' : 'Ветка не выбрана' })
        progressed = true
        continue
      }
      if (running.size >= concurrency) break
      launch(node)
      progressed = true
    }
    if (progressed) continue
    if (!running.size) break
    await Promise.race(running)
  }
  await Promise.allSettled(running)

  // Итог: узлы «Результат», иначе все завершённые стоки графа
  const outputs = nodes.filter((n) => n.kind === 'output' && run.nodes[n.id].status === 'done')
  const hasOutgoing = new Set(edges.map((e) => e.source))
  const finals = outputs.length ? outputs : nodes.filter((n) => !hasOutgoing.has(n.id) && run.nodes[n.id].status === 'done' && n.kind !== 'input')
  run.output = finals.length === 1 ? run.nodes[finals[0].id].output : finals.map((n) => `## ${n.label}\n\n${run.nodes[n.id].output ?? ''}`).join('\n\n')
  run.endedAt = Date.now()
  const errors = nodes.filter((n) => run.nodes[n.id].status === 'error')
  if (signal?.aborted || fatal) {
    run.status = 'aborted'
    run.error = 'Запуск остановлен'
  } else if (!finals.length && errors.length) {
    run.status = 'error'
    run.error = errors.map((n) => `${n.label}: ${run.nodes[n.id].error}`).join('; ')
  } else {
    run.status = 'done'
    if (errors.length) run.error = `С ошибками: ${errors.map((n) => n.label).join(', ')}`
  }
  return run
}

// ─── Оценка стоимости до запуска ─────────────────────────────────────────

export interface CostEstimate {
  calls: number
  min: number | null
  max: number | null
}

export function estimatePipelineCost(
  pipeline: Pick<Pipeline, 'nodes'>,
  inputTokens: number,
  priceOf: (model: string) => { prompt: number; completion: number } | undefined,
  getAgent: PipelineDeps['getAgent'],
): CostEstimate {
  let calls = 0
  let min = 0
  let max = 0
  let unknown = false
  for (const n of pipeline.nodes) {
    if (n.kind !== 'agent' && n.kind !== 'foreach' && n.kind !== 'router' && n.kind !== 'validator') continue
    if (n.kind === 'validator' && n.config.checkCommand?.trim()) continue
    const cfg = n.kind === 'agent' || n.kind === 'foreach' ? effectiveAgentConfig(n, getAgent) : { model: n.config.model || (n.kind === 'router' ? '@fast' : '@smart'), maxTokens: n.kind === 'router' ? 300 : 800 }
    const price = priceOf(cfg.model)
    const repeats = n.kind === 'validator' ? Math.max(1, n.config.maxAttempts ?? 2) : n.kind === 'foreach' ? Math.max(1, n.config.limit ?? 20) : 1
    calls += repeats
    if (!price) {
      unknown = true
      continue
    }
    const promptTokens = inputTokens + 900
    min += (promptTokens * price.prompt + Math.min(300, cfg.maxTokens) * price.completion)
    max += repeats * ((promptTokens * 2 + 2000) * price.prompt + cfg.maxTokens * price.completion)
  }
  return { calls, min: unknown && !min ? null : min, max: unknown && !max ? null : max }
}

/**
 * Делит вход «Для каждого» на элементы:
 * lines — каждая непустая строка (маркеры списка снимаются);
 * blocks — разделы по заголовкам Markdown или пустым строкам;
 * json — массив JSON (или массив в поле верхнего уровня).
 */
export function splitItems(text: string, mode: 'lines' | 'blocks' | 'json'): string[] {
  const t = text.trim()
  if (!t) return []
  if (mode === 'json') {
    const data = extractJson<unknown>(t)
    const arr = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data as Record<string, unknown>).find(Array.isArray) : null
    if (!Array.isArray(arr)) throw new Error('«Для каждого»: во входе нет массива JSON')
    return arr.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2)))
  }
  if (mode === 'lines') {
    return t
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
      .filter(Boolean)
  }
  const headed = t.split(/\n(?=#{1,4}\s)/)
  const parts = headed.length > 1 ? headed : t.split(/\n\s*\n/)
  return parts.map((p) => p.trim()).filter((p) => p && !/^#{1,4}\s[^\n]*$/.test(p) || p.includes('\n'))
}

/** Заголовок элемента «Для каждого»: у объекта JSON — id и суть, иначе первая строка */
export function itemTitle(item: string): string {
  const t = item.trim()
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>
      const pick = (...keys: string[]) => keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
      const head = [pick('id', 'key'), pick('title', 'name', 'summary', 'description', 'where')].filter(Boolean).join(' ')
      if (head) return head.slice(0, 100)
    } catch {
      // не JSON — берём первую строку
    }
  }
  return t.split('\n')[0].replace(/^[#\s\-*\d.)]+/, '').slice(0, 100)
}
