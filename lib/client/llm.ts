'use client'

import type { LLMCall, LLMCallOptions } from '../engine/llm'
import { ALIAS_LABELS, isAlias } from '../models'
import { NDJSONParser } from '../sse'
import { resolveModelId } from '../stores/catalog'
import { useSettings } from '../stores/settings'
import { spentSince, startOfDay, startOfMonth, useUsage } from '../stores/usage'
import type { LLMEvent, LLMRequest, LLMResult, ModelAlias, ToolTrace, Usage } from '../types'
import { uid } from '../utils'

// Вызов модели из браузера: псевдонимы → реальные ID, проверка лимитов,
// поток /api/llm, запись расходов в аналитику.

export function budgetProblem(): string | null {
  const { limits } = useSettings.getState()
  const events = useUsage.getState().events
  if (limits.dailyUsd > 0 && spentSince(events, startOfDay()) >= limits.dailyUsd) {
    return `Достигнут дневной лимит расходов ($${limits.dailyUsd}). Его можно поднять в настройках.`
  }
  if (limits.monthlyUsd > 0 && spentSince(events, startOfMonth()) >= limits.monthlyUsd) {
    return `Достигнут месячный лимит расходов ($${limits.monthlyUsd}). Его можно поднять в настройках.`
  }
  return null
}

const emptyUsage = (): Usage => ({ promptTokens: 0, completionTokens: 0, cost: 0 })

export const callLLM: LLMCall = async (req: LLMRequest, opts: LLMCallOptions = {}): Promise<LLMResult> => {
  const started = performance.now()
  const model = resolveModelId(req.model)
  const base = { text: '', reasoning: '', tools: [] as ToolTrace[], usage: emptyUsage(), model: model ?? req.model, latencyMs: 0 }
  if (!model) {
    const label = isAlias(req.model) ? ALIAS_LABELS[req.model as ModelAlias].title : req.model
    return { ...base, error: `Не выбрана модель для роли «${label}». Откройте настройки → Модели.` }
  }
  const budget = budgetProblem()
  if (budget) return { ...base, error: budget }

  let text = ''
  let reasoning = ''
  const tools: ToolTrace[] = []
  let usage: Usage | null = null
  let error: string | undefined

  const handle = (e: LLMEvent) => {
    switch (e.t) {
      case 'text':
        text += e.v
        break
      case 'reasoning':
        reasoning += e.v
        break
      case 'tool_call':
        tools.push({ id: e.id, name: e.name, args: e.args })
        break
      case 'tool_result': {
        const t = tools.find((x) => x.id === e.id)
        if (t) Object.assign(t, { ok: e.ok, preview: e.preview })
        break
      }
      case 'usage':
        usage = e.usage
        break
      case 'error':
        error = e.message
        break
    }
    opts.onEvent?.(e)
  }

  let aborted = false
  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, model }),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      error = data.error ?? `Ошибка сервера ${res.status}`
    } else {
      const parser = new NDJSONParser<LLMEvent>(handle)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.flush()
    }
  } catch (e) {
    if (opts.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) aborted = true
    else error = e instanceof Error ? `Сеть: ${e.message}` : String(e)
  }

  const latencyMs = performance.now() - started
  const finalUsage: Usage = usage ?? emptyUsage()
  if (usage || error) {
    useUsage.getState().add({
      id: uid('u'),
      ts: Date.now(),
      model,
      source: opts.meta?.source ?? 'system',
      label: opts.meta?.label,
      promptTokens: finalUsage.promptTokens,
      completionTokens: finalUsage.completionTokens,
      cost: finalUsage.cost,
      latencyMs,
      ok: !error,
      error,
    })
  }
  return { text, reasoning, tools, usage: finalUsage, model, latencyMs, error: aborted ? undefined : error, aborted }
}

export async function callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
  try {
    const res = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }), signal })
    const data = (await res.json()) as { ok?: boolean; output?: string; error?: string }
    if (!res.ok) return { ok: false, output: data.error ?? `Ошибка ${res.status}` }
    return { ok: !!data.ok, output: data.output ?? '' }
  } catch (e) {
    if (signal?.aborted) throw e
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
  return data
}
