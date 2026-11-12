import { describe, expect, it } from 'vitest'
import { BUILTIN_AGENTS } from '@/lib/agents'
import { failedNodes, rerunSet, runPipeline, type Pipeline, type PipelineNode } from '@/lib/engine/pipeline'
import { detectRefusal } from '@/lib/engine/refusal'
import { fakeLLM, lastUser } from './helpers'

const getAgent = (id: string) => BUILTIN_AGENTS.find((a) => a.id === id)
const noTool = async () => ({ ok: true, output: '' })

function graph(nodes: Array<Omit<PipelineNode, 'position'>>, edges: Array<[string, string]>): Pipeline {
  return {
    id: 'p', name: 'p', emoji: '', description: '', createdAt: '', updatedAt: '',
    nodes: nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, sourceHandle: null })),
  }
}

describe('детектор отказа', () => {
  it('ловит отказы на русском и английском, не путает с отчётом', () => {
    expect(detectRefusal("I'm sorry, but I can't help with that request.")).toBe('refusal')
    expect(detectRefusal('I cannot assist with creating exploits.')).toBe('refusal')
    expect(detectRefusal('Извините, но я не могу помочь с этим запросом.')).toBe('refusal')
    expect(detectRefusal('Я не буду помогать с этим.')).toBe('refusal')
    expect(detectRefusal('')).toBe('empty')
    expect(detectRefusal('', 3)).toBeNull() // работал инструментами — не пустой ответ
    const report = `## Отчёт\n\nНайдено 3 уязвимости.\n${'Подробности по находкам. '.repeat(60)}\nВ логах приложения есть строка «I cannot help with that», но это текст ошибки сервиса.`
    expect(detectRefusal(report)).toBeNull()
    expect(detectRefusal('### C2 SQL Injection\n- Статус: подтверждено')).toBeNull()
  })
})

describe('отказ модели в пайплайне', () => {
  it('повтор с уточнением, затем запасная модель; отказавшиеся модели отмечены', async () => {
    const { llm, calls } = fakeLLM((req) => (req.model === 'strict' ? 'Извините, но я не могу помочь с этим.' : 'Находка: SQLi в /notes'))
    const p = graph([{ id: 'h', kind: 'agent', label: 'Охотник', config: { model: 'strict', fallbackModels: ['loyal'], retries: 0 } }], [])
    const run = await runPipeline(p, 'аудит', { llm, tool: noTool, getAgent })
    expect(calls.map((c) => c.model)).toEqual(['strict', 'strict', 'loyal'])
    expect(lastUser(calls[1])).toContain('Уточнение от владельца задачи')
    expect(run.nodes.h).toMatchObject({ status: 'done', output: 'Находка: SQLi в /notes', refusals: ['strict', 'strict'] })
  })

  it('все модели отказались — ошибка блока с понятным текстом', async () => {
    const { llm } = fakeLLM(() => "I can't help with that.")
    const p = graph([{ id: 'h', kind: 'agent', label: 'Охотник', config: { model: 'strict', retries: 0 } }], [])
    const run = await runPipeline(p, 'аудит', { llm, tool: noTool, getAgent })
    expect(run.nodes.h.status).toBe('error')
    expect(run.nodes.h.error).toContain('отказалась')
    expect(run.nodes.h.error).toContain('добавьте блоку запасную модель')
  })
})

describe('общая память запуска', () => {
  it('все блоки пишут в одну память запуска, подписываясь своим названием; можно выключить', async () => {
    const { llm, calls } = fakeLLM(() => 'ок')
    const p = graph(
      [
        { id: 'a', kind: 'agent', label: 'Разведка', config: { model: 'm' } },
        { id: 'b', kind: 'agent', label: 'Охотник', config: { model: 'm' } },
      ],
      [['a', 'b']],
    )
    const run = await runPipeline(p, 'x', { llm, tool: noTool, getAgent }, {}, { runId: 'run_abc' })
    expect(run.memoryId).toBe('run_abc')
    expect(calls.map((c) => [c.session, c.sessionAuthor])).toEqual([['run_abc', 'Разведка'], ['run_abc', 'Охотник']])
    const off = await runPipeline({ ...p, sharedMemory: false }, 'x', { llm, tool: noTool, getAgent })
    expect(off.memoryId).toBeUndefined()
    expect(calls.at(-1)!.session).toBeUndefined()
  })
})

describe('перезапуск', () => {
  const p = graph(
    [
      { id: 'in', kind: 'input', label: 'Вход', config: {} },
      { id: 'scan', kind: 'agent', label: 'Скан', config: { model: 'm', prompt: 'скан' } },
      { id: 'hunt', kind: 'foreach', label: 'Охотник', config: { model: 'm', splitBy: 'lines', retries: 0, prompt: '{{item}}' } },
      { id: 'rep', kind: 'agent', label: 'Отчёт', config: { model: 'm', prompt: 'отчёт по {{Охотник}}' } },
    ],
    [['in', 'scan'], ['scan', 'hunt'], ['hunt', 'rep']],
  )

  it('«повторить упавшие»: готовое берётся из прошлого запуска, успешные элементы не пересчитываются', async () => {
    let flaky = true
    const { llm: first } = fakeLLM((req) => {
      const u = lastUser(req)
      if (u === 'скан') return 'C1\nC2\nC3'
      if (u === 'C2' && flaky) return { error: 'перегрузка' }
      return `итог ${u}`
    })
    const run1 = await runPipeline(p, 'x', { llm: first, tool: noTool, getAgent }, {}, { runId: 'run_1' })
    expect(run1.nodes.hunt.items).toEqual({ done: 3, total: 3, failed: 1 })
    expect(failedNodes(run1)).toEqual(['hunt'])

    flaky = false
    const { llm: second, calls } = fakeLLM((req) => `итог ${lastUser(req)}`)
    const run2 = await runPipeline(p, 'x', { llm: second, tool: noTool, getAgent }, {}, { runId: 'run_2', resume: { previous: run1, rerun: failedNodes(run1) } })
    // Скан не повторялся, из элементов охотника пересчитан только C2, отчёт — заново
    expect(calls.map((c) => lastUser(c))).toEqual(['C2', expect.stringContaining('отчёт по')])
    expect(run2.nodes.scan).toMatchObject({ status: 'done', reused: true, output: 'C1\nC2\nC3' })
    expect(run2.nodes.hunt.items).toEqual({ done: 3, total: 3, failed: 0 })
    expect(run2.nodes.hunt.note).toContain('из прошлого запуска 2')
    expect(run2.nodes.hunt.output).toContain('итог C2')
    expect(run2.memoryId).toBe('run_1') // память продолжается
    expect(run2.status).toBe('done')
  })

  it('«перезапустить с блока» — этот блок и всё, что от него зависит', () => {
    expect([...rerunSet(p, ['hunt'])].sort()).toEqual(['hunt', 'rep'])
    expect([...rerunSet(p, ['scan'])].sort()).toEqual(['hunt', 'rep', 'scan'])
  })
})
