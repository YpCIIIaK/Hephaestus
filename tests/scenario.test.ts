import { describe, expect, it } from 'vitest'
import { parseReport, runScenario, type ScenarioConfig } from '@/lib/engine/scenario'
import { fakeLLM, system } from './helpers'

const cfg: ScenarioConfig = {
  event: 'ЦБ поднял ставку',
  context: '',
  domains: ['economy', 'business'],
  scenarios: ['baseline', 'pessimistic'],
  horizon: '3m',
  analystModel: 'a',
  synthModel: 's',
  research: true,
}

describe('сценарный анализ', () => {
  it('проходит все этапы и собирает отчёт', async () => {
    const stages: string[] = []
    const { llm, calls } = fakeLLM((req) => {
      if (req.tools?.includes('web')) return 'факты: инфляция 8%'
      if (system(req).includes('"headline"'))
        return JSON.stringify({
          headline: 'h',
          summary: 's',
          scenarios: [
            { kind: 'baseline', title: 'База', probability: 60, impacts: [{ domain: 'economy', severity: 9, text: 'x' }, { domain: 'марс', severity: 1, text: 'y' }] },
            { kind: 'pessimistic', probability: '60%', timeline: [{ when: '1 мес', what: 'спад' }] },
          ],
          crossEffects: [{ from: 'Экономика', to: 'business', effect: 'e' }],
          indicators: [{ signal: 'курс', meaning: 'база' }],
          recommendations: ['r'],
        })
      return JSON.stringify({ drivers: ['ставка'], scenarios: { baseline: { narrative: 'n', impacts: [{ text: 't', severity: 2 }] } } })
    })
    const r = await runScenario(cfg, llm, { onStage: (id, s) => stages.push(`${id}:${s.status}`) })
    expect(calls).toHaveLength(4)
    expect(stages).toContain('research:done')
    expect(stages).toContain('domain:economy:done')
    expect(stages).toContain('synthesis:done')
    expect(r.analyses[0].drivers).toEqual(['ставка'])
    const rep = r.report!
    expect(rep.scenarios.map((s) => s.probability)).toEqual([50, 50]) // нормировано к 100
    expect(rep.scenarios[0].impacts).toEqual([{ domain: 'economy', severity: 5, text: 'x' }])
    expect(rep.crossEffects[0].from).toBe('economy')
  })

  it('parseReport возвращает null для не-JSON', () => {
    expect(parseReport('увы', cfg)).toBeNull()
  })
})
