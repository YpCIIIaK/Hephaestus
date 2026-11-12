import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePipeline } from '@/lib/engine/pipeline'
import { parseSections, rawGithubUrl, routineToPipeline } from '@/lib/engine/routine-import'

const ROUTINE = fs.readFileSync(path.join(__dirname, 'fixtures/routine.md'), 'utf8')

describe('импорт порядка действий', () => {
  it('заголовки внутри блоков кода не считаются разделами', () => {
    const { title, sections } = parseSections('# Тест\n\n## Шаг\n```\n# не заголовок\n```\n')
    expect(title).toBe('Тест')
    expect(sections).toHaveLength(1)
    expect(sections[0].body).toContain('# не заголовок')
  })

  it('runbook → цепочка шагов, правила в системном промпте, отчёт по шаблону и проверка', () => {
    const p = routineToPipeline(ROUTINE, { id: 'pl_x', reportPath: 'reports/cycle.md' })
    expect(p.name).toBe('Benchmark routine — runbook for an autonomous agent')
    const agents = p.nodes.filter((n) => n.kind === 'agent')
    const labels = agents.map((n) => n.label)
    expect(labels).toEqual(['0.5 Tracks', '1.1 Add repos', '1.2 Scan', '1.3 Label', 'Отчёт'])
    expect(agents[0].config.systemPrompt).toContain('Never force-push')
    expect(agents[1].config.prompt).toContain('Шаг 2 из 4: 1.1 Add repos (target 100–200)')
    expect(agents[1].config.prompt).toContain('{{prev}}')
    expect(agents[1].config.tools).toContain('terminal')
    expect(agents.at(-1)!.config.prompt).toContain('## Cycle <date>-<n>')
    expect(agents.at(-1)!.config.prompt).toContain('{{1.3 Label}}')
    expect(p.nodes.find((n) => n.kind === 'validator')!.config.criteria).toContain('Spot-check')
    expect(p.nodes.find((n) => n.kind === 'write')!.config.path).toBe('reports/cycle.md')
    expect(p.nodes.find((n) => n.kind === 'output')!.config.template).toBe('{{Отчёт}}')
    expect(validatePipeline(p).filter((i) => i.level === 'error')).toEqual([])
    // Цепочка: каждый узел, кроме последнего, ведёт ровно в один следующий
    expect(p.edges).toHaveLength(p.nodes.length - 1)
  })

  it('без разделов шаги берутся из нумерованного списка; длинный список сворачивается', () => {
    const md = Array.from({ length: 20 }, (_, i) => `${i + 1}. Сделать пункт ${i + 1}`).join('\n')
    const p = routineToPipeline(md, { id: 'pl_y', maxSteps: 6 })
    const steps = p.nodes.filter((n) => n.kind === 'agent' && n.label !== 'Отчёт')
    expect(steps.length).toBeLessThanOrEqual(6)
    expect(steps[0].config.prompt).toContain('Сделать пункт 1')
    expect(() => routineToPipeline('просто текст', { id: 'z' })).toThrow()
  })

  it('ссылка на файл GitHub превращается в ссылку на его содержимое', () => {
    expect(rawGithubUrl('https://github.com/YpCIIIaK/repo-janitor/blob/main/benchmark/ROUTINE.md')).toBe('https://raw.githubusercontent.com/YpCIIIaK/repo-janitor/main/benchmark/ROUTINE.md')
  })
})
