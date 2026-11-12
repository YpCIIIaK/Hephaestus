'use client'

import type { DecideCall } from '../engine/llm'
import { useSettings } from '../stores/settings'
import { useUsage } from '../stores/usage'
import type { DecideResult } from '../types'
import { uid } from '../utils'
import { api, budgetProblem } from './llm'

// Модель решений из браузера: лимиты расходов и учёт в аналитике — как у обычных моделей

/** Вызов модели решений, если она включена в настройках; иначе undefined — движки решают через LLM */
export function getDecider(): DecideCall | undefined {
  const { enabled, model } = useSettings.getState().decider
  if (!enabled || !model.trim()) return undefined
  return async (req, opts = {}) => {
    const empty: DecideResult = { answers: {}, usage: { promptTokens: 0, completionTokens: 0, cost: 0 }, model, latencyMs: 0 }
    const budget = budgetProblem()
    if (budget) return { ...empty, error: budget }
    const started = performance.now()
    let result: DecideResult
    try {
      result = await api<DecideResult>('/api/decide', { method: 'POST', json: { ...req, model }, signal: opts.signal })
    } catch (e) {
      result = { ...empty, latencyMs: performance.now() - started, error: e instanceof Error ? e.message : String(e) }
    }
    if (!opts.signal?.aborted) {
      useUsage.getState().add({
        id: uid('u'),
        ts: Date.now(),
        model,
        source: opts.meta?.source ?? 'system',
        label: opts.meta?.label ? `${opts.meta.label} · решение` : 'Модель решений',
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        cost: result.usage.cost,
        latencyMs: result.latencyMs,
        ok: !result.error,
        error: result.error,
      })
    }
    return result
  }
}

/** Модели по умолчанию для маршрутизатора и проверки Кузницы — из «Служебных моделей» */
export function pipelineDefaults(): { router: string; validator: string } {
  const { services } = useSettings.getState()
  return { router: services.router || '@fast', validator: services.validator || '@smart' }
}
