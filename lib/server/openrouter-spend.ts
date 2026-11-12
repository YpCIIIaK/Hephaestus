import { getOpenRouterKey } from './settings'

// Точные расходы ключа по данным самого OpenRouter. Приложение считает расход
// по ответам моделей, но прерванный запрос OpenRouter тоже списывает, а ответ
// с расходом до нас уже не доходит. Поэтому сверяемся с первоисточником.

export interface OpenRouterSpend {
  /** Сутки по UTC, неделя, месяц, всё время — в долларах */
  daily: number
  weekly: number
  monthly: number
  total: number
  limit: number | null
  remaining: number | null
  fetchedAt: number
}

const CACHE_MS = 60_000
let cache: { at: number; value: OpenRouterSpend | null } | null = null

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function parseKeyInfo(data: Record<string, unknown>, now = Date.now()): OpenRouterSpend {
  return {
    daily: num(data.usage_daily),
    weekly: num(data.usage_weekly),
    monthly: num(data.usage_monthly),
    total: num(data.usage),
    limit: typeof data.limit === 'number' ? data.limit : null,
    remaining: typeof data.limit_remaining === 'number' ? data.limit_remaining : null,
    fetchedAt: now,
  }
}

/** null — ключа OpenRouter нет или он не ответил */
export async function getOpenRouterSpend(force = false): Promise<OpenRouterSpend | null> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const { key } = await getOpenRouterKey()
  if (!key || process.env.HEPHAESTUS_MOCK_LLM === '1') return null
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(String(res.status))
    const { data } = (await res.json()) as { data?: Record<string, unknown> }
    cache = { at: Date.now(), value: data ? parseKeyInfo(data) : null }
  } catch {
    cache = { at: Date.now(), value: cache?.value ?? null }
  }
  return cache.value
}
