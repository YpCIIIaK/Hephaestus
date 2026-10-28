import type { LLMEvent, LLMRequest } from '../types'
import { estimateTokens } from '../tokens'

// Заглушка модели для тестов и разработки без ключа: HEPHAESTUS_MOCK_LLM=1.
// Отвечает правдоподобно и в тех JSON-форматах, которые ждут движки.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function answerFor(req: LLMRequest): string {
  const system = req.messages.find((m) => m.role === 'system')?.content ?? ''
  const user = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const model = req.model.split('/').pop()
  if (system.includes('"route"')) return '{"route": 1, "reason": "запрос лучше всего подходит под первую ветку"}'
  if (system.includes('"pass"')) return '{"pass": true, "score": 8, "feedback": ""}'
  if (system.includes('"winnerId"')) {
    const ids = Array.from(user.matchAll(/id "([^"]+)"/g), (m) => m[1])
    return JSON.stringify({
      summary: 'Участники последовательно изложили позиции и ответили на возражения друг друга.',
      consensus: 'Все согласны, что решение зависит от контекста и цены ошибки.',
      disagreements: ['Насколько быстро нужно действовать', 'Какие риски считать приемлемыми'],
      scores: ids.map((id, i) => ({ participantId: id, score: 8 - i, comment: i ? 'Хорошие контраргументы, но меньше фактов' : 'Самая обоснованная позиция' })),
      winnerId: ids[0],
      recommendation: 'Начать с пилота, измерить результат и масштабировать при успехе.',
    })
  }
  if (system.includes('"drivers"')) {
    const kinds = Array.from(system.matchAll(/\b(baseline|optimistic|pessimistic|wildcard) \(/g), (m) => m[1])
    return JSON.stringify({
      drivers: ['Реакция ключевых игроков', 'Состояние рынков'],
      scenarios: Object.fromEntries(kinds.map((k, i) => [k, { narrative: `Сценарий ${k}: ситуация развивается умеренно.`, impacts: [{ text: 'Рост неопределённости', severity: 2 + i }] }])),
    })
  }
  if (system.includes('"headline"')) {
    const kinds = Array.from(system.matchAll(/\b(baseline|optimistic|pessimistic|wildcard) \(/g), (m) => m[1])
    const domains = Array.from((system.match(/Области: ([^\n]+)/)?.[1] ?? '').matchAll(/(\w+) \(/g), (m) => m[1])
    const probs = [55, 25, 15, 5]
    return JSON.stringify({
      headline: 'Событие усилит неопределённость, но базовый сценарий остаётся управляемым',
      summary: 'Краткосрочно ожидается волатильность. Среднесрочно ситуация стабилизируется, если ключевые игроки не пойдут на эскалацию.',
      scenarios: kinds.map((k, i) => ({
        kind: k,
        title: ['Постепенная стабилизация', 'Быстрое урегулирование', 'Затяжной кризис', 'Резкий разворот'][i] ?? k,
        probability: probs[i] ?? 5,
        narrative: 'Ситуация развивается через несколько последовательных шагов, реакция рынков сдержанная.',
        triggers: ['Заявления ключевых участников', 'Данные статистики'],
        timeline: [{ when: '1–2 недели', what: 'Первая реакция' }, { when: '1–3 месяца', what: 'Адаптация участников' }],
        impacts: domains.map((d, j) => ({ domain: d, severity: Math.min(5, 1 + i + j), text: 'Умеренное влияние на отрасль' })),
      })),
      crossEffects: domains.length > 1 ? [{ from: domains[0], to: domains[1], effect: 'Решения в первой области быстро отражаются во второй' }] : [],
      indicators: [{ signal: 'Динамика ключевых индексов', meaning: 'Рост указывает на базовый сценарий' }],
      recommendations: ['Подготовить план действий на случай пессимистичного сценария', 'Отслеживать сигналы раз в неделю'],
    })
  }
  if (system.includes('"ranking"')) {
    const n = (user.match(/^## Ответ \d+/gm) ?? []).length || 1
    const ranking = Array.from({ length: n }, (_, i) => ({ answer: i + 1, score: 9 - i, strengths: 'Чёткая структура', weaknesses: i ? 'Меньше конкретики' : 'Можно короче' }))
    return '```json\n' + JSON.stringify({ ranking, best: 1 }) + '\n```\n\n## Итоговый ответ\n\nОбъединённый ответ: берём структуру первого варианта и примеры из остальных.\n\n1. Главный вывод.\n2. Практический шаг.\n3. На что обратить внимание.'
  }
  if (system.startsWith('Придумай короткое название')) return 'Тестовый диалог'
  const topic = user.replace(/\s+/g, ' ').slice(0, 80)
  return `**${model}** разбирает запрос: «${topic}».\n\n### Главное\n- Первый ключевой тезис с пояснением.\n- Второй тезис: альтернативный взгляд.\n- Третий: что сделать дальше.\n\n\`\`\`ts\nconst answer = 42\n\`\`\`\n\nИтог: ответ демонстрационный — включён режим заглушки модели.`
}

export async function* mockStream(req: LLMRequest, signal?: AbortSignal): AsyncGenerator<LLMEvent> {
  const delay = Number(process.env.HEPHAESTUS_MOCK_DELAY ?? 12)
  if (req.model.includes('fail')) {
    yield { t: 'error', message: 'Ошибка 500: заглушка модели имитирует сбой', status: 500 }
    return
  }
  const hasToolResults = req.messages.some((m) => m.role === 'tool')
  if (req.tools?.includes('web') && !hasToolResults) {
    yield { t: 'tool_call', id: 'mock_1', name: 'web_search', args: '{"query":"демо"}' }
    await sleep(delay * 5)
    yield { t: 'tool_result', id: 'mock_1', name: 'web_search', ok: true, preview: '[1] Демо-результат\nhttps://example.com\nСниппет' }
  }
  const text = answerFor(req)
  const parts = text.match(/[\s\S]{1,14}/g) ?? []
  for (const p of parts) {
    if (signal?.aborted) return
    await sleep(delay)
    yield { t: 'text', v: p }
  }
  const prompt = req.messages.reduce((s, m) => s + estimateTokens(m.content), 0)
  const completion = estimateTokens(text)
  yield { t: 'usage', model: req.model, usage: { promptTokens: prompt, completionTokens: completion, cost: (prompt + completion * 4) * 1e-6 } }
  yield { t: 'done', finish: 'stop' }
}
