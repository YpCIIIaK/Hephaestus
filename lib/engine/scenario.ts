import { asArray, asNumber, asString, extractJson } from '../json'
import { addUsage, ZERO_USAGE } from '../models'
import type { Usage } from '../types'
import { throwIfAborted, type LLMCall } from './llm'

// Сценарный анализ события: сбор фактов → отраслевые аналитики параллельно →
// синтез сценариев с вероятностями, последствиями и сигналами для наблюдения.

export type DomainId = 'politics' | 'economy' | 'security' | 'tech' | 'society' | 'energy' | 'business' | 'environment'
export type ScenarioKind = 'baseline' | 'optimistic' | 'pessimistic' | 'wildcard'
export type Horizon = '1w' | '1m' | '3m' | '1y' | '5y'

export const DOMAINS: Record<DomainId, { title: string; emoji: string; focus: string }> = {
  politics: { title: 'Политика', emoji: '🏛️', focus: 'стабильность власти, дипломатия, альянсы, реакция общества и выборы' },
  economy: { title: 'Экономика', emoji: '📈', focus: 'рынки, валюта, торговля, инфляция, рост, инвестиции, цепочки поставок' },
  security: { title: 'Безопасность', emoji: '🛡️', focus: 'военная обстановка, риски эскалации, кибербезопасность, разведка' },
  tech: { title: 'Технологии', emoji: '💻', focus: 'технологические ограничения, инфраструктура, ИИ, данные, индустрия' },
  society: { title: 'Общество', emoji: '👥', focus: 'общественные настроения, протесты, миграция, медиа и информационная среда' },
  energy: { title: 'Энергетика', emoji: '⚡', focus: 'нефть и газ, электроэнергия, цены, ресурсы и инфраструктура' },
  business: { title: 'Бизнес', emoji: '🏢', focus: 'компании и отрасли, спрос, конкуренция, регулирование, стратегии' },
  environment: { title: 'Экология', emoji: '🌍', focus: 'климат, природные риски, экологическое регулирование' },
}

export const SCENARIO_KINDS: Record<ScenarioKind, { title: string; hint: string }> = {
  baseline: { title: 'Базовый', hint: 'Наиболее вероятное развитие при текущих трендах' },
  optimistic: { title: 'Оптимистичный', hint: 'Лучший реалистичный исход' },
  pessimistic: { title: 'Пессимистичный', hint: 'Худший реалистичный исход, эскалация' },
  wildcard: { title: 'Чёрный лебедь', hint: 'Маловероятный, но сильный поворот' },
}

export const HORIZONS: Record<Horizon, string> = { '1w': 'неделя', '1m': 'месяц', '3m': '3 месяца', '1y': 'год', '5y': '5 лет' }

export interface ScenarioConfig {
  event: string
  context: string
  domains: DomainId[]
  scenarios: ScenarioKind[]
  horizon: Horizon
  analystModel: string
  synthModel: string
  research: boolean
}

export interface DomainAnalysis {
  domain: DomainId
  drivers: string[]
  scenarios: Partial<Record<ScenarioKind, { narrative: string; impacts: { text: string; severity: number }[] }>>
}

export interface ScenarioOutcome {
  kind: ScenarioKind
  title: string
  probability: number
  narrative: string
  triggers: string[]
  timeline: { when: string; what: string }[]
  impacts: { domain: DomainId; severity: number; text: string }[]
}

export interface ScenarioReport {
  headline: string
  summary: string
  scenarios: ScenarioOutcome[]
  crossEffects: { from: DomainId; to: DomainId; effect: string }[]
  indicators: { signal: string; meaning: string }[]
  recommendations: string[]
}

export type StageId = 'research' | `domain:${DomainId}` | 'synthesis'

export interface StageState {
  status: 'pending' | 'running' | 'done' | 'error'
  text?: string
  error?: string
  usage?: Usage
}

export interface ScenarioHooks {
  onStage: (id: StageId, patch: StageState) => void
}

const severity = (v: unknown) => Math.max(1, Math.min(5, Math.round(asNumber(v, 3))))

function parseDomain(domain: DomainId, text: string, kinds: ScenarioKind[]): DomainAnalysis | null {
  const j = extractJson<Record<string, unknown>>(text)
  if (!j) return null
  const raw = (j.scenarios ?? {}) as Record<string, Record<string, unknown>>
  const scenarios: DomainAnalysis['scenarios'] = {}
  for (const k of kinds) {
    const s = raw[k]
    if (!s) continue
    scenarios[k] = {
      narrative: asString(s.narrative),
      impacts: asArray<Record<string, unknown>>(s.impacts).map((i) => ({ text: asString(i.text ?? i.impact), severity: severity(i.severity) })),
    }
  }
  // Слабые модели возвращают пустой каркас или повторяют пример из промпта
  if (!Object.keys(scenarios).length) return null
  return { domain, drivers: asArray(j.drivers).map((d) => asString(d)).filter(Boolean), scenarios }
}

/** Синтез может забыть последствия для части сценариев — берём их из отраслевых анализов */
export function fillMissingImpacts(report: ScenarioReport, analyses: DomainAnalysis[]): ScenarioReport {
  for (const s of report.scenarios) {
    for (const a of analyses) {
      if (s.impacts.some((i) => i.domain === a.domain)) continue
      for (const i of a.scenarios[s.kind]?.impacts ?? []) s.impacts.push({ domain: a.domain, severity: i.severity, text: i.text })
    }
  }
  return report
}

export function parseReport(text: string, cfg: Pick<ScenarioConfig, 'scenarios' | 'domains'>): ScenarioReport | null {
  const j = extractJson<Record<string, unknown>>(text)
  if (!j) return null
  const domainIds = new Set<string>(cfg.domains)
  const toDomain = (v: unknown): DomainId | null => {
    const s = asString(v).toLowerCase()
    if (domainIds.has(s)) return s as DomainId
    const byTitle = (Object.entries(DOMAINS) as [DomainId, (typeof DOMAINS)[DomainId]][]).find(([, d]) => d.title.toLowerCase() === s)
    return byTitle?.[0] ?? null
  }
  const scenarios = asArray<Record<string, unknown>>(j.scenarios)
    .map((s, i): ScenarioOutcome => {
      const kind = (cfg.scenarios.includes(asString(s.kind) as ScenarioKind) ? asString(s.kind) : cfg.scenarios[i] ?? 'baseline') as ScenarioKind
      return {
        kind,
        title: asString(s.title, SCENARIO_KINDS[kind].title),
        probability: Math.max(0, Math.min(100, asNumber(s.probability))),
        narrative: asString(s.narrative),
        triggers: asArray(s.triggers).map((t) => asString(t)).filter(Boolean),
        timeline: asArray<Record<string, unknown>>(s.timeline).map((t) => ({ when: asString(t.when), what: asString(t.what) })),
        impacts: asArray<Record<string, unknown>>(s.impacts).flatMap((im) => {
          const d = toDomain(im.domain)
          return d ? [{ domain: d, severity: severity(im.severity), text: asString(im.text) }] : []
        }),
      }
    })
  // Вероятности приводим к сумме 100%, если модель ошиблась в арифметике
  const sum = scenarios.reduce((s, x) => s + x.probability, 0)
  if (sum > 0 && Math.abs(sum - 100) > 2) for (const s of scenarios) s.probability = Math.round((s.probability / sum) * 100)
  return {
    headline: asString(j.headline),
    summary: asString(j.summary),
    scenarios,
    crossEffects: asArray<Record<string, unknown>>(j.crossEffects).flatMap((c) => {
      const from = toDomain(c.from)
      const to = toDomain(c.to)
      return from && to ? [{ from, to, effect: asString(c.effect) }] : []
    }),
    indicators: asArray<Record<string, unknown>>(j.indicators).map((i) => ({ signal: asString(i.signal), meaning: asString(i.meaning) })),
    recommendations: asArray(j.recommendations).map((r) => asString(r)).filter(Boolean),
  }
}

export async function runScenario(
  cfg: ScenarioConfig,
  llm: LLMCall,
  hooks: ScenarioHooks,
  signal?: AbortSignal,
): Promise<{ report: ScenarioReport | null; raw: string; usage: Usage; facts: string; analyses: DomainAnalysis[] }> {
  let usage: Usage = { ...ZERO_USAGE }
  const horizon = HORIZONS[cfg.horizon]
  // Явные ключи вместо «<вид>»: иначе слабые модели повторяют каркас из промпта
  const kindsShape = cfg.scenarios.map((k) => `"${k}": {"narrative": "…", "impacts": [{"text": "…", "severity": 1-5}]}`).join(', ')
  const kindsList = cfg.scenarios.map((k) => `${k} (${SCENARIO_KINDS[k].title}: ${SCENARIO_KINDS[k].hint})`).join('; ')
  const eventBlock = `Событие: ${cfg.event}${cfg.context.trim() ? `\nДополнительный контекст: ${cfg.context}` : ''}\nГоризонт прогноза: ${horizon}`

  // 1. Сбор фактов
  let facts = ''
  if (cfg.research) {
    hooks.onStage('research', { status: 'running' })
    const res = await llm(
      {
        model: cfg.analystModel,
        tools: ['web'],
        maxToolSteps: 6,
        temperature: 0.2,
        maxTokens: 1800,
        messages: [
          { role: 'system', content: 'Ты — исследователь-аналитик. Найди в интернете актуальные факты по событию: что произошло, ключевые участники, цифры, реакция сторон, исторические аналогии. Дай сжатую сводку фактов списком со ссылками. Без прогнозов.' },
          { role: 'user', content: eventBlock },
        ],
      },
      { signal, meta: { source: 'scenario', label: 'Сбор фактов' }, onEvent: (e) => e.t === 'text' && hooks.onStage('research', { status: 'running' }) },
    )
    usage = addUsage(usage, res.usage)
    if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
    facts = res.error ? '' : res.text
    hooks.onStage('research', res.error ? { status: 'error', error: res.error } : { status: 'done', text: facts, usage: res.usage })
  }

  // 2. Отраслевые аналитики — параллельно
  throwIfAborted(signal)
  const analyses = await Promise.all(
    cfg.domains.map(async (domain) => {
      const id: StageId = `domain:${domain}`
      hooks.onStage(id, { status: 'running' })
      const d = DOMAINS[domain]
      const res = await llm(
        {
          model: cfg.analystModel,
          temperature: 0.4,
          maxTokens: 2200,
          jsonMode: true,
          messages: [
            {
              role: 'system',
              content: `Ты — эксперт по направлению «${d.title}» (${d.focus}). Анализируй трезво, опирайся на прецеденты, отделяй вероятное от возможного. Пиши по-русски.
Верни только JSON такой формы:
{"drivers": ["…"], "scenarios": {${kindsShape}}}
drivers — 2–5 ключевых факторов. Для каждого сценария narrative — 2–4 предложения, как развивается ситуация в твоей области, impacts — 1–3 конкретных последствия с силой от 1 до 5. Вместо «…» — твой анализ, не повторяй форму.
Виды сценариев (ключи scenarios): ${kindsList}.`,
            },
            { role: 'user', content: `${eventBlock}${facts ? `\n\nФакты:\n${facts}` : ''}` },
          ],
        },
        { signal, meta: { source: 'scenario', label: d.title } },
      )
      usage = addUsage(usage, res.usage)
      if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
      if (res.error) {
        hooks.onStage(id, { status: 'error', error: res.error })
        return null
      }
      const parsed = parseDomain(domain, res.text, cfg.scenarios)
      hooks.onStage(id, parsed ? { status: 'done', text: res.text, usage: res.usage } : { status: 'error', error: 'Модель вернула некорректный JSON', text: res.text })
      return parsed
    }),
  )
  const ok = analyses.filter((a): a is DomainAnalysis => !!a)
  if (!ok.length) throw new Error('Ни один аналитик не дал результата')

  // 3. Синтез
  throwIfAborted(signal)
  hooks.onStage('synthesis', { status: 'running' })
  const domainList = cfg.domains.map((dd) => `${dd} (${DOMAINS[dd].title})`).join(', ')
  const res = await llm(
    {
      model: cfg.synthModel,
      temperature: 0.3,
      maxTokens: 5000,
      jsonMode: true,
      messages: [
        {
          role: 'system',
          content: `Ты — руководитель аналитического центра. Сведи отраслевые анализы в целостную картину: найди взаимное влияние областей, оцени вероятности сценариев (в сумме 100%), выдели ранние сигналы. Пиши по-русски, конкретно.
Верни только JSON:
{
 "headline": "одна фраза — главный вывод",
 "summary": "3–5 предложений общей оценки",
 "scenarios": [{"kind": "<вид>", "title": "короткое название", "probability": <0-100>, "narrative": "как разворачивается", "triggers": ["что должно произойти, чтобы сценарий реализовался"], "timeline": [{"when": "срок", "what": "событие"}], "impacts": [{"domain": "<область>", "severity": 1-5, "text": "последствие"}] — хотя бы по одному для каждой области}],
 "crossEffects": [{"from": "<область>", "to": "<область>", "effect": "как одно влияет на другое"}],
 "indicators": [{"signal": "что отслеживать", "meaning": "о каком сценарии говорит"}],
 "recommendations": ["практическая рекомендация"]
}
Виды сценариев: ${kindsList}. Области: ${domainList}.`,
        },
        {
          role: 'user',
          content: `${eventBlock}${facts ? `\n\nФакты:\n${facts}` : ''}\n\nОтраслевые анализы:\n${JSON.stringify(ok, null, 1)}`,
        },
      ],
    },
    { signal, meta: { source: 'scenario', label: 'Синтез сценариев' } },
  )
  usage = addUsage(usage, res.usage)
  if (res.aborted) throw Object.assign(new Error('Остановлено'), { name: 'AbortError' })
  if (res.error) {
    hooks.onStage('synthesis', { status: 'error', error: res.error })
    throw new Error(res.error)
  }
  const parsed = parseReport(res.text, cfg)
  const report = parsed && fillMissingImpacts(parsed, ok)
  hooks.onStage('synthesis', report ? { status: 'done', usage: res.usage } : { status: 'error', error: 'Не удалось разобрать итоговый JSON', text: res.text })
  return { report, raw: res.text, usage, facts, analyses: ok }
}
