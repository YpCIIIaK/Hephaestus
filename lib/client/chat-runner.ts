'use client'

import { create } from 'zustand'
import { buildChatMessages, buildCompactionMessages, buildJudgeMessages, buildTitleMessages, compactionPlan, fallbackTitle, parseJudge, parseTitle, targetKey, userContent, type ChatReply, type ChatTarget, type ChatTurn, type Conversation, type ReplySandbox } from '../engine/chat'
import { runPipeline, type NodeRun } from '../engine/pipeline'
import { detectRefusal, REFUSAL_CLARIFICATION } from '../engine/refusal'
import { shortModelName } from '../models'
import { getAgent } from '../stores/agents'
import { modelById, resolveModelId } from '../stores/catalog'
import { useChats } from '../stores/chats'
import { usePipelines } from '../stores/pipelines'
import { useSettings } from '../stores/settings'
import type { LLMEvent, ToolsetId, ToolTrace } from '../types'
import { uid } from '../utils'
import { getDecider, pipelineDefaults } from './decide'
import { api, callLLM, callLLMSafe, callTool, needsScratchCopy, pipelineSandbox } from './llm'

// Логика чата: параллельные ответы участников, судья, автозаголовок.

interface Runtime {
  running: Record<string, number>
  begin: (convId: string) => void
  end: (convId: string) => void
}

export const useChatRuntime = create<Runtime>((set) => ({
  running: {},
  begin: (id) => set((s) => ({ running: { ...s.running, [id]: (s.running[id] ?? 0) + 1 } })),
  end: (id) => set((s) => ({ running: { ...s.running, [id]: Math.max(0, (s.running[id] ?? 1) - 1) } })),
}))

const controllers = new Map<string, Set<AbortController>>()

function track(convId: string): AbortController {
  const ac = new AbortController()
  if (!controllers.has(convId)) controllers.set(convId, new Set())
  controllers.get(convId)!.add(ac)
  useChatRuntime.getState().begin(convId)
  return ac
}

function untrack(convId: string, ac: AbortController) {
  controllers.get(convId)?.delete(ac)
  useChatRuntime.getState().end(convId)
}

export function stopConversation(convId: string) {
  controllers.get(convId)?.forEach((ac) => ac.abort())
}

/** Собирает частые обновления потока в одно за кадр */
function throttled<T extends object>(apply: (patch: T) => void, ms = 60) {
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    if (pending) {
      const p = pending
      pending = null
      apply(p)
    }
  }
  return {
    push(patch: T) {
      pending = { ...(pending ?? ({} as T)), ...patch }
      if (!timer) timer = setTimeout(flush, ms)
    },
    flush() {
      if (timer) clearTimeout(timer)
      flush()
    },
  }
}

export interface TargetInfo {
  name: string
  emoji?: string
  subtitle: string
}

export function describeTarget(t: ChatTarget): TargetInfo {
  if (t.kind === 'agent') {
    const a = getAgent(t.id)
    return { name: a?.name ?? 'Удалённый агент', emoji: a?.emoji ?? '🤖', subtitle: a ? `агент · ${a.role}` : '' }
  }
  if (t.kind === 'pipeline') {
    const p = usePipelines.getState().pipelines.find((x) => x.id === t.id)
    return { name: p?.name ?? 'Удалённый пайплайн', emoji: p?.emoji ?? '⚒️', subtitle: 'пайплайн' }
  }
  const real = resolveModelId(t.id)
  const info = real ? modelById(real) : undefined
  const aliasTitle = t.id === '@smart' ? 'Умная' : t.id === '@default' ? 'Основная' : t.id === '@fast' ? 'Быстрая' : null
  return { name: aliasTitle ? `${aliasTitle}: ${real ? shortModelName(info, real) : '—'}` : shortModelName(info, t.id), subtitle: real ?? t.id }
}

function patchReply(convId: string, turnId: string, key: string, patch: Partial<ChatReply>) {
  useChats.getState().patchReply(convId, turnId, key, patch)
}

async function runTarget(conv: Conversation, turnIndex: number, target: ChatTarget, signal: AbortSignal) {
  const turn = conv.turns[turnIndex]
  const key = targetKey(target)
  const started = Date.now()
  patchReply(conv.id, turn.id, key, { status: 'streaming', text: '', reasoning: '', tools: [], notices: [], error: undefined, usage: undefined, startedAt: started, progress: undefined, received: [], sandbox: undefined })
  const settings = useSettings.getState()

  if (target.kind === 'pipeline') {
    const pipeline = usePipelines.getState().pipelines.find((p) => p.id === target.id)
    if (!pipeline) {
      patchReply(conv.id, turn.id, key, { status: 'error', error: 'Пайплайн не найден' })
      return
    }
    const total = pipeline.nodes.length
    let done = 0
    const runId = uid('run')
    const store = usePipelines.getState()
    store.addRun({ id: runId, pipelineId: pipeline.id, pipelineName: pipeline.name, input: turn.tasks?.[key] ?? turn.user, status: 'running', startedAt: started, nodes: {}, usage: { promptTokens: 0, completionTokens: 0, cost: 0 } })
    patchReply(conv.id, turn.id, key, { pipelineRun: { runId, pipelineId: pipeline.id } })
    // Поток токенов по блокам склеиваем, чтобы схема в чате не перерисовывалась на каждый токен
    const buffer = new Map<string, Partial<NodeRun>>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      for (const [nodeId, patch] of buffer) usePipelines.getState().patchNodeRun(runId, nodeId, patch)
      buffer.clear()
    }
    const run = await runPipeline(
      pipeline,
      userContent(turn, key),
      { llm: callLLMSafe, tool: callTool, getAgent, decide: getDecider(), defaults: pipelineDefaults(), sandbox: pipelineSandbox },
      {
        onNode: (nodeId, p) => {
          buffer.set(nodeId, { ...buffer.get(nodeId), ...p })
          if (p.status && p.status !== 'running') flush()
          else timer ??= setTimeout(flush, 80)
          if (p.status === 'done' || p.status === 'skipped' || p.status === 'error') done++
          const node = pipeline.nodes.find((n) => n.id === nodeId)
          if (p.status === 'running' || p.status === 'done') patchReply(conv.id, turn.id, key, { progress: { done, total, current: p.status === 'running' ? node?.label : undefined } })
        },
      },
      { signal, runId },
    )
    if (timer) clearTimeout(timer)
    flush()
    usePipelines.getState().patchRun(runId, run)
    patchReply(conv.id, turn.id, key, {
      status: run.status === 'aborted' ? 'stopped' : run.status === 'error' && !run.output ? 'error' : 'done',
      text: run.output ?? '',
      error: run.status === 'error' ? run.error : undefined,
      notices: run.status === 'done' && run.error ? [run.error] : [],
      usage: run.usage,
      latencyMs: Date.now() - started,
      model: `Пайплайн «${pipeline.name}»`,
    })
    return
  }

  let model = target.id
  let system = conv.systemPrompt
  let tools: ToolsetId[] = conv.tools
  let temperature = settings.chat.temperature
  let maxTokens = settings.chat.maxTokens
  if (target.kind === 'agent') {
    const agent = getAgent(target.id)
    if (!agent) {
      patchReply(conv.id, turn.id, key, { status: 'error', error: 'Агент не найден' })
      return
    }
    model = agent.model
    system = [agent.systemPrompt, conv.systemPrompt].filter((s) => s.trim()).join('\n\n')
    tools = Array.from(new Set([...agent.tools, ...conv.tools]))
    temperature = agent.temperature
    maxTokens = agent.maxTokens
  }

  // История не влезает в контекст — сжимаем старую часть в резюме, а не выбрасываем молча
  const plan = compactionPlan(getConv(conv.id) ?? conv, key, turnIndex, settings.chat.maxContextTokens)
  if (plan) {
    patchReply(conv.id, turn.id, key, { notices: ['Сжимаю раннюю историю диалога…'] })
    const ok = await compactHistory(conv.id, key, model, plan, signal)
    patchReply(conv.id, turn.id, key, { notices: [ok ? 'Ранняя история диалога сжата в резюме' : 'Не удалось сжать историю — ранние сообщения опущены'] })
    if (signal.aborted) return
  }

  const { messages } = buildChatMessages(getConv(conv.id) ?? conv, key, turnIndex, system, settings.chat.maxContextTokens)
  const received = conv.interactions ? conv.targets.filter((t) => targetKey(t) !== key).map((t) => ({ name: describeTarget(t).name, text: getConv(conv.id)?.turns[turnIndex]?.replies[targetKey(t)]?.text ?? '' })).filter((item) => item.text) : []
  if (received.length) {
    messages.unshift({ role: 'system', content: `Ответы других участников этого обсуждения. Учитывай их и явно называй участника, если дополняешь или оспариваешь его вывод:\n\n${received.map((item) => `${item.name}: ${item.text}`).join('\n\n')}` })
    patchReply(conv.id, turn.id, key, { received })
  }
  // Отдельная копия проекта: участник правит её, а не оригинал. Проверяющий с
  // терминалом получает свежую копию на каждый ход — видит актуальный проект,
  // но не может изменить его командами.
  let sandbox: string | undefined
  const scratch = needsScratchCopy(tools)
  if ((conv.isolate && tools.includes('files_write')) || scratch) {
    try {
      sandbox = scratch ? await freshSandbox(conv.id, key, describeTarget(target).name) : await ensureSandbox(conv.id, key, describeTarget(target).name)
    } catch (e) {
      patchReply(conv.id, turn.id, key, { status: 'error', error: `Не удалось создать копию проекта: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    patchReply(conv.id, turn.id, key, { sandbox: { id: sandbox, files: [] } })
  }

  let text = ''
  let reasoning = ''
  const traces: ToolTrace[] = []
  const notices: string[] = []
  const upd = throttled<Partial<ChatReply>>((p) => patchReply(conv.id, turn.id, key, p))
  const ask = (msgs: typeof messages) => callLLM(
    { model, messages: msgs, temperature, maxTokens, tools, sandbox, session: conv.id, sessionAuthor: describeTarget(target).name },
    {
      signal,
      meta: { source: 'chat', label: describeTarget(target).name },
      onEvent: (e: LLMEvent) => {
        if (e.t === 'text') {
          text += e.v
          upd.push({ text })
        } else if (e.t === 'reasoning') {
          reasoning += e.v
          upd.push({ reasoning })
        } else if (e.t === 'tool_call') {
          traces.push({ id: e.id, name: e.name, args: e.args })
          upd.push({ tools: [...traces] })
        } else if (e.t === 'tool_result') {
          const t = traces.find((x) => x.id === e.id)
          if (t) Object.assign(t, { ok: e.ok, preview: e.preview })
          upd.push({ tools: [...traces] })
        } else if (e.t === 'notice') {
          notices.push(e.v)
          upd.push({ notices: [...notices] })
        }
      },
    },
  )
  let res = await ask(messages)
  // Модель отказалась — один повтор с уточнением задачи; не помогло — подсказка сменить модель
  if (!res.error && !res.aborted && detectRefusal(res.text, res.tools.length) === 'refusal') {
    notices.push('Модель отказалась — повторяю с уточнением задачи')
    upd.push({ notices: [...notices] })
    const first = res.text
    text = ''
    upd.push({ text: '' })
    res = await ask([...messages, { role: 'assistant', content: first }, { role: 'user', content: REFUSAL_CLARIFICATION }])
    if (!res.error && detectRefusal(res.text, res.tools.length) === 'refusal') {
      notices.push('Модель снова отказалась. Попробуйте другую модель — кнопкой с названием модели над ответом')
      upd.push({ notices: [...notices] })
    }
  }
  upd.flush()
  patchReply(conv.id, turn.id, key, {
    status: res.aborted ? 'stopped' : res.error ? 'error' : 'done',
    text: res.text,
    reasoning: res.reasoning || undefined,
    tools: res.tools,
    error: res.error,
    usage: res.usage,
    latencyMs: res.latencyMs,
    model: res.model,
  })
  if (sandbox) patchReply(conv.id, turn.id, key, { sandbox: await sandboxSummary(sandbox) })
}

/** Новая копия на этот ход; предыдущая копия участника удаляется */
async function freshSandbox(convId: string, key: string, label: string): Promise<string> {
  const conv = getConv(convId)
  const old = conv?.sandboxes?.[key]
  if (conv && old) {
    void api(`/api/sandboxes?id=${old}`, { method: 'DELETE' }).catch(() => {})
    for (const t of conv.turns) {
      const r = t.replies[key]
      if (r?.sandbox?.id === old) patchReply(convId, t.id, key, { sandbox: { ...r.sandbox, removed: true } })
    }
    const { [key]: _, ...rest } = conv.sandboxes ?? {}
    useChats.getState().patch(convId, { sandboxes: rest })
  }
  return ensureSandbox(convId, key, label)
}

/** Копия проекта участника: одна на весь диалог, чтобы правки копились от хода к ходу */
async function ensureSandbox(convId: string, key: string, label: string): Promise<string> {
  const existing = getConv(convId)?.sandboxes?.[key]
  if (existing) return existing
  const { id } = await api<{ id: string }>('/api/sandboxes', { method: 'POST', json: { action: 'create', label } })
  const conv = getConv(convId)
  useChats.getState().patch(convId, { sandboxes: { ...conv?.sandboxes, [key]: id } })
  return id
}

async function sandboxSummary(id: string): Promise<ReplySandbox> {
  try {
    const d = await api<{ files: ReplySandbox['files'] }>(`/api/sandboxes?id=${id}`)
    return { id, files: d.files }
  } catch (e) {
    return { id, files: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export async function sandboxPatch(id: string): Promise<{ patch: string; truncated: boolean }> {
  return api(`/api/sandboxes?id=${id}`)
}

/** Переносит правки участника из его копии в проект */
export async function applySandboxChanges(convId: string, turnId: string, key: string): Promise<{ applied: string[]; conflicts: string[] }> {
  const reply = getConv(convId)?.turns.find((t) => t.id === turnId)?.replies[key]
  if (!reply?.sandbox) return { applied: [], conflicts: [] }
  const res = await api<{ applied: string[]; conflicts: string[] }>('/api/sandboxes', { method: 'POST', json: { action: 'apply', id: reply.sandbox.id } })
  patchReply(convId, turnId, key, { sandbox: { ...reply.sandbox, applied: [...(reply.sandbox.applied ?? []), ...res.applied], conflicts: res.conflicts } })
  return res
}

/** Удаляет копию участника; следующий ход начнёт новую копию с текущего проекта */
export async function discardSandbox(convId: string, turnId: string, key: string) {
  const conv = getConv(convId)
  const reply = conv?.turns.find((t) => t.id === turnId)?.replies[key]
  if (!conv || !reply?.sandbox) return
  await api(`/api/sandboxes?id=${reply.sandbox.id}`, { method: 'DELETE' })
  const sandboxes = Object.fromEntries(Object.entries(conv.sandboxes ?? {}).filter(([, id]) => id !== reply.sandbox!.id))
  useChats.getState().patch(convId, { sandboxes })
  // Копия общая для всех ходов участника — помечаем удалённой везде
  for (const t of conv.turns) {
    const r = t.replies[key]
    if (r?.sandbox?.id === reply.sandbox.id) patchReply(convId, t.id, key, { sandbox: { ...r.sandbox, removed: true } })
  }
}

/** Сжимает историю участника и запоминает резюме; true — если получилось */
async function compactHistory(convId: string, key: string, model: string, plan: NonNullable<ReturnType<typeof compactionPlan>>, signal?: AbortSignal): Promise<boolean> {
  // Сжимает модель из настроек «Служебные модели», по умолчанию — сам участник
  const res = await callLLM(
    { model: useSettings.getState().services.compaction || model, messages: buildCompactionMessages(plan), temperature: 0.2, maxTokens: 2000 },
    { signal, meta: { source: 'system', label: 'Сжатие контекста' } },
  )
  if (res.error || res.aborted || !res.text.trim()) return false
  const conv = getConv(convId)
  if (!conv) return false
  useChats.getState().patch(convId, { memory: { ...conv.memory, [key]: { uptoTurn: plan.to, text: res.text.trim(), at: Date.now() } } })
  return true
}

/** «Очистить контекст»: история остаётся на экране, но модели начинают с чистого листа */
export function clearContext(convId: string) {
  const conv = getConv(convId)
  if (!conv) return
  useChats.getState().patch(convId, { contextFrom: conv.turns.length, memory: {} })
}

/** «Сжать контекст»: вся видимая моделям история каждого участника сжимается в резюме */
export async function compactContext(convId: string): Promise<{ compacted: number; failed: number }> {
  const conv = getConv(convId)
  if (!conv) return { compacted: 0, failed: 0 }
  let compacted = 0
  let failed = 0
  const ac = track(convId)
  useChatRuntime.getState().begin(convId)
  try {
    await Promise.all(
      conv.targets
        .filter((t) => t.kind !== 'pipeline')
        .map(async (t) => {
          const key = targetKey(t)
          const plan = compactionPlan(getConv(convId) ?? conv, key, conv.turns.length, Infinity, true)
          if (!plan) return
          const model = t.kind === 'agent' ? (getAgent(t.id)?.model ?? '@default') : t.id
          if (await compactHistory(convId, key, model, plan, ac.signal)) compacted++
          else failed++
        }),
    )
  } finally {
    useChatRuntime.getState().end(convId)
    untrack(convId, ac)
  }
  return { compacted, failed }
}

function getConv(id: string) {
  return useChats.getState().conversations.find((c) => c.id === id)
}

export function newConversation(): Conversation {
  const s = useSettings.getState().chat
  return { id: uid('chat'), title: 'Новый диалог', createdAt: Date.now(), updatedAt: Date.now(), targets: s.targets, systemPrompt: '', tools: s.tools, turns: [] }
}

async function autoTitle(convId: string) {
  const conv = getConv(convId)
  if (!conv || conv.turns.length !== 1) return
  const first = conv.turns[0].user
  useChats.getState().patch(convId, { title: fallbackTitle(first) })
  if (!useSettings.getState().chat.autoTitle) return
  const res = await callLLM({ model: useSettings.getState().services.title || '@fast', messages: buildTitleMessages(first), temperature: 0.3, maxTokens: 30 }, { meta: { source: 'system', label: 'Заголовок чата' } })
  const title = res.error ? null : parseTitle(res.text)
  if (title) useChats.getState().patch(convId, { title })
}

/**
 * Отправляет ход. tasks — режим «разные задачи»: своя задача каждому участнику;
 * отвечают только те, кому задача написана (так можно запустить одного).
 */
export async function sendMessage(convId: string, text: string, attachments: { name: string; content: string }[] = [], tasks?: Record<string, string>) {
  const conv = getConv(convId)
  if (!conv) return
  const own = tasks ? Object.fromEntries(Object.entries(tasks).filter(([k, v]) => v.trim() && conv.targets.some((t) => targetKey(t) === k))) : undefined
  if (own && !Object.keys(own).length) return
  const targets = own ? conv.targets.filter((t) => own[targetKey(t)]) : conv.targets
  const turn: ChatTurn = { id: uid('turn'), user: own ? Object.values(own)[0] : text, tasks: own, attachments: attachments.length ? attachments : undefined, createdAt: Date.now(), replies: {} }
  for (const t of targets) turn.replies[targetKey(t)] = { status: 'streaming', text: '', startedAt: Date.now() }
  useChats.getState().addTurn(convId, turn)
  const fresh = getConv(convId)!
  const turnIndex = fresh.turns.length - 1
  const ac = track(convId)
  try {
    if (fresh.interactions) {
      for (const target of targets) {
        if (ac.signal.aborted) break
        await runTarget(fresh, turnIndex, target, ac.signal)
      }
    } else await Promise.all(targets.map((t) => runTarget(fresh, turnIndex, t, ac.signal)))
  } finally {
    untrack(convId, ac)
  }
  if (ac.signal.aborted) return
  void autoTitle(convId)
  const after = getConv(convId)
  const okReplies = after ? Object.values(after.turns[turnIndex]?.replies ?? {}).filter((r) => r.status === 'done' && r.text) : []
  const judge = after?.judge
  const auto = judge ? judge.enabled : useSettings.getState().chat.autoJudge
  if (after && auto && canJudge(after.turns[turnIndex], judge)) await judgeTurn(convId, turn.id)
}

export async function regenerate(convId: string, turnId: string, key: string) {
  const conv = getConv(convId)
  if (!conv) return
  const turnIndex = conv.turns.findIndex((t) => t.id === turnId)
  const target = conv.targets.find((t) => targetKey(t) === key) ?? parseKey(key)
  if (turnIndex === -1 || !target) return
  // Повтор в отдельной копии начинается с чистой копии: старые правки участника не мешают
  const sb = conv.sandboxes?.[key]
  if (conv.isolate && sb && turnIndex === conv.turns.length - 1) {
    await api(`/api/sandboxes?id=${sb}`, { method: 'DELETE' }).catch(() => {})
    const { [key]: _, ...rest } = conv.sandboxes ?? {}
    useChats.getState().patch(convId, { sandboxes: rest })
  }
  const ac = track(convId)
  try {
    await runTarget(getConv(convId) ?? conv, turnIndex, target, ac.signal)
  } finally {
    untrack(convId, ac)
  }
}

function parseKey(key: string): ChatTarget | null {
  const i = key.indexOf(':')
  if (i === -1) return null
  return { kind: key.slice(0, i) as ChatTarget['kind'], id: key.slice(i + 1) }
}

/**
 * Можно ли звать судью. Стандартный судья сравнивает ответы на один вопрос —
 * нужно минимум два. Судья со своей инструкцией делает вывод и по одному
 * ответу, и по разным задачам.
 */
export function canJudge(turn: ChatTurn | undefined, judge: Conversation['judge']): boolean {
  if (!turn) return false
  const done = Object.values(turn.replies).filter((r) => r.status === 'done' && r.text.trim()).length
  if (judge?.instructions.trim()) return done >= 1
  return !turn.tasks && done >= 2
}

export async function judgeTurn(convId: string, turnId: string) {
  const conv = getConv(convId)
  const turn = conv?.turns.find((t) => t.id === turnId)
  if (!conv || !turn || !canJudge(turn, conv.judge)) return
  const cfg = conv.judge
  const instructions = cfg?.instructions.trim() ?? ''
  const ranking = cfg ? cfg.ranking : true
  const entries = Object.entries(turn.replies).filter(([, r]) => r.status === 'done' && r.text.trim())
  const keys = entries.map(([k]) => k)
  const replies = await Promise.all(
    entries.map(async ([k, r]) => {
      let text = r.text
      // Судья оценивает не только рассказ о правках, но и сами правки
      if (r.sandbox && !r.sandbox.removed && r.sandbox.files.length) {
        const d = await sandboxPatch(r.sandbox.id).catch(() => null)
        if (d) text += `\n\n<изменения в файлах>\n${d.patch.slice(0, 12_000)}${d.patch.length > 12_000 || d.truncated ? '\n…[diff обрезан]' : ''}\n</изменения в файлах>`
      }
      return { key: k, name: describeTarget(parseKey(k)!).name, text, task: turn.tasks?.[k] }
    }),
  )
  const store = useChats.getState()
  const custom = !!instructions
  store.setJudge(convId, turnId, { status: 'streaming', ranking: [], synthesis: '', raw: '', custom })
  const ac = track(convId)
  let raw = ''
  const upd = throttled<{ raw: string }>((p) => {
    const parsed = parseJudge(p.raw, keys, ranking)
    useChats.getState().setJudge(convId, turnId, { status: 'streaming', raw: p.raw, custom, ...parsed })
  }, 120)
  try {
    const res = await callLLM(
      {
        model: cfg?.model || useSettings.getState().chat.judgeModel || '@smart',
        // В режиме «разные задачи» общего вопроса нет — задачи видны в ответах участников
        messages: buildJudgeMessages(turn.tasks ? 'У участников разные задачи — они указаны в их ответах.' : userContent(turn), replies, { instructions, ranking }),
        temperature: 0.2,
        maxTokens: 4000,
      },
      {
        signal: ac.signal,
        meta: { source: 'judge', label: 'Судья чата' },
        onEvent: (e) => {
          if (e.t === 'text') {
            raw += e.v
            upd.push({ raw })
          }
        },
      },
    )
    upd.flush()
    if (res.aborted) {
      useChats.getState().setJudge(convId, turnId, undefined)
      return
    }
    useChats.getState().setJudge(convId, turnId, res.error ? { status: 'error', error: res.error, ranking: [], synthesis: '', raw: res.text, custom } : { status: 'done', raw: res.text, usage: res.usage, custom, ...parseJudge(res.text, keys, ranking) })
  } finally {
    untrack(convId, ac)
  }
}

/** Краткая выжимка диалога для переноса в другой: резюме сжатий и последние ходы */
export function sessionDigest(conv: Conversation, lastTurns = 4, perReply = 1500): string {
  const parts: string[] = []
  const summaries = Object.entries(conv.memory ?? {}).map(([key, m]) => {
    const t = parseKey(key)
    return `Резюме ранней истории (${t ? describeTarget(t).name : key}):\n${m.text}`
  })
  if (summaries.length) parts.push(...summaries)
  for (const turn of conv.turns.slice(-lastTurns)) {
    const replies = Object.entries(turn.replies)
      .filter(([, r]) => r.text.trim())
      .map(([key, r]) => {
        const t = parseKey(key)
        const text = r.text.trim()
        return `${t ? describeTarget(t).name : key}: ${text.length > perReply ? `${text.slice(0, perReply)}…` : text}`
      })
    parts.push([`Пользователь: ${turn.user.slice(0, 2000)}`, ...replies, turn.judge?.synthesis ? `Итог судьи: ${turn.judge.synthesis.slice(0, perReply)}` : ''].filter(Boolean).join('\n'))
  }
  return parts.length ? `### Из диалога «${conv.title}»\n\n${parts.join('\n\n')}` : ''
}

/** Переносит память сессии и выжимку диалога в другой диалог (или в новый — его id вернётся) */
export async function transferSession(fromId: string, toId: string | null, withDigest = true): Promise<{ to: string; chars: number }> {
  const from = getConv(fromId)
  if (!from) throw new Error('Диалог не найден')
  let to = toId
  if (!to) {
    const fresh = { ...newConversation(), title: `${from.title} (продолжение)`, targets: from.targets, tools: from.tools, systemPrompt: from.systemPrompt }
    useChats.getState().create(fresh)
    to = fresh.id
  }
  const r = await api<{ chars: number }>('/api/sessions', { method: 'POST', json: { action: 'copy', from: fromId, to, extra: withDigest ? sessionDigest(from).slice(0, 90_000) : '' } })
  return { to, chars: r.chars }
}

export function conversationToMarkdown(conv: Conversation): string {
  const lines = [`# ${conv.title}`, '']
  for (const turn of conv.turns) {
    lines.push(`## 🧑 Вопрос`, '', turn.user, '')
    for (const [key, r] of Object.entries(turn.replies)) {
      const t = parseKey(key)
      lines.push(`### ${t ? describeTarget(t).name : key}`, '', r.error ? `> Ошибка: ${r.error}` : r.text, '')
    }
    if (turn.judge?.synthesis) lines.push('### ⚖️ Итог судьи', '', turn.judge.synthesis, '')
  }
  return lines.join('\n')
}
