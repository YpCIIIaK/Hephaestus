'use client'

import type { LLMCall, LLMCallOptions } from '../engine/llm'
import { detectRefusal } from '../engine/refusal'
import { ALIAS_LABELS, isAlias, isFreeModel, isSubscriptionModel, newestFreeModels, openrouterTwin, providerOf, subscriptionTwin } from '../models'
import { NDJSONParser } from '../sse'
import { modelById, resolveModelId, usableModels, useCatalog } from '../stores/catalog'
import { useSettings } from '../stores/settings'
import { spentSince, startOfDay, startOfMonth, useUsage } from '../stores/usage'
import type { LLMEvent, LLMRequest, LLMResult, ModelAlias, ToolsetId, ToolTrace, Usage } from '../types'
import { uid } from '../utils'

// Вызов модели из браузера: псевдонимы → реальные ID, проверка лимитов,
// поток /api/llm, запись расходов в аналитику.

/** Данные OpenRouter о расходах считаются свежими 10 минут */
const SPEND_FRESH_MS = 10 * 60_000

export function budgetProblem(): string | null {
  const { limits } = useSettings.getState()
  const { events, openrouter } = useUsage.getState()
  // Прерванные запросы OpenRouter тоже списывает, а до приложения их расход
  // не доходит — поэтому лимит сверяем и с его собственными данными
  const fresh = openrouter && Date.now() - openrouter.fetchedAt < SPEND_FRESH_MS ? openrouter : null
  if (limits.dailyUsd > 0 && Math.max(spentSince(events, startOfDay()), fresh?.daily ?? 0) >= limits.dailyUsd) {
    return `Достигнут дневной лимит расходов ($${limits.dailyUsd}). Его можно поднять в настройках.`
  }
  if (limits.monthlyUsd > 0 && Math.max(spentSince(events, startOfMonth()), fresh?.monthly ?? 0) >= limits.monthlyUsd) {
    return `Достигнут месячный лимит расходов ($${limits.monthlyUsd}). Его можно поднять в настройках.`
  }
  return null
}

const emptyUsage = (): Usage => ({ promptTokens: 0, completionTokens: 0, cost: 0 })

const callLLMOnce: LLMCall = async (req: LLMRequest, opts: LLMCallOptions = {}): Promise<LLMResult> => {
  const started = performance.now()
  const model = resolveModelId(req.model)
  const base = { text: '', reasoning: '', tools: [] as ToolTrace[], usage: emptyUsage(), model: model ?? req.model, latencyMs: 0 }
  if (!model) {
    const label = isAlias(req.model) ? ALIAS_LABELS[req.model as ModelAlias].title : req.model
    return { ...base, error: `Не выбрана модель для роли «${label}». Откройте настройки → Модели.` }
  }
  const budget = budgetProblem()
  if (budget) return { ...base, error: budget }
  if (useSettings.getState().freeOnly && providerOf(model) === 'openrouter' && !isFreeModel(modelById(model))) {
    return { ...base, error: `Модель ${model} платная, а в настройках включён режим «Только бесплатные модели»` }
  }

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
      refused: !error && !aborted ? detectRefusal(text, tools.length) === 'refusal' || undefined : undefined,
    })
  }
  // Сверка с OpenRouter в фоне, не чаще раза в минуту — для лимитов и аналитики
  // Живые лимиты: после запроса OpenRouter — расход ключа, после подписки — её окна лимитов
  if (providerOf(model) === 'openrouter') void useUsage.getState().refreshOpenRouter()
  else if (isSubscriptionModel(model)) void useUsage.getState().refreshOpenRouter(true)
  return { text, reasoning, tools, usage: finalUsage, model, latencyMs, error: aborted ? undefined : error, aborted }
}

/** When free-only mode is enabled, recover from transient provider failures on another free model. */
/** Модель недоступна приложению совсем (например, «only available on agentic harnesses»), а не временно */
export function isModelUnavailable(error: string): boolean {
  return /Ошибка (403|404)\b|only available on agentic|No endpoints found|model .*not (found|available)/i.test(error)
}

/** Недоступную модель запоминаем, чтобы автовыбор ролей её больше не брал */
function noteUnavailable(result: LLMResult) {
  if (result.error && isModelUnavailable(result.error) && providerOf(result.model) === 'openrouter') {
    useCatalog.getState().markUnavailable(result.model, result.error.slice(0, 200))
  }
}

/**
 * Подписка в приоритете: модель OpenRouter, у которой есть такая же по
 * подписке, запускается через подписку (с тем же усилием). Не сработала
 * подписка — повтор той же моделью через OpenRouter; лимиты расходов и
 * режим «только бесплатные» при этом действуют как обычно.
 */
export const callLLM: LLMCall = async (req, opts = {}) => {
  const s = useSettings.getState()
  const { models } = useCatalog.getState()
  const resolved = resolveModelId(req.model)
  const twin = resolved && s.subscriptionFirst ? subscriptionTwin(resolved, models) : null
  const primary = twin ?? resolved
  if (twin) opts.onEvent?.({ t: 'notice', v: `Через подписку: ${twin}` })
  const first = await callWithFreeFallback(primary ? { ...req, model: primary } : req, opts)
  if (!first.error || first.text || opts.signal?.aborted || !primary || !isSubscriptionModel(primary) || !s.subscriptionFallback) return first
  const backup = twin ? resolved : openrouterTwin(primary, models)
  if (!backup) return first
  opts.onEvent?.({ t: 'notice', v: `Подписка не сработала: ${first.error.split('\n')[0].slice(0, 160)}. Повтор через OpenRouter: ${backup}` })
  const second = await callWithFreeFallback({ ...req, model: backup }, opts)
  return second.error && !second.text ? { ...second, error: `${first.error}\nЗапасной путь через OpenRouter: ${second.error}` } : second
}

const callWithFreeFallback: LLMCall = async (req, opts = {}) => {
  const first = await callLLMOnce(req, opts)
  noteUnavailable(first)
  const retryable = first.error && (/429|лимит запросов|перегруз|overload|rate limit|временно недоступ|503/i.test(first.error) || isModelUnavailable(first.error))
  if (!useSettings.getState().freeOnly || !retryable || first.text || opts.signal?.aborted) return first
  const { models, unavailable } = useCatalog.getState()
  const candidates = newestFreeModels(usableModels(models, unavailable)).filter((m) => m.id !== first.model && (!req.tools?.length || m.supportsTools)).slice(0, 2)
  let result = first
  for (const candidate of candidates) {
    opts.onEvent?.({ t: 'notice', v: `Модель ${result.model} недоступна. Пробуем бесплатную ${candidate.id}` })
    result = await callLLMOnce({ ...req, model: candidate.id }, opts)
    noteUnavailable(result)
    if (!result.error || result.text || opts.signal?.aborted) break
  }
  return result
}

/**
 * Терминал без права записи — роль проверяющего. Инструкция «не меняй файлы»
 * не защита: через терминал модель всё равно может их изменить (так и было
 * на настоящих моделях). Поэтому такие участники работают в копии проекта.
 */
export function needsScratchCopy(tools: ToolsetId[] | undefined): boolean {
  return !!tools?.includes('terminal') && !tools.includes('files_write')
}

/** callLLM, который запускает проверяющего с терминалом в одноразовой копии проекта */
export const callLLMSafe: LLMCall = async (req, opts = {}) => {
  if (req.sandbox || !needsScratchCopy(req.tools)) return callLLM(req, opts)
  let id: string
  try {
    ;({ id } = await api<{ id: string }>('/api/sandboxes', { method: 'POST', json: { action: 'create', label: opts.meta?.label ?? 'проверка' } }))
  } catch (e) {
    return { text: '', reasoning: '', tools: [], usage: emptyUsage(), model: req.model, latencyMs: 0, error: `Не удалось создать проверочную копию проекта: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    return await callLLM({ ...req, sandbox: id }, opts)
  } finally {
    void api(`/api/sandboxes?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }
}

export async function callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, opts: { sandbox?: string; root?: string } = {}): Promise<{ ok: boolean; output: string }> {
  try {
    const res = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args, sandbox: opts.sandbox, root: opts.root }), signal })
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

/** Копии проекта для блоков Кузницы со «своей копией» */
export const pipelineSandbox = {
  create: async (label: string) => (await api<{ id: string }>('/api/sandboxes', { method: 'POST', json: { action: 'create', label } })).id,
}
