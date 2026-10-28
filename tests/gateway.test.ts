import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LLMEvent } from '@/lib/types'

process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM

const { runLLM, rateLimitDelayMs } = await import('@/lib/server/llm')

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect(gen: AsyncGenerator<LLMEvent>): Promise<LLMEvent[]> {
  const out: LLMEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

afterEach(() => vi.unstubAllGlobals())

describe('шлюз: лимиты бесплатных моделей', () => {
  it('считает паузу по Retry-After или по экспоненте с потолком', () => {
    expect(rateLimitDelayMs(0, '2')).toBe(2000)
    expect(rateLimitDelayMs(0)).toBe(4000)
    expect(rateLimitDelayMs(2)).toBe(16000)
    expect(rateLimitDelayMs(10)).toBe(30000)
    expect(rateLimitDelayMs(1, 'Wed, 21 Oct 2026 07:28:00 GMT')).toBe(8000)
  })

  it('повторяет запрос после 429 и отдаёт ответ', async () => {
    const limited = () =>
      new Response(JSON.stringify({ error: { message: 'Provider returned error', code: 429 } }), { status: 429, headers: { 'Retry-After': '0' } })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Готово' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0 } }]))
    vi.stubGlobal('fetch', fetchMock)

    const events = await collect(runLLM({ model: 'google/gemma-4-31b-it:free', messages: [{ role: 'user', content: 'Привет' }] }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(events.filter((e) => e.t === 'notice')).toHaveLength(2)
    expect(events.some((e) => e.t === 'error')).toBe(false)
    expect(events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')).toBe('Готово')
    expect(events.find((e) => e.t === 'usage')).toMatchObject({ usage: { cost: 0 } })
  })

  it('после исчерпания повторов показывает понятную ошибку', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"rate-limited upstream"}}', { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)

    const events = await collect(runLLM({ model: 'google/gemma-4-31b-it:free', messages: [{ role: 'user', content: 'Привет' }] }))
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const err = events.find((e) => e.t === 'error') as { message: string; status?: number }
    expect(err.status).toBe(429)
    expect(err.message).toMatch(/превышен лимит запросов/)
  })
})

describe('шлюз: рассуждающие модели', () => {
  it('сообщает об ошибке, если весь лимит ушёл на рассуждения', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          { choices: [{ delta: { reasoning: 'Думаю о столице…' } }] },
          { choices: [{ delta: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 60, completion_tokens: 300, cost: 0 } },
        ]),
      ),
    )
    const events = await collect(runLLM({ model: 'nvidia/nemotron-3.5-lightning:free', messages: [{ role: 'user', content: 'Столица Японии?' }], maxTokens: 300 }))
    expect(events.some((e) => e.t === 'reasoning')).toBe(true)
    const err = events.find((e) => e.t === 'error') as { message: string }
    expect(err.message).toMatch(/рассуждения/)
    expect(events.find((e) => e.t === 'usage')).toMatchObject({ usage: { completionTokens: 300, cost: 0 } })
  })

  it('принимает reasoning_content и обрезанный, но непустой ответ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          { choices: [{ delta: { reasoning_content: 'хм' } }] },
          { choices: [{ delta: { content: 'Токио' }, finish_reason: 'length' }] },
        ]),
      ),
    )
    const events = await collect(runLLM({ model: 'nvidia/nemotron-3.5-lightning:free', messages: [{ role: 'user', content: 'Столица Японии?' }] }))
    expect(events.some((e) => e.t === 'error')).toBe(false)
    expect(events.find((e) => e.t === 'done')).toMatchObject({ finish: 'length' })
  })
})
