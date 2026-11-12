import { asArray, asNumber, asString, extractJson } from '../json'
import { estimateTokens } from '../tokens'
import type { LLMMessage, ToolsetId, ToolTrace, Usage } from '../types'

// Модель данных чата: один вопрос пользователя → ответы от нескольких
// участников (моделей, агентов или пайплайнов), которые идут параллельно.

export type TargetKind = 'model' | 'agent' | 'pipeline'

export interface ChatTarget {
  kind: TargetKind
  id: string
}

export const targetKey = (t: ChatTarget) => `${t.kind}:${t.id}`

export interface Attachment {
  name: string
  content: string
}

export interface ChatReply {
  status: 'streaming' | 'done' | 'error' | 'stopped'
  text: string
  received?: { name: string; text: string }[]
  reasoning?: string
  tools?: ToolTrace[]
  notices?: string[]
  error?: string
  usage?: Usage
  model?: string
  latencyMs?: number
  startedAt: number
  rating?: 1 | -1
  /** Для пайплайнов — прогресс узлов */
  progress?: { done: number; total: number; current?: string }
  /** Участник работал в своей копии проекта: что он в ней изменил */
  sandbox?: ReplySandbox
}

export interface ReplySandbox {
  id: string
  files: { path: string; status: 'added' | 'modified' | 'deleted'; additions: number; deletions: number }[]
  /** Файлы, уже перенесённые в проект */
  applied?: string[]
  conflicts?: string[]
  removed?: boolean
  error?: string
}

export interface JudgeResult {
  status: 'streaming' | 'done' | 'error'
  ranking: { key: string; score: number; strengths: string; weaknesses: string }[]
  bestKey?: string
  synthesis: string
  raw: string
  error?: string
  usage?: Usage
}

export interface ChatTurn {
  id: string
  user: string
  attachments?: Attachment[]
  createdAt: number
  replies: Record<string, ChatReply>
  judge?: JudgeResult
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  targets: ChatTarget[]
  systemPrompt: string
  tools: ToolsetId[]
  interactions?: boolean
  turns: ChatTurn[]
  pinned?: boolean
  /** Ходы до этого индекса модели не видят: контекст очищен */
  contextFrom?: number
  /** Сжатая история каждого участника: краткое содержание ходов до uptoTurn */
  memory?: Record<string, ContextSummary>
  /** Каждый участник правит свою копию проекта */
  isolate?: boolean
  /** Копии проекта участников (ключ участника → id копии) */
  sandboxes?: Record<string, string>
}

export interface ContextSummary {
  /** Индекс хода, до которого (не включая) история сжата */
  uptoTurn: number
  text: string
  at: number
}

/** Сколько последних ходов всегда остаются дословно при автоматическом сжатии */
export const KEEP_RECENT_TURNS = 2
/** Сжимаем, когда история занимает больше этой доли бюджета контекста */
export const COMPACT_THRESHOLD = 0.75

export function attachmentsBlock(atts: Attachment[] | undefined): string {
  if (!atts?.length) return ''
  return atts.map((a) => `<file name="${a.name}">\n${a.content}\n</file>`).join('\n\n')
}

export function userContent(turn: Pick<ChatTurn, 'user' | 'attachments'>): string {
  const files = attachmentsBlock(turn.attachments)
  return files ? `${files}\n\n${turn.user}` : turn.user
}

/** Краткая запись действий с инструментами: иначе на следующем ходе модель не помнит, что читала и меняла */
export function toolSummary(tools: ToolTrace[] | undefined): string {
  if (!tools?.length) return ''
  const items = tools.slice(0, 40).map((t) => {
    let arg = ''
    try {
      const a = JSON.parse(t.args || '{}') as Record<string, unknown>
      arg = String(a.path ?? a.command ?? a.query ?? a.pattern ?? a.glob ?? a.url ?? a.from ?? a.note ?? '').slice(0, 120)
    } catch {
      // аргументы не JSON
    }
    return `${t.name}${arg ? ` ${arg}` : ''}${t.ok === false ? ' (ошибка)' : ''}`
  })
  return `[Мои действия: ${items.join('; ')}${tools.length > 40 ? `; и ещё ${tools.length - 40}` : ''}]`
}

function replyContent(reply: ChatReply): string {
  const actions = toolSummary(reply.tools)
  return actions ? `${actions}\n\n${reply.text}` : reply.text
}

interface HistoryPair {
  turn: number
  messages: LLMMessage[]
  tokens: number
}

/** Пары «вопрос — ответ этого участника» с хода from до uptoTurn (не включая) */
function historyPairs(conv: Pick<Conversation, 'turns'>, key: string, from: number, uptoTurn: number): HistoryPair[] {
  const pairs: HistoryPair[] = []
  for (let i = from; i < uptoTurn; i++) {
    const turn = conv.turns[i]
    const reply = turn.replies[key]
    // вопрос без ответа этого участника не нужен в его истории
    if (!reply || !(reply.status === 'done' || (reply.status === 'stopped' && reply.text))) continue
    const messages: LLMMessage[] = [
      { role: 'user', content: userContent(turn) },
      { role: 'assistant', content: replyContent(reply) },
    ]
    pairs.push({ turn: i, messages, tokens: messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0) })
  }
  return pairs
}

/** С какого хода начинается видимая модели история и какое резюме её предваряет */
function contextStart(conv: Pick<Conversation, 'contextFrom' | 'memory'>, key: string): { from: number; summary?: ContextSummary } {
  const cleared = conv.contextFrom ?? 0
  const summary = conv.memory?.[key]
  if (summary && summary.uptoTurn > cleared) return { from: summary.uptoTurn, summary }
  return { from: cleared }
}

/**
 * История для конкретного участника: резюме сжатой части, затем вопросы
 * пользователя и только его собственные ответы (со сводкой действий).
 * Если история всё равно не влезает в бюджет, старые ходы отбрасываются.
 */
export function buildChatMessages(
  conv: Pick<Conversation, 'turns' | 'contextFrom' | 'memory'>,
  key: string,
  uptoTurn: number,
  systemPrompt: string,
  maxContextTokens: number,
): { messages: LLMMessage[]; droppedTurns: number } {
  const { from, summary } = contextStart(conv, key)
  const pairs = historyPairs(conv, key, from, uptoTurn)
  const current: LLMMessage = { role: 'user', content: userContent(conv.turns[uptoTurn]) }
  const summaryBlock = summary ? `Краткое содержание более ранней части диалога (сжато, чтобы сэкономить контекст):\n${summary.text}` : ''
  const fixed = estimateTokens(systemPrompt) + estimateTokens(summaryBlock) + estimateTokens(current.content)
  let budget = maxContextTokens - fixed
  const kept: LLMMessage[][] = []
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (pairs[i].tokens > budget) break
    budget -= pairs[i].tokens
    kept.unshift(pairs[i].messages)
  }
  const dropped = pairs.length - kept.length
  const sys = [systemPrompt.trim(), summaryBlock, dropped ? `(Ранние ${dropped} сообщ. диалога опущены из-за лимита контекста.)` : ''].filter(Boolean).join('\n\n')
  return {
    messages: [...(sys ? [{ role: 'system' as const, content: sys }] : []), ...kept.flat(), current],
    droppedTurns: dropped,
  }
}

/**
 * Нужно ли сжать историю участника перед ходом uptoTurn. Возвращает диапазон
 * ходов для сжатия: всё, кроме последних KEEP_RECENT_TURNS (force — вообще всё).
 */
export function compactionPlan(
  conv: Pick<Conversation, 'turns' | 'contextFrom' | 'memory'>,
  key: string,
  uptoTurn: number,
  maxContextTokens: number,
  force = false,
): { from: number; to: number; text: string; previous?: string } | null {
  const { from, summary } = contextStart(conv, key)
  const pairs = historyPairs(conv, key, from, uptoTurn)
  const total = pairs.reduce((n, p) => n + p.tokens, 0)
  if (!force && total < maxContextTokens * COMPACT_THRESHOLD) return null
  const toCompact = force ? pairs : pairs.slice(0, Math.max(0, pairs.length - KEEP_RECENT_TURNS))
  if (!toCompact.length) return null
  const to = force ? uptoTurn : toCompact[toCompact.length - 1].turn + 1
  const text = toCompact.map((p) => p.messages.map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`).join('\n\n')).join('\n\n---\n\n')
  return { from, to, text, previous: summary?.text }
}

export function buildCompactionMessages(plan: { text: string; previous?: string }): LLMMessage[] {
  return [
    {
      role: 'system',
      content:
        'Ты сжимаешь историю рабочего диалога, чтобы её можно было продолжить с чистым контекстом. Сохрани всё, что нужно для продолжения: цель и задачи пользователя, принятые решения и договорённости, какие файлы изучены и изменены (с путями), какие команды запускались и с каким итогом, найденные проблемы, что осталось сделать и открытые вопросы. Убери повторы, вежливость и подробности, которые больше не нужны. Пиши кратко, списками, на языке диалога. Не добавляй ничего от себя.',
    },
    {
      role: 'user',
      content: `${plan.previous ? `Резюме ещё более ранней части:\n${plan.previous}\n\n` : ''}Часть диалога, которую нужно сжать:\n\n${plan.text.slice(-60_000)}\n\nНапиши сжатое резюме.`,
    },
  ]
}

// ─── Судья: сравнение ответов ────────────────────────────────────────────

export function buildJudgeMessages(question: string, replies: { key: string; name: string; text: string }[]): LLMMessage[] {
  const blocks = replies.map((r, i) => `## Ответ ${i + 1} — ${r.name}\n${r.text}`).join('\n\n')
  return [
    {
      role: 'system',
      content: `Ты — беспристрастный эксперт-судья. Сравни ответы разных ИИ на вопрос пользователя по точности, полноте, полезности и ясности. Не отдавай предпочтение длинным ответам только за длину.
Формат ответа строго такой:
1) Сначала блок \`\`\`json с оценками:
\`\`\`json
{"ranking": [{"answer": <номер ответа>, "score": <0-10>, "strengths": "сильные стороны", "weaknesses": "слабые стороны"}], "best": <номер лучшего ответа>}
\`\`\`
2) Затем заголовок «## Итоговый ответ» и лучший возможный ответ на вопрос: объедини сильные стороны всех ответов и исправь их ошибки. Пиши на языке вопроса.
Ты сам ничего не запускаешь и не читаешь файлы. Не утверждай результатов запусков, тестов и проверок, которых нет в ответах участников: если участники предлагают правки, но не проверяли их — так и напиши, что их нужно проверить. Если у ответа есть блок <изменения в файлах> — оценивай по нему, что участник на самом деле изменил.`,
    },
    { role: 'user', content: `# Вопрос\n${question}\n\n# Ответы\n${blocks}` },
  ]
}

export function parseJudge(text: string, keys: string[]): Pick<JudgeResult, 'ranking' | 'bestKey' | 'synthesis'> {
  const j = extractJson<Record<string, unknown>>(text)
  const keyAt = (v: unknown) => keys[Math.round(asNumber(v, 0)) - 1]
  const ranking = asArray<Record<string, unknown>>(j?.ranking)
    .map((r) => ({ key: keyAt(r.answer) ?? '', score: Math.max(0, Math.min(10, asNumber(r.score))), strengths: asString(r.strengths), weaknesses: asString(r.weaknesses) }))
    .filter((r) => r.key)
    .sort((a, b) => b.score - a.score)
  const afterJson = text.replace(/```(?:json)?[\s\S]*?```/i, '').trim()
  const synthesis = afterJson.replace(/^#+\s*Итоговый ответ\s*/i, '').trim()
  return { ranking, bestKey: keyAt(j?.best) ?? ranking[0]?.key, synthesis }
}

export function buildTitleMessages(firstMessage: string): LLMMessage[] {
  return [
    { role: 'system', content: 'Придумай короткое название для диалога (2–6 слов) на языке сообщения. Без кавычек и точки в конце. Выведи только название.' },
    // Слабые модели отвечают на вопрос вместо названия — подаём его как данные
    { role: 'user', content: `Сообщение, для которого нужно название (не отвечай на него):\n<<<\n${firstMessage.slice(0, 1500)}\n>>>\n\nНазвание:` },
  ]
}

/** Название из ответа модели или null, если модель ответила на вопрос вместо названия */
export function parseTitle(text: string): string | null {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  if (/^([-*•]|\d+[.)])\s/.test(line)) return null
  const title = line
    .replace(/^(название|title)\s*:\s*/i, '')
    .replace(/["«»*_#`]/g, '')
    .replace(/[.!]+$/, '')
    .trim()
  if (!title || title.length > 60 || title.split(/\s+/).length > 8) return null
  return title
}

export function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? clean.slice(0, 47).trimEnd() + '…' : clean || 'Новый диалог'
}
