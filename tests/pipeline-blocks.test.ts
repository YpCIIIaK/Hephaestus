import { describe, expect, it } from 'vitest'
import { BUILTIN_AGENTS } from '@/lib/agents'
import { itemTitle, runPipeline, splitItems, validatePipeline, type Pipeline, type PipelineNode } from '@/lib/engine/pipeline'
import { fakeLLM, lastUser } from './helpers'

const getAgent = (id: string) => BUILTIN_AGENTS.find((a) => a.id === id)

function graph(nodes: Array<Omit<PipelineNode, 'position'>>, edges: Array<[string, string]>): Pipeline {
  return {
    id: 'p', name: 'p', emoji: '', description: '', createdAt: '', updatedAt: '',
    nodes: nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, sourceHandle: null })),
  }
}

/** Терминал-заглушка: запоминает команды и где они выполнялись */
function fakeShell(answer: (cmd: string, n: number) => { ok: boolean; output: string }) {
  const calls: { cmd: string; sandbox?: string; args: Record<string, unknown> }[] = []
  const tool = async (name: string, args: Record<string, unknown>, _s?: AbortSignal, opts?: { sandbox?: string }) => {
    if (name !== 'run_command') return { ok: true, output: '' }
    calls.push({ cmd: String(args.command), sandbox: opts?.sandbox, args })
    return answer(String(args.command), calls.length)
  }
  return { tool, calls }
}

describe('блок «Команда»', () => {
  it('выполняет команду без модели, вывод — выход блока; ошибка останавливает ветку', async () => {
    const { llm, calls: llmCalls } = fakeLLM((req) => `итог: ${lastUser(req)}`)
    const { tool, calls } = fakeShell((cmd) => (cmd.includes('fail') ? { ok: false, output: 'boom\n[код выхода 2]' } : { ok: true, output: `вывод ${cmd}` }))
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'Вход', config: {} },
        { id: 'c', kind: 'command', label: 'Скан', config: { command: 'scan {{input}}', cwd: 'sub', timeoutSec: 60 } },
        { id: 'a', kind: 'agent', label: 'Итог', config: { model: 'm', prompt: '{{Скан}}' } },
        { id: 'bad', kind: 'command', label: 'Падает', config: { command: 'fail' } },
        { id: 'ok', kind: 'command', label: 'Разрешено', config: { command: 'fail', allowFail: true } },
      ],
      [['in', 'c'], ['c', 'a'], ['in', 'bad'], ['in', 'ok']],
    )
    const run = await runPipeline(p, 'repo', { llm, tool, getAgent })
    expect(calls[0]).toMatchObject({ cmd: 'scan repo', args: { cwd: 'sub', timeout_sec: 60, raw: true } })
    expect(run.nodes.a.output).toBe('итог: вывод scan repo')
    expect(run.nodes.bad.status).toBe('error')
    expect(run.nodes.bad.error).toContain('boom')
    expect(run.nodes.ok.status).toBe('done')
    expect(llmCalls).toHaveLength(1)
    expect(validatePipeline(graph([{ id: 'c', kind: 'command', label: 'К', config: {} }], [])).some((i) => i.message.includes('не указана команда'))).toBe(true)
  })
})

describe('блок «Для каждого»', () => {
  it('делит вход и обрабатывает элементы параллельно, ошибки элементов не роняют блок', async () => {
    let active = 0
    let peak = 0
    const { llm, calls } = fakeLLM(
      (req) => {
        const u = lastUser(req)
        return u.startsWith('#2 ') ? { error: 'отказ' } : `проверено: ${u}`
      },
      { delay: 20 },
    )
    const tracked: typeof llm = async (req, opts) => {
      active++
      peak = Math.max(peak, active)
      try {
        return await llm(req, opts)
      } finally {
        active--
      }
    }
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'Вход', config: {} },
        { id: 'f', kind: 'foreach', label: 'Охотник', config: { model: 'm', splitBy: 'lines', concurrency: 2, retries: 0, prompt: '#{{index}} {{item}} ({{input}})' } },
      ],
      [['in', 'f']],
    )
    const run = await runPipeline(p, '- C1 sql\n- C2 xss\n- C3 path', { llm: tracked, tool: async () => ({ ok: true, output: '' }), getAgent })
    expect(calls).toHaveLength(3)
    expect(peak).toBe(2)
    expect(run.nodes.f.error).toBeUndefined()
    expect(run.nodes.f.status).toBe('done')
    expect(run.nodes.f.items).toEqual({ done: 3, total: 3, failed: 1 })
    expect(run.nodes.f.output).toContain('### 1. C1 sql\nпроверено: #1 C1 sql')
    expect(run.nodes.f.output).toContain('### 2. C2 xss\n[ошибка: отказ]')
  })

  it('деление: строки, разделы Markdown, массив JSON', () => {
    expect(splitItems('1. a\n2) b\n\n* c', 'lines')).toEqual(['a', 'b', 'c'])
    expect(splitItems('# Кандидаты\n## A\nтекст a\n## B\nтекст b', 'blocks')).toEqual(['## A\nтекст a', '## B\nтекст b'])
    expect(splitItems('первый\n\nвторой', 'blocks')).toEqual(['первый', 'второй'])
    expect(splitItems('Вот: {"candidates":[{"id":1},"x"]}', 'json')).toEqual(['{\n  "id": 1\n}', 'x'])
    expect(() => splitItems('нет массива', 'json')).toThrow()
    expect(itemTitle('{"id":"C2","area":"injection","summary":"SQLi в /notes"}')).toBe('C2 SQLi в /notes')
    expect(itemTitle('- C1 sql')).toBe('C1 sql')
  })
})

describe('своя копия проекта и проверка командой', () => {
  it('агент правит свою копию; проверка тестами в ней же отправляет на доработку до зелёного', async () => {
    const created: string[] = []
    const sandbox = { create: async (label: string) => (created.push(label), `sb_${created.length}`) }
    const { llm, calls } = fakeLLM((req, n) => `версия ${n}`)
    const { tool, calls: shell } = fakeShell((_cmd, n) => (n < 2 ? { ok: false, output: 'FAIL test/x.test.ts: expected 1' } : { ok: true, output: 'ok' }))
    const p = graph(
      [
        { id: 'in', kind: 'input', label: 'Вход', config: {} },
        { id: 'fix', kind: 'agent', label: 'Доработчик', config: { model: 'm', isolate: true, tools: ['files_write', 'terminal'] } },
        { id: 'chk', kind: 'validator', label: 'Тесты', config: { checkCommand: 'npm test', maxAttempts: 3 } },
        { id: 'scan', kind: 'command', label: 'Повторный скан', config: { command: 'scan' } },
      ],
      [['in', 'fix'], ['fix', 'chk'], ['chk', 'scan']],
    )
    const run = await runPipeline(p, 'задача', { llm, tool, getAgent, sandbox })
    expect(created).toEqual(['p: Доработчик']) // одна копия на запуск, доработка — в ней же
    expect(calls.every((c) => c.sandbox === 'sb_1')).toBe(true)
    expect(shell.slice(0, 2).map((c) => c.sandbox)).toEqual(['sb_1', 'sb_1'])
    expect(lastUser(calls[1])).toContain('FAIL test/x.test.ts')
    expect(run.nodes.chk).toMatchObject({ status: 'done', attempts: 2 })
    expect(run.nodes.fix.sandbox).toBe('sb_1')
    expect(shell[2]).toMatchObject({ cmd: 'scan', sandbox: undefined }) // после проверки — снова в проекте, если копию не указали
  })

  it('без поддержки копий блок со своей копией честно падает', async () => {
    const { llm } = fakeLLM(() => 'x')
    const p = graph([{ id: 'a', kind: 'agent', label: 'A', config: { model: 'm', isolate: true } }], [])
    const run = await runPipeline(p, 'x', { llm, tool: async () => ({ ok: true, output: '' }), getAgent })
    expect(run.nodes.a.error).toContain('Своя копия проекта недоступна')
  })
})
