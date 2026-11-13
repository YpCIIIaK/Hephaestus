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

// Шлюз может ещё сходить за каталогом цен — считаем только запросы к модели
const completions = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter(([url]) => String(url).includes('/chat/completions')).length

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
  it('повторяет с бо́льшим лимитом, если весь лимит ушёл на рассуждения', async () => {
    // так отвечала nvidia/nemotron-3.5-super-vl:free в дебатах при лимите 584 токена
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          { choices: [{ delta: { reasoning: 'Нужно возразить оптимисту…' } }] },
          { choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 500, completion_tokens: 584, cost: 0 } },
        ]),
      )
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Возражаю.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 900, cost: 0 } }]))
    vi.stubGlobal('fetch', fetchMock)
    const events = await collect(runLLM({ model: 'nvidia/nemotron-3.5-super-vl:free', messages: [{ role: 'user', content: 'Твоя реплика' }], maxTokens: 584 }))
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(bodies[0]).toMatchObject({ max_tokens: 584 })
    expect(bodies[0].reasoning).toBeUndefined()
    expect(bodies[1]).toMatchObject({ max_tokens: 2048, reasoning: { effort: 'low' } })
    expect(events.some((e) => e.t === 'error')).toBe(false)
    expect(events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')).toBe('Возражаю.')
    expect(events.find((e) => e.t === 'usage')).toMatchObject({ usage: { completionTokens: 1484, cost: 0 } })
  })

  it('сообщает об ошибке, если и повтор ушёл на рассуждения', async () => {
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
    expect(err.message).toContain('2048')
    expect(events.find((e) => e.t === 'usage')).toMatchObject({ usage: { completionTokens: 600, cost: 0 } })
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

describe('шлюз: перегрузка провайдера', () => {
  it('повторяет запрос, если ошибка пришла внутри потока до ответа', async () => {
    // так ответил провайдер Nvidia для nemotron-3-ultra: HTTP 200, а в потоке — ошибка
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sse([{ error: { message: 'Upstream error from Nvidia: Service temporarily overloaded' } }]))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Ок' }, finish_reason: 'stop' }] }]))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const pending = collect(runLLM({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', messages: [{ role: 'user', content: 'Проверь' }] }))
      let settled = false
      void pending.finally(() => (settled = true))
      // Двигаем фальшивое время, пока генератор не завершится; setImmediate (он не подменён)
      // отдаёт управление настоящему циклу событий, чтобы поток успел дочитаться
      while (!settled) {
        await new Promise((r) => setImmediate(r))
        await vi.advanceTimersByTimeAsync(500)
      }
      const events = await pending
      expect(completions(fetchMock)).toBe(2)
      expect(events.find((e) => e.t === 'notice')).toMatchObject({ v: expect.stringMatching(/перегружен/) })
      expect(events.some((e) => e.t === 'error')).toBe(false)
      expect(events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')).toBe('Ок')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ошибку посреди ответа не повторяет, а передаёт как есть', async () => {
    const fetchMock = vi.fn(async () => sse([{ choices: [{ delta: { content: 'Нач' } }] }, { error: { message: 'Service temporarily overloaded', code: 503 } }]))
    vi.stubGlobal('fetch', fetchMock)
    const events = await collect(runLLM({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', messages: [{ role: 'user', content: 'Проверь' }] }))
    expect(completions(fetchMock)).toBe(1)
    expect(events.find((e) => e.t === 'error')).toMatchObject({ message: 'Service temporarily overloaded', status: 503 })
  })

  it('HTTP 503 повторяет, а после исчерпания показывает текст ошибки, а не сырой JSON', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"Provider returned error","metadata":{"raw":"overloaded"}}}', { status: 503, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const events = await collect(runLLM({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', messages: [{ role: 'user', content: 'Проверь' }] }))
    expect(completions(fetchMock)).toBe(4)
    const err = events.find((e) => e.t === 'error') as { message: string; status?: number }
    expect(err.status).toBe(503)
    expect(err.message).toBe('Ошибка 503: Provider returned error (overloaded) — провайдер модели перегружен, попробуйте позже или выберите другую модель')
  })

  it('не повторяет постоянные ошибки вроде 403', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"only available on agentic harnesses"}}', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const events = await collect(runLLM({ model: 'thinkingmachines/inkling-small:free', messages: [{ role: 'user', content: 'Привет' }] }))
    expect(completions(fetchMock)).toBe(1)
    expect(events.find((e) => e.t === 'error')).toMatchObject({ status: 403 })
  })
})

describe('шлюз: вызовы инструментов текстом', async () => {
  const { parseTextToolCalls, partialTagLength } = await import('@/lib/server/text-tool-calls')

  it('разбирает XML- и JSON-формы и пропускает неизвестные инструменты', () => {
    // так ответила nvidia/nemotron-3.5-super-vl:free на этапе «Сбор фактов»
    const xml = '<tool_call>\n<function=web_search>\n<parameter=query>\nбанк россии ключевая ставка\n</parameter>\n<parameter=limit>\n5\n</parameter>\n</function>\n</tool_call>'
    const json = '<tool_call>\n{"name": "fetch_url", "arguments": {"url": "https://cbr.ru"}}\n</tool_call>'
    const calls = parseTextToolCalls(`${xml}\n${json}\n<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>`, ['web_search', 'fetch_url'])
    expect(calls.map((c) => [c.function.name, JSON.parse(c.function.arguments)])).toEqual([
      ['web_search', { query: 'банк россии ключевая ставка', limit: 5 }],
      ['fetch_url', { url: 'https://cbr.ru' }],
    ])
    expect(parseTextToolCalls('<tool_call>{"name": "web_search", "arguments": "{\\"query\\": \\"x\\"}"}', ['web_search'])[0].function.arguments).toBe('{"query":"x"}')
    expect(parseTextToolCalls('обычный ответ', ['web_search'])).toEqual([])
    // формат GLM — так отвечал узел «Перепроверка» в пайплайне аудита
    const glm = parseTextToolCalls(
      'Проверю.<tool_call>read_file<arg_key>path</arg_key><arg_value>lib/clone-runner.ts</arg_value><arg_key>end_line</arg_key><arg_value>150</arg_value></tool_call><tool_call>search_code<arg_key>glob</arg_key><arg_value>app/**</arg_value><arg_key>pattern</arg_key><arg_value>esc\\(</arg_value></tool_call>',
      ['read_file', 'search_code'],
    )
    expect(glm.map((c) => [c.function.name, JSON.parse(c.function.arguments)])).toEqual([
      ['read_file', { path: 'lib/clone-runner.ts', end_line: 150 }],
      ['search_code', { glob: 'app/**', pattern: 'esc\\(' }],
    ])
  })

  it('придерживает только возможное начало тега', () => {
    expect(partialTagLength('Ищу <tool_')).toBe(6)
    expect(partialTagLength('Ищу <')).toBe(1)
    expect(partialTagLength('a < b')).toBe(0)
    expect(partialTagLength('готово')).toBe(0)
  })

  it('выполняет вызов, записанный текстом, и не показывает его в ответе', async () => {
    const answers = [
      sse([{ choices: [{ delta: { content: 'Сейчас поищу.\n<to' } }] }, { choices: [{ delta: { content: 'ol_call>\n<function=web_search>\n<parameter=query>\nставка ЦБ\n</parameter>\n</function>\n</tool_call>' }, finish_reason: 'stop' }] }]),
      sse([{ choices: [{ delta: { content: 'Ставка — 16%.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }]),
    ]
    const bodies: Record<string, unknown>[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/chat/completions')) return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
      bodies.push(JSON.parse(init!.body as string))
      return answers.shift()!
    })
    vi.stubGlobal('fetch', fetchMock)
    const events = await collect(runLLM({ model: 'nvidia/nemotron-3.5-super-vl:free', messages: [{ role: 'user', content: 'Какая ставка ЦБ?' }], tools: ['web'] }))
    const text = events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')
    expect(text).toBe('Сейчас поищу.\nСтавка — 16%.')
    expect(events.find((e) => e.t === 'tool_call')).toMatchObject({ name: 'web_search', args: '{"query":"ставка ЦБ"}' })
    expect(events.some((e) => e.t === 'tool_result')).toBe(true)
    // во втором запросе модель видит свой вызов как настоящий tool_call и результат инструмента
    const msgs = bodies[1].messages as { role: string; content: string | null; tool_calls?: unknown[] }[]
    expect(msgs.at(-2)).toMatchObject({ role: 'assistant', content: 'Сейчас поищу.\n', tool_calls: [{ function: { name: 'web_search' } }] })
    expect(msgs.at(-1)).toMatchObject({ role: 'tool' })
  })

  it('без инструментов текст с <tool_call> отдаётся как есть', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ choices: [{ delta: { content: 'Пример: <tool_call>' }, finish_reason: 'stop' }] }])))
    const events = await collect(runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'Покажи тег' }] }))
    expect(events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')).toBe('Пример: <tool_call>')
  })
})

describe('шлюз: зацикливание и лимит шагов', () => {
  const toolCall = (id: string, name: string, args: string) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }] }])

  it('третий одинаковый вызов с тем же результатом не выполняется', async () => {
    // так зациклился cohere/north-mini-code:free: раз за разом читал src/cart.js
    const answers = [
      toolCall('a', 'read_file', '{"path":"nope.txt"}'),
      toolCall('b', 'read_file', '{"path": "nope.txt"}'),
      toolCall('c', 'read_file', '{"path":"nope.txt"}'),
      sse([{ choices: [{ delta: { content: 'Итог' }, finish_reason: 'stop' }] }]),
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/chat/completions') ? answers.shift()! : new Response('{}'))))
    const events = await collect(runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'Посмотри файл' }], tools: ['files_read'] }))
    const results = events.filter((e) => e.t === 'tool_result') as { ok: boolean; preview: string }[]
    expect(results).toHaveLength(3)
    expect(results[0].preview).toMatch(/не найден/)
    expect(results[2].preview).toMatch(/уже выполнялся 2 раз/)
  })

  it('на последнем шаге просит итог без инструментов, а без итога сообщает об ошибке', async () => {
    const bodies: { tools?: unknown; messages: { role: string; content: string }[] }[] = []
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes('/chat/completions')) return new Response('{}')
        bodies.push(JSON.parse(init!.body as string))
        return toolCall(`c${n}`, 'read_file', `{"path":"f${n++}.txt"}`)
      }),
    )
    const events = await collect(runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'Работай' }], tools: ['files_read'], maxToolSteps: 6 }))
    expect(bodies).toHaveLength(7)
    expect(bodies[3].messages.at(-1)!.content).toMatch(/Осталось 3 действия/)
    expect(bodies[6].tools).toBeUndefined()
    expect(bodies[6].messages.at(-1)!.content).toMatch(/Лимит действий с инструментами исчерпан/)
    expect(events.find((e) => e.t === 'error')).toMatchObject({ message: expect.stringMatching(/исчерпала лимит действий \(6\)/) })
  })
})

describe('шлюз: расход не теряется', () => {
  // Пользователь видел в аналитике $0.8 при фактических $2.36 на Claude Fable 5.2:
  // длинные цепочки с инструментами, упавшие или остановленные на середине, не сообщали расход
  const step = (cost: number) =>
    sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${cost}`, function: { name: 'read_file', arguments: `{"path":"f${cost}.txt"}` } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10_000, completion_tokens: 100, cost } }])

  it('ошибка посреди цепочки — расход сделанных шагов всё равно приходит', async () => {
    const answers = [step(0.4), step(0.5), new Response('{"error":{"message":"bad request"}}', { status: 400 })]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/chat/completions') ? answers.shift()! : new Response('{}'))))
    const events = await collect(runLLM({ model: 'anthropic/claude-fable-5.2', messages: [{ role: 'user', content: 'работай' }], tools: ['files_read'] }))
    expect(events.find((e) => e.t === 'error')).toBeTruthy()
    const usages = events.filter((e) => e.t === 'usage') as { usage: { cost: number } }[]
    expect(usages.at(-1)!.usage.cost).toBeCloseTo(0.9)
  })

  it('после каждого шага с инструментами — промежуточный итог: остановка его не теряет', async () => {
    const answers = [step(0.3), step(0.2), sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.1 } }])]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/chat/completions') ? answers.shift()! : new Response('{}'))))
    const events = await collect(runLLM({ model: 'anthropic/claude-fable-5.2', messages: [{ role: 'user', content: 'работай' }], tools: ['files_read'] }))
    const costs = (events.filter((e) => e.t === 'usage') as { usage: { cost: number } }[]).map((e) => Number(e.usage.cost.toFixed(2)))
    expect(costs).toEqual([0.3, 0.5, 0.6])
  })

  it('расходы ключа по данным OpenRouter', async () => {
    const { parseKeyInfo } = await import('@/lib/server/openrouter-spend')
    expect(parseKeyInfo({ usage: 5.1, usage_daily: 2.36, usage_weekly: 3, usage_monthly: 4, limit: 50, limit_remaining: 44.9 }, 1)).toEqual({ daily: 2.36, weekly: 3, monthly: 4, total: 5.1, limit: 50, remaining: 44.9, fetchedAt: 1 })
    expect(parseKeyInfo({}, 1)).toMatchObject({ daily: 0, limit: null })
  })
})
