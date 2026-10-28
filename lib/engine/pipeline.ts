import type { Agent } from '../agents'
import { asString, extractJson } from '../json'
import { addUsage, ZERO_USAGE } from '../models'
import { renderTemplate } from '../template'
import type { LLMEvent, LLMResult, ToolsetId, ToolTrace, Usage } from '../types'
import { isAbort, throwIfAborted, type LLMCall } from './llm'

// ─── Модель графа ────────────────────────────────────────────────────────

export type NodeKind = 'input' | 'agent' | 'search' | 'knowledge' | 'file' | 'router' | 'merge' | 'validator' | 'write' | 'output'

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
  // Проверка
  criteria?: string
  maxAttempts?: number
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
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  createdAt: string
  updatedAt: string
}

// ─── Состояние запуска ───────────────────────────────────────────────────

export type NodeStatus = 'idle' | 'running' | 'done' | 'skipped' | 'error'

export interface NodeRun {
  status: NodeStatus
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
}

export interface PipelineDeps {
  llm: LLMCall
  tool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<{ ok: boolean; output: string }>
  getAgent: (id: string) => Agent | undefined
}

export interface PipelineHooks {
  onNode?: (nodeId: string, patch: Partial<NodeRun>) => void
  /** Вызывается перед запуском каждого узла; пошаговый режим ждёт здесь нажатия «Дальше» */
  beforeNode?: (node: PipelineNode) => Promise<void>
}

export const NODE_META: Record<NodeKind, { title: string; hint: string }> = {
  input: { title: 'Вход', hint: 'Запрос пользователя — {{input}}' },
  agent: { title: 'Агент', hint: 'Вызов модели или агента из библиотеки' },
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

export async function runPipeline(
  pipeline: Pick<Pipeline, 'id' | 'name' | 'nodes' | 'edges'>,
  input: string,
  deps: PipelineDeps,
  hooks: PipelineHooks = {},
  opts: { signal?: AbortSignal; concurrency?: number; runId?: string } = {},
): Promise<PipelineRun> {
  const { nodes, edges } = pipeline
  const signal = opts.signal
  const run: PipelineRun = {
    id: opts.runId ?? `run_${Date.now().toString(36)}`,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    input,
    status: 'running',
    startedAt: Date.now(),
    nodes: Object.fromEntries(nodes.map((n) => [n.id, { status: 'idle' } as NodeRun])),
    usage: { ...ZERO_USAGE },
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

  const addRunUsage = (u?: Usage) => {
    if (u) run.usage = addUsage(run.usage, u)
  }

  // Вызов модели с повторами и запасными моделями
  const callAgent = async (node: PipelineNode, ctx: ExecContext, extraFeedback?: string): Promise<LLMResult> => {
    const cfg = effectiveAgentConfig(node, deps.getAgent)
    let user = render(node.config.prompt, ctx, ctx.prevText)
    if (extraFeedback) user += `\n\n---\n${extraFeedback}`
    const messages = [
      ...(cfg.systemPrompt ? [{ role: 'system' as const, content: cfg.systemPrompt }] : []),
      { role: 'user' as const, content: user },
    ]
    const models = [cfg.model, ...(node.config.fallbackModels ?? []).filter(Boolean)]
    const retries = Math.max(0, Math.min(node.config.retries ?? 1, 5))
    let lastError = 'Неизвестная ошибка'
    let streamed = ''
    let reasoning = ''
    const tools: ToolTrace[] = []
    for (const model of models) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        throwIfAborted(signal)
        streamed = ''
        reasoning = ''
        update(node.id, { model, output: '', note: attempt ? `Повтор ${attempt}` : model !== cfg.model ? `Запасная модель` : undefined })
        const onEvent = (e: LLMEvent) => {
          if (e.t === 'text') {
            streamed += e.v
            update(node.id, { output: streamed })
          } else if (e.t === 'reasoning') {
            reasoning += e.v
            update(node.id, { reasoning })
          } else if (e.t === 'tool_call') {
            tools.push({ id: e.id, name: e.name, args: e.args })
            update(node.id, { tools: [...tools] })
          } else if (e.t === 'tool_result') {
            const t = tools.find((x) => x.id === e.id)
            if (t) Object.assign(t, { ok: e.ok, preview: e.preview })
            update(node.id, { tools: [...tools] })
          }
        }
        const res = await deps.llm(
          { model, messages, temperature: cfg.temperature, maxTokens: cfg.maxTokens, tools: cfg.tools, jsonMode: node.config.jsonMode },
          { signal, onEvent, meta: { source: 'pipeline', label: node.label } },
        )
        addRunUsage(res.usage)
        if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
        if (!res.error) return res
        lastError = res.error
        // Ошибки ключа и бюджета повторять бессмысленно
        if (/ключ|бюджет|лимит расходов|401|402/i.test(res.error)) throw new Error(res.error)
        if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
      }
    }
    throw new Error(lastError)
  }

  const execute = async (node: PipelineNode): Promise<Partial<NodeRun>> => {
    const ctx = contextFor(node)
    switch (node.kind) {
      case 'input':
        return { output: input }

      case 'agent': {
        const res = await callAgent(node, ctx)
        return { output: res.text, usage: res.usage, model: res.model }
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
        const r = await deps.tool('read_file', { path }, signal)
        if (!r.ok) throw new Error(r.output)
        return { output: r.output, note: path }
      }

      case 'write': {
        const path = render(node.config.path, ctx, '')
        const content = render(node.config.template, ctx, ctx.prevText)
        const r = await deps.tool('write_file', { path, content }, signal)
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
        const cfg = effectiveAgentConfig(node, deps.getAgent)
        const list = routes.map((r, i) => `${i + 1}. ${r.label}${r.keywords ? ` — ${r.keywords}` : ''}`).join('\n')
        const res = await deps.llm(
          {
            model: node.config.model || '@fast',
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
        for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
          throwIfAborted(signal)
          update(node.id, { attempts: attempt, note: `Проверка ${attempt}` })
          const res = await deps.llm(
            {
              model: node.config.model || '@smart',
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
          // Отправляем на доработку все агенты, которые подали ответ в проверку
          const revised: { label: string; output: string }[] = []
          for (const agentNode of upstreamAgents) {
            const agentCtx = contextFor(agentNode)
            update(agentNode.id, { status: 'running', note: `Доработка ${attempt}` })
            const prevAnswer = run.nodes[agentNode.id].output ?? ''
            const res2 = await callAgent(
              agentNode,
              agentCtx,
              `Твой предыдущий ответ не прошёл проверку.\n\nПредыдущий ответ:\n${prevAnswer}\n\nЗамечания проверяющего:\n${feedback}\n\nИсправь ответ с учётом замечаний и выдай полную новую версию.`,
            )
            update(agentNode.id, { status: 'done', output: res2.text, attempts: attempt + 1, note: `Версия ${attempt + 1}` })
            revised.push({ label: agentNode.label, output: res2.text })
          }
          candidate = joinParts(
            inEdges
              .get(node.id)!
              .filter(edgeActive)
              .map((e) => ({ label: byId.get(e.source)!.label, output: run.nodes[e.source].output ?? '' })),
          )
        }
        return { output: candidate, note: `Не прошло проверку: ${feedback.slice(0, 300)}` }
      }
    }
  }

  // Планировщик: запускаем узел, как только все его входы завершились
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
  const running = new Set<Promise<void>>()
  const started = new Set<string>()
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
    if (n.kind !== 'agent' && n.kind !== 'router' && n.kind !== 'validator') continue
    const cfg = n.kind === 'agent' ? effectiveAgentConfig(n, getAgent) : { model: n.config.model || (n.kind === 'router' ? '@fast' : '@smart'), maxTokens: n.kind === 'router' ? 300 : 800 }
    const price = priceOf(cfg.model)
    const repeats = n.kind === 'validator' ? Math.max(1, n.config.maxAttempts ?? 2) : 1
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
