import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_AGENTS } from '@/lib/agents'
import type { DecideCall } from '@/lib/engine/llm'
import { runPipeline, type Pipeline, type PipelineNode } from '@/lib/engine/pipeline'
import type { DecideResult, DecisionAnswer } from '@/lib/types'
import { fakeLLM, lastUser, system } from './helpers'

process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM
const { decide, parseAnswers } = await import('@/lib/server/decisions')

const getAgent = (id: string) => BUILTIN_AGENTS.find((a) => a.id === id)
const noTool = async () => ({ ok: true, output: 'tool' })
const usage = { promptTokens: 300, completionTokens: 0, cost: 0.000006 }

function graph(nodes: Array<Omit<PipelineNode, 'position'>>, edges: Array<[string, string, string?]>): Pipeline {
  return {
    id: 'p', name: 'p', emoji: '', description: '', createdAt: '', updatedAt: '',
    nodes: nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    edges: edges.map(([s, t, h], i) => ({ id: `e${i}`, source: s, target: t, sourceHandle: h ?? null })),
  }
}

function fakeDecider(answer: (req: Parameters<DecideCall>[0]) => Record<string, DecisionAnswer> | { error: string }) {
  const calls: Parameters<DecideCall>[0][] = []
  const decideCall: DecideCall = async (req) => {
    calls.push(req)
    const a = answer(req)
    return 'error' in a ? ({ answers: {}, usage, model: 'd', latencyMs: 1, error: a.error as string } satisfies DecideResult) : { answers: a, usage, model: 'd', latencyMs: 1 }
  }
  return { decideCall, calls }
}

const routerGraph = () =>
  graph(
    [
      { id: 'in', kind: 'input', label: 'in', config: {} },
      { id: 'r', kind: 'router', label: 'R', config: { routes: [{ id: 'code', label: 'Код', keywords: 'программирование' }, { id: 'text', label: 'Текст' }] } },
      { id: 'a', kind: 'agent', label: 'A', config: { model: 'code-model' } },
      { id: 'b', kind: 'agent', label: 'B', config: { model: 'text-model' } },
    ],
    [['in', 'r'], ['r', 'a', 'code'], ['r', 'b', 'text']],
  )

describe('модель решений в пайплайнах', () => {
  it('маршрутизатор выбирает ветку моделью решений и не зовёт LLM', async () => {
    const { llm, calls } = fakeLLM((req) => `от ${req.model}`)
    const { decideCall, calls: dCalls } = fakeDecider(() => ({ route: { type: 'choice', choice: 'code', probabilities: { code: 0.84, text: 0.16 }, confidence: 0.75 } }))
    const run = await runPipeline(routerGraph(), 'напиши функцию сортировки', { llm, tool: noTool, getAgent, decide: decideCall })
    expect(run.nodes.r.route).toBe('code')
    expect(run.nodes.r.note).toBe('→ Код (модель решений, 84%)')
    expect(dCalls[0].questions.route).toEqual({ type: 'choice', instructions: expect.any(String), criteria: { code: 'Код: программирование', text: 'Текст' } })
    expect(dCalls[0].state).toBe('напиши функцию сортировки')
    // LLM вызывалась только для агента выбранной ветки
    expect(calls.map((c) => c.model)).toEqual(['code-model'])
    expect(run.usage.cost).toBeCloseTo(0.000006 + 0.001)
  })

  it('если модель решений недоступна, ветку выбирает LLM', async () => {
    const { llm, calls } = fakeLLM((req) => (system(req).includes('маршрутизатор') ? '{"route": 2}' : `от ${req.model}`))
    const { decideCall } = fakeDecider(() => ({ error: 'Модель решений: ошибка 402' }))
    const run = await runPipeline(routerGraph(), 'стих', { llm, tool: noTool, getAgent, decide: decideCall })
    expect(run.nodes.r.route).toBe('text')
    expect(calls).toHaveLength(2)
  })

  it('отказ или неизвестный вариант — тоже к LLM', async () => {
    const { llm } = fakeLLM((req) => (system(req).includes('маршрутизатор') ? '{"route": 1}' : 'ok'))
    const { decideCall } = fakeDecider(() => ({ route: { type: 'choice', choice: 'нет-такой', probabilities: {}, confidence: 0.2 } }))
    const run = await runPipeline(routerGraph(), 'x', { llm, tool: noTool, getAgent, decide: decideCall })
    expect(run.nodes.r.route).toBe('code')
  })

  it('проверка принимает хороший ответ без LLM, а слабый отдаёт LLM за замечаниями', async () => {
    let checks = 0
    const { llm, calls } = fakeLLM((req) => {
      if (system(req).includes('проверяющий')) return '{"pass": false, "feedback": "добавь цифры"}'
      return lastUser(req).includes('добавь цифры') ? 'версия с цифрами 42' : 'черновик'
    })
    const { decideCall, calls: dCalls } = fakeDecider(() => ({ pass: { type: 'noul', noul: checks++ === 0 ? 0.2 : 0.93, confidence: 0.9 } }))
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'a', kind: 'agent', label: 'Автор', config: { model: 'm' } },
        { id: 'v', kind: 'validator', label: 'Проверка', config: { maxAttempts: 2, criteria: 'Есть цифры' } },
      ],
      [['in', 'a'], ['a', 'v']],
    )
    const run = await runPipeline(p, 'отчёт', { llm, tool: noTool, getAgent, decide: decideCall })
    expect(run.output).toBe('версия с цифрами 42')
    expect(run.nodes.v.note).toBe('Принято с 2-й попытки (модель решений, 93%)')
    expect(dCalls[0].state).toEqual({ request: 'отчёт', criteria: 'Есть цифры', answer: 'черновик' })
    // автор, LLM-проверка с замечаниями, доработка; второй раз LLM-проверка не нужна
    expect(calls).toHaveLength(3)
  })
})

describe('Decisions API', () => {
  afterEach(() => vi.unstubAllGlobals())
  const questions = { route: { type: 'choice' as const, criteria: { a: 'A', b: 'B' } }, ok: { type: 'noul' as const } }

  it('разбирает ответы, а несовпадающий тип считает отказом', () => {
    expect(
      parseAnswers({ route: { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9 }, confidence: 0.8 }, ok: { type: 'refusal' } }, questions),
    ).toEqual({ route: { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9 }, confidence: 0.8 }, ok: { type: 'refusal' } })
  })

  it('шлёт запрос на /api/alpha/decisions и переводит usage', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: 'gen-dec-1', model: 'perplexity/pplx-decider-v1.2', answers: { route: { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.6 }, ok: { type: 'noul', noul: 0.96, confidence: 0.96 } }, usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await decide({ model: 'perplexity/pplx-decider-v1.2', state: 'текст', questions })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'perplexity/pplx-decider-v1.2', state: 'текст', questions })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test')
    expect(r.answers.ok).toEqual({ type: 'noul', noul: 0.96, confidence: 0.96 })
    expect(r.usage).toEqual({ promptTokens: 476, completionTokens: 70, cost: 0.000019992 })
  })

  it('понятно объясняет 402 и не повторяет его', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"code":402,"message":"Insufficient credits"}}', { status: 402 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(decide({ model: 'typesafe/jev-1.14', state: 'x', questions })).rejects.toThrow('Модель решений: ошибка 402: Insufficient credits — на счёте OpenRouter нет кредитов: модели решений платные')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
