'use client'

import { create } from 'zustand'
import { buildChatMessages, buildJudgeMessages, buildTitleMessages, fallbackTitle, parseJudge, targetKey, userContent, type ChatReply, type ChatTarget, type ChatTurn, type Conversation } from '../engine/chat'
import { runPipeline } from '../engine/pipeline'
import { shortModelName } from '../models'
import { getAgent } from '../stores/agents'
import { modelById, resolveModelId } from '../stores/catalog'
import { useChats } from '../stores/chats'
import { usePipelines } from '../stores/pipelines'
import { useSettings } from '../stores/settings'
import type { LLMEvent, ToolsetId, ToolTrace } from '../types'
import { uid } from '../utils'
import { callLLM, callTool } from './llm'

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
  patchReply(conv.id, turn.id, key, { status: 'streaming', text: '', reasoning: '', tools: [], notices: [], error: undefined, usage: undefined, startedAt: started, progress: undefined })
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
    store.addRun({ id: runId, pipelineId: pipeline.id, pipelineName: pipeline.name, input: turn.user, status: 'running', startedAt: started, nodes: {}, usage: { promptTokens: 0, completionTokens: 0, cost: 0 } })
    const run = await runPipeline(
      pipeline,
      userContent(turn),
      { llm: callLLM, tool: callTool, getAgent },
      {
        onNode: (nodeId, p) => {
          usePipelines.getState().patchNodeRun(runId, nodeId, p)
          if (p.status === 'done' || p.status === 'skipped' || p.status === 'error') done++
          const node = pipeline.nodes.find((n) => n.id === nodeId)
          if (p.status === 'running' || p.status === 'done') patchReply(conv.id, turn.id, key, { progress: { done, total, current: p.status === 'running' ? node?.label : undefined } })
        },
      },
      { signal, runId },
    )
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

  const { messages } = buildChatMessages(useChats.getState().conversations.find((c) => c.id === conv.id) ?? conv, key, turnIndex, system, settings.chat.maxContextTokens)
  let text = ''
  let reasoning = ''
  const traces: ToolTrace[] = []
  const notices: string[] = []
  const upd = throttled<Partial<ChatReply>>((p) => patchReply(conv.id, turn.id, key, p))
  const res = await callLLM(
    { model, messages, temperature, maxTokens, tools },
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
  const res = await callLLM({ model: '@fast', messages: buildTitleMessages(first), temperature: 0.3, maxTokens: 30 }, { meta: { source: 'system', label: 'Заголовок чата' } })
  const title = res.text.replace(/["«»\n]/g, '').trim()
  if (!res.error && title && title.length < 80) useChats.getState().patch(convId, { title })
}

export async function sendMessage(convId: string, text: string, attachments: { name: string; content: string }[] = []) {
  const conv = getConv(convId)
  if (!conv) return
  const turn: ChatTurn = { id: uid('turn'), user: text, attachments: attachments.length ? attachments : undefined, createdAt: Date.now(), replies: {} }
  for (const t of conv.targets) turn.replies[targetKey(t)] = { status: 'streaming', text: '', startedAt: Date.now() }
  useChats.getState().addTurn(convId, turn)
  const fresh = getConv(convId)!
  const turnIndex = fresh.turns.length - 1
  const ac = track(convId)
  try {
    await Promise.all(fresh.targets.map((t) => runTarget(fresh, turnIndex, t, ac.signal)))
  } finally {
    untrack(convId, ac)
  }
  if (ac.signal.aborted) return
  void autoTitle(convId)
  const after = getConv(convId)
  const okReplies = after ? Object.values(after.turns[turnIndex]?.replies ?? {}).filter((r) => r.status === 'done' && r.text) : []
  if (useSettings.getState().chat.autoJudge && okReplies.length >= 2) await judgeTurn(convId, turn.id)
}

export async function regenerate(convId: string, turnId: string, key: string) {
  const conv = getConv(convId)
  if (!conv) return
  const turnIndex = conv.turns.findIndex((t) => t.id === turnId)
  const target = conv.targets.find((t) => targetKey(t) === key) ?? parseKey(key)
  if (turnIndex === -1 || !target) return
  const ac = track(convId)
  try {
    await runTarget(conv, turnIndex, target, ac.signal)
  } finally {
    untrack(convId, ac)
  }
}

function parseKey(key: string): ChatTarget | null {
  const i = key.indexOf(':')
  if (i === -1) return null
  return { kind: key.slice(0, i) as ChatTarget['kind'], id: key.slice(i + 1) }
}

export async function judgeTurn(convId: string, turnId: string) {
  const conv = getConv(convId)
  const turn = conv?.turns.find((t) => t.id === turnId)
  if (!conv || !turn) return
  const entries = Object.entries(turn.replies).filter(([, r]) => r.status === 'done' && r.text.trim())
  if (entries.length < 2) return
  const keys = entries.map(([k]) => k)
  const replies = entries.map(([k, r]) => ({ key: k, name: describeTarget(parseKey(k)!).name, text: r.text }))
  const store = useChats.getState()
  store.setJudge(convId, turnId, { status: 'streaming', ranking: [], synthesis: '', raw: '' })
  const ac = track(convId)
  let raw = ''
  const upd = throttled<{ raw: string }>((p) => {
    const parsed = parseJudge(p.raw, keys)
    useChats.getState().setJudge(convId, turnId, { status: 'streaming', raw: p.raw, ...parsed })
  }, 120)
  try {
    const res = await callLLM(
      { model: useSettings.getState().chat.judgeModel || '@smart', messages: buildJudgeMessages(userContent(turn), replies), temperature: 0.2, maxTokens: 4000 },
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
    useChats.getState().setJudge(convId, turnId, res.error ? { status: 'error', error: res.error, ranking: [], synthesis: '', raw: res.text } : { status: 'done', raw: res.text, usage: res.usage, ...parseJudge(res.text, keys) })
  } finally {
    untrack(convId, ac)
  }
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
