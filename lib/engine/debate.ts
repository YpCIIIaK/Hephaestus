import { asArray, asNumber, asString, extractJson } from '../json'
import type { LLMMessage, Usage } from '../types'
import { throwIfAborted, type LLMCall } from './llm'

// Дебаты: несколько моделей по очереди обсуждают тему, в конце судья
// подводит итог и ставит оценки.

export type DebateMode = 'debate' | 'brainstorm' | 'council' | 'critique'

export interface DebateParticipant {
  id: string
  name: string
  model: string
  persona: string
  color: string
}

export interface DebateConfig {
  topic: string
  mode: DebateMode
  rounds: number
  participants: DebateParticipant[]
  judge: { enabled: boolean; model: string }
  /** Сколько истории видят участники */
  memory: 'full' | 'recent'
  maxWords: number
  temperature: number
  /** Пауза после каждого раунда, чтобы пользователь мог вмешаться */
  pauseBetweenRounds: boolean
}

export interface DebateMessage {
  id: string
  round: number
  speaker: string // id участника, 'user' или 'judge'
  content: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  usage?: Usage
  model?: string
  startedAt: number
  endedAt?: number
}

export interface DebateVerdict {
  summary: string
  consensus: string
  disagreements: string[]
  scores: { participantId: string; score: number; comment: string }[]
  winnerId?: string
  recommendation: string
}

export const DEBATE_MODES: Record<DebateMode, { title: string; hint: string; emoji: string }> = {
  debate: { title: 'Дебаты', hint: 'Позиции, аргументы и контраргументы', emoji: '⚔️' },
  brainstorm: { title: 'Мозговой штурм', hint: 'Развивают идеи друг друга и предлагают новые', emoji: '💡' },
  council: { title: 'Совет экспертов', hint: 'Каждый смотрит со своей стороны, вместе ищут решение', emoji: '🏛️' },
  critique: { title: 'Автор и критики', hint: 'Первый пишет черновик, остальные критикуют, автор дорабатывает', emoji: '✍️' },
}

const MODE_RULES: Record<DebateMode, (round: number, total: number, isAuthor: boolean) => string> = {
  debate: (round, total) =>
    round === 1
      ? 'Это вступительное слово. Займи чёткую позицию и приведи 2–3 сильнейших аргумента.'
      : round === total
        ? 'Это заключительный раунд. Ответь на самые сильные возражения оппонентов и подведи итог своей позиции. Можно признать правоту оппонента там, где он прав.'
        : 'Ответь оппонентам: разбери их аргументы по существу, укажи на слабые места и усили свою позицию новыми доводами. Обращайся к участникам по имени.',
  brainstorm: (round) =>
    round === 1
      ? 'Предложи 3–5 оригинальных идей. Коротко поясни каждую.'
      : 'Выбери лучшие идеи коллег и развивай их дальше, скомбинируй, предложи новые. Не повторяй уже сказанное.',
  council: (round, total) =>
    round === 1
      ? 'Дай экспертную оценку ситуации со своей профессиональной точки зрения: главные факторы, риски, что рекомендуешь.'
      : round === total
        ? 'Сформулируй итоговую рекомендацию с учётом мнений коллег. Отметь, где вы согласны, а где остаётся разногласие.'
        : 'Учти мнения коллег: с чем согласен, что упустили, что уточнить. Двигай совет к общему решению.',
  critique: (round, _total, isAuthor) =>
    isAuthor
      ? round === 1
        ? 'Ты — автор. Подготовь полноценный первый вариант решения задачи.'
        : 'Ты — автор. Учти критику из прошлого раунда и выдай полную улучшенную версию. В начале одной строкой перечисли, что изменил.'
      : 'Ты — критик. Найди конкретные слабые места в последней версии автора и предложи, как их исправить. Не переписывай работу целиком.',
}

export function speakerOrder(config: DebateConfig, round: number): DebateParticipant[] {
  if (config.mode === 'critique') {
    const [author, ...critics] = config.participants
    // В первом раунде пишет только автор, дальше: критики → автор
    if (round === 1) return author ? [author] : []
    return [...critics, author].filter(Boolean)
  }
  return config.participants
}

export function totalRounds(config: DebateConfig): number {
  return Math.max(1, config.rounds)
}

function nameOf(config: DebateConfig, speaker: string): string {
  if (speaker === 'user') return 'Пользователь'
  if (speaker === 'judge') return 'Судья'
  return config.participants.find((p) => p.id === speaker)?.name ?? speaker
}

export function buildParticipantMessages(
  config: DebateConfig,
  me: DebateParticipant,
  transcript: DebateMessage[],
  round: number,
): LLMMessage[] {
  const isAuthor = config.mode === 'critique' && config.participants[0]?.id === me.id
  const others = config.participants.filter((p) => p.id !== me.id).map((p) => p.name)
  const system = [
    `Тебя зовут ${me.name}. Ты участвуешь в обсуждении (${DEBATE_MODES[config.mode].title.toLowerCase()}) вместе с: ${others.join(', ') || 'никем'}.`,
    me.persona ? `Твоя роль и позиция: ${me.persona}` : '',
    `Правила: отвечай на языке темы; не больше ${config.maxWords} слов; не повторяй уже сказанное; не пиши от имени других участников; не начинай с приветствий и представлений.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const done = transcript.filter((m) => m.status === 'done' && m.speaker !== 'judge')
  const visible = config.memory === 'recent' ? done.filter((m) => m.round >= round - 1 || m.speaker === me.id || m.speaker === 'user') : done
  const history = visible
    .map((m) => {
      const who = m.speaker === me.id ? `${me.name} (ты)` : nameOf(config, m.speaker)
      return `**${who}** · раунд ${m.round}:\n${m.content}`
    })
    .join('\n\n')

  const task = MODE_RULES[config.mode](round, totalRounds(config), isAuthor)
  const user = [`# Тема\n${config.topic}`, history ? `# Ход обсуждения\n${history}` : '', `# Твой ход — раунд ${round} из ${totalRounds(config)}\n${task}`]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function buildJudgeMessages(config: DebateConfig, transcript: DebateMessage[]): LLMMessage[] {
  const roster = config.participants.map((p) => `- id "${p.id}": ${p.name}${p.persona ? ` — ${p.persona}` : ''}`).join('\n')
  const history = transcript
    .filter((m) => m.status === 'done' && m.speaker !== 'judge')
    .map((m) => `**${nameOf(config, m.speaker)}** · раунд ${m.round}:\n${m.content}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content: `Ты — беспристрастный судья обсуждения (${DEBATE_MODES[config.mode].title.toLowerCase()}). Оцени качество аргументов, точность, глубину и вклад каждого участника, а не то, совпадает ли позиция с твоей. Пиши на языке темы.
Верни только JSON:
{
  "summary": "краткий пересказ хода обсуждения (3–5 предложений)",
  "consensus": "в чём участники сошлись",
  "disagreements": ["ключевое разногласие", "..."],
  "scores": [{"participantId": "<id>", "score": <0-10>, "comment": "за что такая оценка"}],
  "winnerId": "<id участника с лучшими аргументами>",
  "recommendation": "итоговый вывод или рекомендация для пользователя"
}`,
    },
    { role: 'user', content: `# Тема\n${config.topic}\n\n# Участники\n${roster}\n\n# Стенограмма\n${history}` },
  ]
}

export function parseVerdict(text: string, config: DebateConfig): DebateVerdict | null {
  const j = extractJson<Record<string, unknown>>(text)
  if (!j || typeof j !== 'object') return null
  const ids = new Set(config.participants.map((p) => p.id))
  const findId = (raw: unknown) => {
    const s = asString(raw)
    if (ids.has(s)) return s
    return config.participants.find((p) => p.name.toLowerCase() === s.toLowerCase())?.id
  }
  const scores = asArray<Record<string, unknown>>(j.scores)
    .map((s) => ({ participantId: findId(s.participantId ?? s.id ?? s.name) ?? '', score: Math.max(0, Math.min(10, asNumber(s.score))), comment: asString(s.comment) }))
    .filter((s) => s.participantId)
  return {
    summary: asString(j.summary),
    consensus: asString(j.consensus),
    disagreements: asArray(j.disagreements).map((d) => asString(d)).filter(Boolean),
    scores,
    winnerId: findId(j.winnerId) ?? scores.slice().sort((a, b) => b.score - a.score)[0]?.participantId,
    recommendation: asString(j.recommendation),
  }
}

export interface DebateHooks {
  onMessage: (msg: DebateMessage) => void
  onUpdate: (id: string, patch: Partial<DebateMessage>) => void
  onRound: (round: number) => void
  /** Пауза между раундами; можно вернуть реплику пользователя */
  betweenRounds?: (finishedRound: number) => Promise<string | null | 'stop'>
  onVerdict: (v: DebateVerdict | null, raw: string, usage?: Usage) => void
}

let seq = 0
const msgId = () => `dm_${Date.now().toString(36)}_${(seq++).toString(36)}`

/** Продолжает дебаты с раунда fromRound (1 — с начала) */
export async function runDebate(
  config: DebateConfig,
  transcript: DebateMessage[],
  fromRound: number,
  llm: LLMCall,
  hooks: DebateHooks,
  signal?: AbortSignal,
): Promise<'finished' | 'stopped'> {
  const log = [...transcript]
  const total = totalRounds(config)
  for (let round = fromRound; round <= total; round++) {
    throwIfAborted(signal)
    hooks.onRound(round)
    for (const p of speakerOrder(config, round)) {
      throwIfAborted(signal)
      const msg: DebateMessage = { id: msgId(), round, speaker: p.id, content: '', status: 'streaming', model: p.model, startedAt: Date.now() }
      hooks.onMessage(msg)
      log.push(msg)
      let content = ''
      const res = await llm(
        { model: p.model, messages: buildParticipantMessages(config, p, log, round), temperature: config.temperature, maxTokens: Math.ceil(config.maxWords * 3.2) + 200 },
        {
          signal,
          meta: { source: 'debate', label: p.name },
          onEvent: (e) => {
            if (e.t === 'text') {
              content += e.v
              hooks.onUpdate(msg.id, { content })
            }
          },
        },
      )
      if (res.aborted) {
        hooks.onUpdate(msg.id, { status: 'error', error: 'Остановлено', endedAt: Date.now() })
        return 'stopped'
      }
      const patch: Partial<DebateMessage> = res.error
        ? { status: 'error', error: res.error, content: res.text, endedAt: Date.now(), usage: res.usage }
        : { status: 'done', content: res.text, endedAt: Date.now(), usage: res.usage, model: res.model }
      Object.assign(msg, patch)
      hooks.onUpdate(msg.id, patch)
    }
    if (round < total && hooks.betweenRounds) {
      const reply = await hooks.betweenRounds(round)
      if (reply === 'stop') return 'stopped'
      if (reply?.trim()) {
        const userMsg: DebateMessage = { id: msgId(), round, speaker: 'user', content: reply.trim(), status: 'done', startedAt: Date.now(), endedAt: Date.now() }
        hooks.onMessage(userMsg)
        log.push(userMsg)
      }
    }
  }
  if (config.judge.enabled) await judgeDebate(config, log, llm, hooks, signal)
  return 'finished'
}

export async function judgeDebate(config: DebateConfig, transcript: DebateMessage[], llm: LLMCall, hooks: Pick<DebateHooks, 'onVerdict'>, signal?: AbortSignal) {
  throwIfAborted(signal)
  const res = await llm(
    { model: config.judge.model, messages: buildJudgeMessages(config, transcript), temperature: 0.2, maxTokens: 2500, jsonMode: true },
    { signal, meta: { source: 'judge', label: 'Судья дебатов' } },
  )
  if (res.aborted) return
  hooks.onVerdict(res.error ? null : parseVerdict(res.text, config), res.error ?? res.text, res.usage)
}
