import type { DecideRequest, DecideResult, DecisionAnswer } from '../types'
import { rateLimitDelayMs } from './llm'
import { getOpenRouterKey } from './settings'

// Модели решений OpenRouter (Decisions API, альфа): perplexity/pplx-decider,
// typesafe/jev и другие. Не генерируют текст — отвечают на вопросы решениями
// с вероятностями. Документация: openrouter.ai/docs — «Submit a decisions request».

const URL = 'https://openrouter.ai/api/alpha/decisions'
const RETRIES = 2
const TIMEOUT_MS = 60_000

export class DecisionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Ответ провайдера в наш формат; вопрос без ответа или неизвестного вида — отказ */
export function parseAnswers(raw: unknown, questions: DecideRequest['questions']): Record<string, DecisionAnswer> {
  const answers = (raw ?? {}) as Record<string, Record<string, unknown>>
  const out: Record<string, DecisionAnswer> = {}
  for (const [name, q] of Object.entries(questions)) {
    const a = answers[name]
    if (!a || a.type !== q.type) {
      out[name] = { type: 'refusal' }
      continue
    }
    if (a.type === 'choice' && typeof a.choice === 'string') {
      out[name] = { type: 'choice', choice: a.choice, probabilities: (a.probabilities ?? {}) as Record<string, number>, confidence: num(a.confidence) }
    } else if (a.type === 'noul') {
      out[name] = { type: 'noul', noul: num(a.noul), confidence: num(a.confidence) }
    } else if (a.type === 'score') {
      out[name] = { type: 'score', score: num(a.score), probabilities: (a.probabilities ?? {}) as Record<string, number>, confidence: num(a.confidence) }
    } else out[name] = { type: 'refusal' }
  }
  return out
}

/** Заглушка для HEPHAESTUS_MOCK_LLM: первый вариант, «да», середина шкалы */
function mockDecide(req: DecideRequest): DecideResult {
  const answers: Record<string, DecisionAnswer> = {}
  for (const [name, q] of Object.entries(req.questions)) {
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria)
      answers[name] = { type: 'choice', choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])), confidence: 0.8 }
    } else if (q.type === 'noul') answers[name] = { type: 'noul', noul: 0.9, confidence: 0.9 }
    else answers[name] = { type: 'score', score: (q.criteria.length - 1) / 2, probabilities: {}, confidence: 0.6 }
  }
  return { answers, usage: { promptTokens: 100, completionTokens: 0, cost: 0 }, model: req.model, latencyMs: 5 }
}

function describe(status: number, body: string): string {
  let msg = body.slice(0, 300)
  try {
    const j = JSON.parse(body) as { error?: { message?: string } }
    if (j.error?.message) msg = j.error.message
  } catch {
    // не JSON
  }
  const hint =
    status === 402
      ? ' — на счёте OpenRouter нет кредитов: модели решений платные'
      : status === 404
        ? ' — такой модели решений нет, проверьте id'
        : status === 429 || status === 529 || status === 503
          ? ' — провайдер перегружен, попробуйте позже'
          : ''
  return `Модель решений: ошибка ${status}: ${msg}${hint}`
}

export async function decide(req: DecideRequest, signal?: AbortSignal): Promise<DecideResult> {
  if (process.env.HEPHAESTUS_MOCK_LLM === '1') return mockDecide(req)
  const { key } = await getOpenRouterKey()
  if (!key) throw new DecisionError('Не задан ключ OpenRouter — модели решений работают только через него', 401)
  const started = Date.now()
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/YpCIIIaK/Hephaestus', 'X-Title': 'Hephaestus' },
      body: JSON.stringify({ model: req.model, state: req.state, questions: req.questions }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch((e: unknown) => {
      if (signal?.aborted) throw e
      throw new DecisionError(`Модель решений не отвечает (${e instanceof Error ? e.message : String(e)})`, 502)
    })
    const body = await res.text()
    if (!res.ok) {
      if ([429, 502, 503, 529].includes(res.status) && attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, rateLimitDelayMs(attempt, res.headers.get('retry-after'))))
        continue
      }
      throw new DecisionError(describe(res.status, body), res.status)
    }
    let data: { answers?: unknown; model?: string; usage?: { input_tokens?: number; output_tokens?: number; cost?: number } }
    try {
      data = JSON.parse(body)
    } catch {
      throw new DecisionError('Модель решений вернула не JSON', 502)
    }
    return {
      answers: parseAnswers(data.answers, req.questions),
      usage: { promptTokens: data.usage?.input_tokens ?? 0, completionTokens: data.usage?.output_tokens ?? 0, cost: typeof data.usage?.cost === 'number' ? data.usage.cost : null },
      model: req.model,
      latencyMs: Date.now() - started,
    }
  }
}
