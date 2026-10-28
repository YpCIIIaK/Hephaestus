'use client'

import { DOMAINS, HORIZONS, runScenario, SCENARIO_KINDS, type ScenarioConfig, type ScenarioReport } from '../engine/scenario'
import { useScenarios } from '../stores/scenarios'
import { uid } from '../utils'
import { callLLM } from './llm'

const controllers = new Map<string, AbortController>()

export function stopScenario(id: string) {
  controllers.get(id)?.abort()
}

export function startScenario(config: ScenarioConfig): string {
  const id = uid('sc')
  const ac = new AbortController()
  controllers.set(id, ac)
  const store = useScenarios.getState()
  store.add({ id, config, status: 'running', stages: {}, createdAt: Date.now() })
  void (async () => {
    try {
      const r = await runScenario(config, callLLM, { onStage: (stage, s) => useScenarios.getState().setStage(id, stage, s) }, ac.signal)
      useScenarios.getState().patch(id, { status: r.report ? 'done' : 'error', report: r.report, raw: r.raw, facts: r.facts, analyses: r.analyses, usage: r.usage, finishedAt: Date.now(), error: r.report ? undefined : 'Не удалось разобрать итоговый отчёт' })
    } catch (e) {
      const aborted = ac.signal.aborted
      useScenarios.getState().patch(id, { status: aborted ? 'stopped' : 'error', error: aborted ? 'Остановлено' : e instanceof Error ? e.message : String(e), finishedAt: Date.now() })
    } finally {
      controllers.delete(id)
    }
  })()
  return id
}

export function reportToMarkdown(cfg: ScenarioConfig, r: ScenarioReport, facts?: string): string {
  const L: string[] = [`# ${cfg.event}`, '', `Горизонт: ${HORIZONS[cfg.horizon]} · Области: ${cfg.domains.map((d) => DOMAINS[d].title).join(', ')}`, '', `## ${r.headline}`, '', r.summary, '']
  for (const s of r.scenarios) {
    L.push(`### ${SCENARIO_KINDS[s.kind].title}: ${s.title} — ${s.probability}%`, '', s.narrative, '')
    if (s.triggers.length) L.push('**Условия:**', ...s.triggers.map((t) => `- ${t}`), '')
    if (s.timeline.length) L.push('**Хронология:**', ...s.timeline.map((t) => `- ${t.when}: ${t.what}`), '')
    if (s.impacts.length) L.push('**Последствия:**', ...s.impacts.map((i) => `- ${DOMAINS[i.domain].title} (${i.severity}/5): ${i.text}`), '')
  }
  if (r.crossEffects.length) L.push('## Взаимное влияние', ...r.crossEffects.map((c) => `- ${DOMAINS[c.from].title} → ${DOMAINS[c.to].title}: ${c.effect}`), '')
  if (r.indicators.length) L.push('## Что отслеживать', ...r.indicators.map((i) => `- **${i.signal}** — ${i.meaning}`), '')
  if (r.recommendations.length) L.push('## Рекомендации', ...r.recommendations.map((x) => `- ${x}`), '')
  if (facts) L.push('## Собранные факты', '', facts)
  return L.join('\n')
}
