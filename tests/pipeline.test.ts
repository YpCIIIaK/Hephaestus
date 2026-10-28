import { describe, expect, it } from 'vitest'
import { BUILTIN_AGENTS } from '@/lib/agents'
import { estimatePipelineCost, findCycle, runPipeline, validatePipeline, type Pipeline, type PipelineNode } from '@/lib/engine/pipeline'
import { PIPELINE_TEMPLATES } from '@/lib/engine/templates'
import { fakeLLM, lastUser, system } from './helpers'

const getAgent = (id: string) => BUILTIN_AGENTS.find((a) => a.id === id)
const noTool = async () => ({ ok: true, output: 'tool' })

function graph(nodes: Array<Omit<PipelineNode, 'position'>>, edges: Array<[string, string, string?]>): Pipeline {
  return {
    id: 'p',
    name: 'p',
    emoji: '',
    description: '',
    createdAt: '',
    updatedAt: '',
    nodes: nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    edges: edges.map(([s, t, h], i) => ({ id: `e${i}`, source: s, target: t, sourceHandle: h ?? null })),
  }
}

describe('runPipeline', () => {
  it('прокидывает выходы по графу и подставляет шаблоны', async () => {
    const { llm, calls } = fakeLLM((req) => `ответ на [${lastUser(req)}]`)
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'Вход', config: {} },
        { id: 'a', kind: 'agent', label: 'Первый', config: { model: 'm1', prompt: 'Q: {{input}}' } },
        { id: 'b', kind: 'agent', label: 'Второй', config: { model: 'm2', prompt: 'Посмотри {{Первый}}' } },
        { id: 'out', kind: 'output', label: 'Итог', config: {} },
      ],
      [['in', 'a'], ['a', 'b'], ['b', 'out']],
    )
    const run = await runPipeline(p, 'привет', { llm, tool: noTool, getAgent })
    expect(run.status).toBe('done')
    expect(lastUser(calls[0])).toBe('Q: привет')
    expect(lastUser(calls[1])).toBe('Посмотри ответ на [Q: привет]')
    expect(run.output).toBe('ответ на [Посмотри ответ на [Q: привет]]')
    expect(run.usage.promptTokens).toBe(20)
  })

  it('запускает независимые ветки параллельно', async () => {
    let active = 0
    let peak = 0
    const llm = async (req: { model: string }) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 20))
      active--
      return { text: req.model, reasoning: '', tools: [], usage: { promptTokens: 1, completionTokens: 1, cost: 0 }, model: req.model, latencyMs: 20 }
    }
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'a', kind: 'agent', label: 'A', config: { model: 'a' } },
        { id: 'b', kind: 'agent', label: 'B', config: { model: 'b' } },
        { id: 'c', kind: 'agent', label: 'C', config: { model: 'c' } },
        { id: 'm', kind: 'merge', label: 'M', config: {} },
      ],
      [['in', 'a'], ['in', 'b'], ['in', 'c'], ['a', 'm'], ['b', 'm'], ['c', 'm']],
    )
    const run = await runPipeline(p, 'x', { llm, tool: noTool, getAgent })
    expect(peak).toBe(3)
    expect(run.output).toContain('### A\na')
    expect(run.output).toContain('### C\nc')
  })

  it('маршрутизатор запускает только выбранную ветку', async () => {
    const { llm, calls } = fakeLLM((req) => (system(req).includes('маршрутизатор') ? '{"route": 2, "reason": "текст"}' : `от ${req.model}`))
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'r', kind: 'router', label: 'R', config: { routes: [{ id: 'x', label: 'Код' }, { id: 'y', label: 'Текст' }] } },
        { id: 'a', kind: 'agent', label: 'A', config: { model: 'code-model' } },
        { id: 'b', kind: 'agent', label: 'B', config: { model: 'text-model' } },
        { id: 'out', kind: 'output', label: 'out', config: {} },
      ],
      [['in', 'r'], ['r', 'a', 'x'], ['r', 'b', 'y'], ['a', 'out'], ['b', 'out']],
    )
    const run = await runPipeline(p, 'напиши стих', { llm, tool: noTool, getAgent })
    expect(run.nodes.r.route).toBe('y')
    expect(run.nodes.a.status).toBe('skipped')
    expect(run.nodes.b.status).toBe('done')
    expect(run.output).toBe('от text-model')
    expect(calls.map((c) => c.model)).not.toContain('code-model')
  })

  it('маршрутизатор по ключевым словам не зовёт модель', async () => {
    const { llm, calls } = fakeLLM(() => 'ok')
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'r', kind: 'router', label: 'R', config: { routerMode: 'keyword', routes: [{ id: 'x', label: 'Баг', keywords: 'ошибка, баг' }, { id: 'y', label: 'Прочее' }] } },
        { id: 'a', kind: 'merge', label: 'A', config: { template: 'баг' } },
        { id: 'b', kind: 'merge', label: 'B', config: { template: 'прочее' } },
      ],
      [['in', 'r'], ['r', 'a', 'x'], ['r', 'b', 'y']],
    )
    const run = await runPipeline(p, 'Нашёл Ошибка в коде', { llm, tool: noTool, getAgent })
    expect(calls).toHaveLength(0)
    expect(run.output).toBe('баг')
  })

  it('проверка отправляет агента на доработку с замечаниями', async () => {
    let verdicts = 0
    const { llm, calls } = fakeLLM((req) => {
      if (system(req).includes('проверяющий')) {
        verdicts++
        return verdicts === 1 ? '{"pass": false, "feedback": "добавь цифры"}' : '{"pass": true, "score": 9}'
      }
      return lastUser(req).includes('добавь цифры') ? 'версия с цифрами 42' : 'черновик'
    })
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'a', kind: 'agent', label: 'Автор', config: { model: 'm' } },
        { id: 'v', kind: 'validator', label: 'Проверка', config: { maxAttempts: 2 } },
      ],
      [['in', 'a'], ['a', 'v']],
    )
    const run = await runPipeline(p, 'отчёт', { llm, tool: noTool, getAgent })
    expect(run.output).toBe('версия с цифрами 42')
    expect(run.nodes.a.output).toBe('версия с цифрами 42')
    expect(run.nodes.v.attempts).toBe(2)
    expect(calls).toHaveLength(4)
  })

  it('пропускает потомков упавшего узла, использует запасную модель', async () => {
    const { llm } = fakeLLM((req) => (req.model === 'bad' ? { error: 'boom' } : `ok ${req.model}`))
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'a', kind: 'agent', label: 'Падает', config: { model: 'bad', retries: 0 } },
        { id: 'a2', kind: 'agent', label: 'После', config: { model: 'm' } },
        { id: 'b', kind: 'agent', label: 'С запасной', config: { model: 'bad', retries: 0, fallbackModels: ['good'] } },
      ],
      [['in', 'a'], ['a', 'a2'], ['in', 'b']],
    )
    const run = await runPipeline(p, 'x', { llm, tool: noTool, getAgent })
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.a2.status).toBe('skipped')
    expect(run.nodes.b.output).toBe('ok good')
    expect(run.status).toBe('done')
    expect(run.error).toContain('Падает')
  })

  it('останавливается по сигналу', async () => {
    const ac = new AbortController()
    const { llm } = fakeLLM(() => 'x', { delay: 30 })
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'a', kind: 'agent', label: 'A', config: { model: 'm' } },
        { id: 'b', kind: 'agent', label: 'B', config: { model: 'm' } },
      ],
      [['in', 'a'], ['a', 'b']],
    )
    setTimeout(() => ac.abort(), 10)
    const run = await runPipeline(p, 'x', { llm, tool: noTool, getAgent }, {}, { signal: ac.signal })
    expect(run.status).toBe('aborted')
    expect(run.nodes.b.status).not.toBe('done')
  })

  it('берёт настройки агента из библиотеки', async () => {
    const { llm, calls } = fakeLLM(() => 'ok')
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 'a', kind: 'agent', label: 'A', config: { agentId: 'critic' } },
      ],
      [['in', 'a']],
    )
    await runPipeline(p, 'x', { llm, tool: noTool, getAgent })
    expect(system(calls[0])).toContain('критик')
    expect(calls[0].model).toBe('@default')
  })

  it('узлы-инструменты вызывают инструменты', async () => {
    const used: string[] = []
    const tool = async (name: string, args: Record<string, unknown>) => {
      used.push(`${name}:${JSON.stringify(args)}`)
      return { ok: true, output: name === 'web_search' ? '[1] T\nhttps://a.example\ns' : 'содержимое' }
    }
    const { llm } = fakeLLM(() => 'ok')
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'in', config: {} },
        { id: 's', kind: 'search', label: 'S', config: { query: 'найди {{input}}', readPages: 1 } },
        { id: 'f', kind: 'file', label: 'F', config: { path: 'docs/{{input}}.md' } },
        { id: 'w', kind: 'write', label: 'W', config: { path: 'out.md' } },
      ],
      [['in', 's'], ['in', 'f'], ['s', 'w'], ['f', 'w']],
    )
    const run = await runPipeline(p, 'кот', { llm, tool, getAgent })
    expect(used).toContain('web_search:{"query":"найди кот"}')
    expect(used).toContain('fetch_url:{"url":"https://a.example"}')
    expect(used).toContain('read_file:{"path":"docs/кот.md"}')
    expect(used.some((u) => u.startsWith('write_file'))).toBe(true)
    expect(run.status).toBe('done')
  })
})

describe('граф', () => {
  it('находит циклы', () => {
    const p = graph(
      [
        { id: 'a', kind: 'agent', label: 'A', config: { model: 'm' } },
        { id: 'b', kind: 'agent', label: 'B', config: { model: 'm' } },
      ],
      [['a', 'b'], ['b', 'a']],
    )
    expect(findCycle(p.nodes, p.edges)).toEqual(['a', 'b'])
    expect(validatePipeline(p).some((i) => i.level === 'error')).toBe(true)
  })

  it('все шаблоны валидны и без циклов', () => {
    for (const t of PIPELINE_TEMPLATES) {
      expect(validatePipeline(t).filter((i) => i.level === 'error'), t.name).toEqual([])
      const labels = t.nodes.map((n) => n.label)
      expect(new Set(labels).size, `${t.name}: уникальные названия`).toBe(labels.length)
    }
  })

  it('оценивает стоимость', () => {
    const est = estimatePipelineCost(PIPELINE_TEMPLATES[0], 100, () => ({ prompt: 1e-6, completion: 2e-6 }), getAgent)
    expect(est.calls).toBe(4)
    expect(est.min).toBeGreaterThan(0)
    expect(est.max!).toBeGreaterThan(est.min!)
  })
})
