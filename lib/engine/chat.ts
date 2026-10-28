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
  turns: ChatTurn[]
  pinned?: boolean
}

export function attachmentsBlock(atts: Attachment[] | undefined): string {
  if (!atts?.length) return ''
  return atts.map((a) => `<file name="${a.name}">\n${a.content}\n</file>`).join('\n\n')
}

export function userContent(turn: Pick<ChatTurn, 'user' | 'attachments'>): string {
  const files = attachmentsBlock(turn.attachments)
  return files ? `${files}\n\n${turn.user}` : turn.user
}

/**
 * История для конкретного участника: вопросы пользователя и только его собственные
 * ответы. Старые ходы отбрасываются, пока история не влезет в бюджет токенов.
 */
export function buildChatMessages(
  conv: Pick<Conversation, 'turns'>,
  key: string,
  uptoTurn: number,
  systemPrompt: string,
  maxContextTokens: number,
): { messages: LLMMessage[]; droppedTurns: number } {
  const pairs: LLMMessage[][] = []
  for (let i = 0; i < uptoTurn; i++) {
    const turn = conv.turns[i]
    const reply = turn.replies[key]
    const pair: LLMMessage[] = [{ role: 'user', content: userContent(turn) }]
    if (reply && (reply.status === 'done' || (reply.status === 'stopped' && reply.text))) pair.push({ role: 'assistant', content: reply.text })
    else continue // вопрос без ответа этого участника не нужен в его истории
    pairs.push(pair)
  }
  const current: LLMMessage = { role: 'user', content: userContent(conv.turns[uptoTurn]) }
  const fixed = estimateTokens(systemPrompt) + estimateTokens(current.content)
  let budget = maxContextTokens - fixed
  const kept: LLMMessage[][] = []
  for (let i = pairs.length - 1; i >= 0; i--) {
    const cost = pairs[i].reduce((s, m) => s + estimateTokens(m.content) + 4, 0)
    if (cost > budget) break
    budget -= cost
    kept.unshift(pairs[i])
  }
  const dropped = pairs.length - kept.length
  const sys = systemPrompt.trim()
    ? systemPrompt + (dropped ? `\n\n(Ранние ${dropped} сообщ. диалога опущены из-за лимита контекста.)` : '')
    : dropped
      ? `(Ранние ${dropped} сообщ. диалога опущены из-за лимита контекста.)`
      : ''
  return {
    messages: [...(sys ? [{ role: 'system' as const, content: sys }] : []), ...kept.flat(), current],
    droppedTurns: dropped,
  }
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
2) Затем заголовок «## Итоговый ответ» и лучший возможный ответ на вопрос: объедини сильные стороны всех ответов и исправь их ошибки. Пиши на языке вопроса.`,
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
    { role: 'user', content: firstMessage.slice(0, 1500) },
  ]
}

export function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? clean.slice(0, 47).trimEnd() + '…' : clean || 'Новый диалог'
}
