import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LLMEvent } from '@/lib/types'

process.env.HEPHAESTUS_STREAM_IDLE_MS = '150'
process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM
const { runLLM } = await import('@/lib/server/llm')

afterEach(() => vi.unstubAllGlobals())

/** Поток, который отдаёт кусок ответа и замолкает навсегда (пока его не оборвут) */
function hangingStream(signal?: AbortSignal | null) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'начало ' } }] })}\n\n`))
      signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    },
  })
}

describe('зависший поток модели', () => {
  it('молчание дольше лимита — обрыв и повтор, второй раз отвечает', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        n++
        if (n === 1) return new Response(hangingStream(init?.signal))
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'готово' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })}\n\ndata: [DONE]\n\n`)
      }),
    )
    const events: LLMEvent[] = []
    const started = Date.now()
    for await (const e of runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'привет' }] })) events.push(e)
    expect(n).toBe(2)
    expect(events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')).toContain('готово')
    expect(events.at(-1)).toMatchObject({ t: 'done' })
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 30_000)

  it('если провайдер молчит всегда — ошибка с понятным текстом, а не вечное ожидание', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(hangingStream(init?.signal))))
    const events: LLMEvent[] = []
    for await (const e of runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'привет' }] })) events.push(e)
    const err = events.find((e) => e.t === 'error') as { message: string } | undefined
    expect(err?.message).toContain('не присылает данные')
  }, 60_000)
})
