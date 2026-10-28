import type { LLMEvent, LLMMessage, LLMRequest, ToolCall, Usage } from '../types'
import { addUsage, computeCost, providerOf, upstreamModelId, ZERO_USAGE } from '../models'
import { SSEParser } from '../sse'
import { findModel } from './catalog'
import { getCustomEndpoint, getOllamaUrl, getOpenRouterKey } from './settings'
import { buildTools, runTool, type ToolDefinition } from './tools'
import { mockStream } from './mock-llm'

// Единый шлюз к моделям. Все провайдеры говорят на OpenAI-совместимом API
// (OpenRouter, Ollama /v1, LM Studio, vLLM…), поэтому клиент один.
// Ответ — поток событий LLMEvent; цикл вызова инструментов идёт на сервере.

const DEFAULT_MAX_STEPS = 8
// Бесплатные модели OpenRouter часто отвечают 429 («rate-limited upstream»):
// такой запрос безопасно повторить, ведь ответ ещё не начался.
const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_BASE_DELAY_MS = 4000
const RATE_LIMIT_MAX_DELAY_MS = 30_000

interface Endpoint {
  url: string
  headers: Record<string, string>
  provider: 'openrouter' | 'ollama' | 'custom'
}

class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfter?: string | null,
  ) {
    super(message)
  }
}

/** Пауза перед повтором после 429: Retry-After, если провайдер его прислал, иначе экспонента */
export function rateLimitDelayMs(attempt: number, retryAfter?: string | null): number {
  const secs = retryAfter ? Number(retryAfter) : NaN
  const ms = Number.isFinite(secs) && secs >= 0 ? secs * 1000 : RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt
  return Math.min(ms, RATE_LIMIT_MAX_DELAY_MS)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done)
  })
}

async function endpointFor(modelId: string): Promise<Endpoint> {
  const provider = providerOf(modelId)
  if (provider === 'ollama') {
    return { provider, url: `${await getOllamaUrl()}/v1/chat/completions`, headers: {} }
  }
  if (provider === 'custom') {
    const ep = await getCustomEndpoint()
    if (!ep) throw new GatewayError('Свой сервер не настроен: укажите адрес в настройках', 400)
    return { provider, url: `${ep.url}/chat/completions`, headers: ep.key ? { Authorization: `Bearer ${ep.key}` } : {} }
  }
  const { key } = await getOpenRouterKey()
  if (!key) throw new GatewayError('Не задан ключ OpenRouter. Добавьте его в настройках или в .env (OPENROUTER_API_KEY)', 401)
  return {
    provider,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/YpCIIIaK/Hephaestus',
      'X-Title': 'Hephaestus',
    },
  }
}

function dateContext(): string {
  const now = new Date()
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone
  return `Текущая дата и время: ${now.toLocaleString('ru-RU', { dateStyle: 'full', timeStyle: 'short', timeZone: tz })} (${tz}).`
}

function withDate(messages: LLMMessage[]): LLMMessage[] {
  const msgs = [...messages]
  if (msgs[0]?.role === 'system') msgs[0] = { ...msgs[0], content: `${msgs[0].content ?? ''}\n\n${dateContext()}`.trim() }
  else msgs.unshift({ role: 'system', content: dateContext() })
  return msgs
}

interface StepResult {
  text: string
  reasoned: boolean
  toolCalls: ToolCall[]
  usage: Usage | null
  finish: string
}

function looksLikeToolsUnsupported(status: number, body: string) {
  return (status === 400 || status === 404) && /tool|function/i.test(body)
}

function looksLikeJsonModeUnsupported(status: number, body: string) {
  return status === 400 && /response_format|json/i.test(body)
}

function describeHttpError(status: number, body: string): string {
  let msg = body
  try {
    const j = JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: string } } | string }
    if (typeof j.error === 'string') msg = j.error
    else if (j.error?.message) msg = j.error.message + (j.error.metadata?.raw ? ` (${j.error.metadata.raw.slice(0, 200)})` : '')
  } catch {
    // тело не JSON
  }
  const hint =
    status === 401 ? ' — проверьте ключ API' : status === 402 ? ' — на счёте OpenRouter закончились средства' : status === 429 ? ' — превышен лимит запросов, попробуйте позже' : ''
  return `Ошибка ${status}: ${msg.slice(0, 400)}${hint}`
}

async function* streamStep(
  ep: Endpoint,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): AsyncGenerator<LLMEvent, StepResult> {
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ep.headers },
    body: JSON.stringify(body),
    signal,
  }).catch((e: unknown) => {
    if (signal?.aborted) throw e
    const where = ep.provider === 'ollama' ? 'Ollama не отвечает — запущен ли он?' : 'Нет соединения с провайдером'
    throw new GatewayError(`${where} (${e instanceof Error ? e.message : String(e)})`, 502)
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new GatewayError(text, res.status, res.headers.get('retry-after'))
  }

  const calls: { id: string; name: string; args: string }[] = []
  let text = ''
  let reasoned = false
  let usage: Usage | null = null
  let finish = 'stop'
  const queue: LLMEvent[] = []

  const parser = new SSEParser((data) => {
    if (data === '[DONE]') return
    let chunk: {
      error?: { message?: string; code?: number }
      choices?: {
        delta?: {
          content?: string | null
          reasoning?: string | null
          reasoning_content?: string | null
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
        finish_reason?: string | null
      }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    }
    try {
      chunk = JSON.parse(data)
    } catch {
      return
    }
    if (chunk.error) {
      queue.push({ t: 'error', message: chunk.error.message ?? 'Ошибка провайдера', status: chunk.error.code })
      return
    }
    const choice = chunk.choices?.[0]
    const delta = choice?.delta
    if (delta?.content) {
      text += delta.content
      queue.push({ t: 'text', v: delta.content })
    }
    const reasoning = delta?.reasoning ?? delta?.reasoning_content
    if (reasoning) {
      reasoned = true
      queue.push({ t: 'reasoning', v: reasoning })
    }
    for (const tc of delta?.tool_calls ?? []) {
      const i = tc.index ?? calls.length
      calls[i] ??= { id: '', name: '', args: '' }
      if (tc.id) calls[i].id = tc.id
      if (tc.function?.name) calls[i].name += tc.function.name
      if (tc.function?.arguments) calls[i].args += tc.function.arguments
    }
    if (choice?.finish_reason) finish = choice.finish_reason
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        cost: typeof chunk.usage.cost === 'number' ? chunk.usage.cost : null,
      }
    }
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
      while (queue.length) yield queue.shift()!
    }
    parser.flush()
    while (queue.length) yield queue.shift()!
  } finally {
    reader.releaseLock()
  }

  const toolCalls: ToolCall[] = calls
    .filter((c) => c && c.name)
    .map((c, i) => ({ id: c.id || `call_${i}_${Date.now()}`, type: 'function', function: { name: c.name, arguments: c.args } }))
  return { text, reasoned, toolCalls, usage, finish }
}

export async function* runLLM(req: LLMRequest, signal?: AbortSignal): AsyncGenerator<LLMEvent> {
  if (process.env.HEPHAESTUS_MOCK_LLM === '1') {
    yield* mockStream(req, signal)
    return
  }

  let ep: Endpoint
  try {
    ep = await endpointFor(req.model)
  } catch (e) {
    yield { t: 'error', message: e instanceof Error ? e.message : String(e), status: e instanceof GatewayError ? e.status : 500 }
    return
  }

  let tools: ToolDefinition[] = await buildTools(req.tools)
  let jsonMode = !!req.jsonMode
  const maxSteps = Math.min(req.maxToolSteps ?? DEFAULT_MAX_STEPS, 20)
  const messages = withDate(req.messages)
  let total: Usage = { ...ZERO_USAGE, cost: null }
  let finish = 'stop'
  let rateRetries = 0

  for (let step = 0; step <= maxSteps; step++) {
    const body: Record<string, unknown> = {
      model: upstreamModelId(req.model),
      messages,
      stream: true,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream_options: { include_usage: true },
    }
    if (ep.provider === 'openrouter') body.usage = { include: true }
    if (tools.length && step < maxSteps) {
      body.tools = tools
      body.tool_choice = 'auto'
    }
    if (jsonMode) body.response_format = { type: 'json_object' }

    let result: StepResult
    try {
      result = yield* streamStep(ep, body, signal)
    } catch (e) {
      if (signal?.aborted) return
      if (e instanceof GatewayError && e.status === 502) {
        yield { t: 'error', message: e.message, status: 502 }
        return
      }
      if (e instanceof GatewayError && e.status === 429 && rateRetries < RATE_LIMIT_RETRIES) {
        const delay = rateLimitDelayMs(rateRetries, e.retryAfter)
        rateRetries++
        yield { t: 'notice', v: `Лимит запросов провайдера — повтор через ${Math.round(delay / 1000)} с (${rateRetries}/${RATE_LIMIT_RETRIES})` }
        await sleep(delay, signal)
        if (signal?.aborted) return
        step--
        continue
      }
      if (e instanceof GatewayError && e.status && e.status >= 400) {
        if (tools.length && looksLikeToolsUnsupported(e.status, e.message)) {
          yield { t: 'notice', v: 'Модель не поддерживает инструменты — отвечает без них' }
          tools = []
          step--
          continue
        }
        if (jsonMode && looksLikeJsonModeUnsupported(e.status, e.message)) {
          jsonMode = false
          step--
          continue
        }
        yield { t: 'error', message: describeHttpError(e.status, e.message), status: e.status }
        return
      }
      yield { t: 'error', message: e instanceof Error ? e.message : String(e), status: e instanceof GatewayError ? e.status : 500 }
      return
    }

    const stepUsage: Usage = result.usage ?? { promptTokens: 0, completionTokens: 0, cost: null }
    if (stepUsage.cost == null) {
      const info = ep.provider === 'openrouter' ? await findModel(req.model) : undefined
      stepUsage.cost = ep.provider === 'ollama' ? 0 : computeCost(info, stepUsage.promptTokens, stepUsage.completionTokens)
    }
    total = addUsage(total, stepUsage)
    finish = result.finish

    if (!result.toolCalls.length) {
      // Рассуждающие модели могут потратить весь max_tokens на рассуждения и не дать ответа
      if (result.finish === 'length' && result.reasoned && !result.text.trim()) {
        yield {
          t: 'error',
          message: `Модель израсходовала весь лимит токенов (${body.max_tokens}) на рассуждения и не дала ответа — увеличьте лимит или выберите модель без рассуждений`,
        }
        yield { t: 'usage', usage: total, model: req.model }
        return
      }
      break
    }
    if (step === maxSteps) {
      yield { t: 'notice', v: `Достигнут лимит шагов с инструментами (${maxSteps})` }
      break
    }

    messages.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls })
    for (const call of result.toolCalls) {
      yield { t: 'tool_call', id: call.id, name: call.function.name, args: call.function.arguments }
      const { ok, output } = await runTool(call.function.name, call.function.arguments, signal)
      yield { t: 'tool_result', id: call.id, name: call.function.name, ok, preview: output.slice(0, 600) }
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: output })
    }
  }

  yield { t: 'usage', usage: total, model: req.model }
  yield { t: 'done', finish }
}
