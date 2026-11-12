import path from 'node:path'
import type { LimitWindow, SubscriptionLimits } from '../types'
import { readJson, writeJson } from './json-file'
import { DATA_DIR } from './paths'

// Лимиты подписок. Отдельного API у подписок нет — состояние лимитов CLI
// сообщают сами в потоке событий каждого запроса (Claude Code — событие
// rate_limit_event, Codex — rate_limits). Запоминаем последнее и показываем.

type Id = SubscriptionLimits['id']
const FILE = path.join(DATA_DIR, 'subscription-limits.json')
let state: Partial<Record<Id, SubscriptionLimits>> | null = null

async function load() {
  state ??= await readJson<Partial<Record<Id, SubscriptionLimits>>>(FILE, {})
  return state
}

export async function getSubscriptionLimits(): Promise<SubscriptionLimits[]> {
  return Object.values(await load()).filter(Boolean) as SubscriptionLimits[]
}

const CLAUDE_WINDOWS: Record<string, string> = {
  five_hour: '5 часов',
  seven_day: 'неделя',
  seven_day_opus: 'неделя · Opus',
  seven_day_sonnet: 'неделя · Sonnet',
  overage: 'сверх лимита',
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
/** Unix-время в секундах или миллисекундах, ISO-строка → миллисекунды */
function toMs(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : undefined
  }
  const n = num(v)
  if (n == null) return undefined
  return n < 1e12 ? n * 1000 : n
}

function windowLabel(minutes?: number): string {
  if (!minutes) return 'окно'
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} ч`
  if (minutes <= 60 * 24 * 7) return minutes === 60 * 24 * 7 ? 'неделя' : `${Math.round(minutes / 1440)} дн`
  return 'месяц'
}

/** Ищет объект с ключом на небольшой глубине: форматы событий меняются от версии к версии */
function findKey(o: unknown, key: string, depth = 0): unknown {
  if (!o || typeof o !== 'object' || depth > 4) return undefined
  const rec = o as Record<string, unknown>
  if (key in rec) return rec[key]
  for (const v of Object.values(rec)) {
    const hit = findKey(v, key, depth + 1)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Окна лимитов из одной строки потока CLI; null — в строке о лимитах ничего */
export function parseLimitLine(id: Id, line: string, now = Date.now()): LimitWindow[] | null {
  if (!line.includes('rate_limit')) return null
  let e: unknown
  try {
    e = JSON.parse(line)
  } catch {
    return null
  }
  if (id === 'claude-code') {
    const info = findKey(e, 'rate_limit_info') as Record<string, unknown> | undefined
    if (!info || typeof info !== 'object') return null
    const type = String(info.rateLimitType ?? info.rate_limit_type ?? 'five_hour')
    const util = num(info.utilization)
    return [
      {
        key: type,
        label: CLAUDE_WINDOWS[type] ?? type.replace(/_/g, ' '),
        usedPercent: util == null ? undefined : util <= 1 ? Math.round(util * 1000) / 10 : util,
        resetsAt: toMs(info.resetsAt ?? info.resets_at),
        status: info.status === 'rejected' ? 'exhausted' : String(info.status ?? '').includes('warning') ? 'warning' : 'ok',
        updatedAt: now,
      },
    ]
  }
  const limits = findKey(e, 'rate_limits') as Record<string, unknown> | undefined
  if (!limits || typeof limits !== 'object') return null
  const out: LimitWindow[] = []
  for (const key of ['primary', 'secondary']) {
    const w = limits[key] as Record<string, unknown> | undefined
    if (!w || typeof w !== 'object') continue
    const used = num(w.used_percent)
    const resetsIn = num(w.resets_in_seconds)
    const minutes = num(w.window_minutes)
    out.push({
      key,
      label: windowLabel(minutes),
      usedPercent: used,
      resetsAt: toMs(w.resets_at) ?? (resetsIn != null ? now + resetsIn * 1000 : undefined),
      status: used != null && used >= 100 ? 'exhausted' : used != null && used >= 80 ? 'warning' : 'ok',
      updatedAt: now,
    })
  }
  return out.length ? out : null
}

export async function recordLimits(id: Id, windows: LimitWindow[]): Promise<void> {
  const s = await load()
  const prev = s[id]?.windows ?? []
  const merged = [...prev.filter((w) => !windows.some((n) => n.key === w.key)), ...windows]
  s[id] = { id, windows: merged, updatedAt: Date.now() }
  await writeJson(FILE, s).catch(() => {})
}

/** Отметка «лимит исчерпан» по тексту ошибки CLI, когда события о лимите не было */
export async function recordExhausted(id: Id, message: string): Promise<void> {
  if (!/usage limit|rate limit|limit reached|лимит/i.test(message)) return
  await recordLimits(id, [{ key: 'error', label: 'лимит исчерпан', status: 'exhausted', updatedAt: Date.now(), note: message.slice(0, 200) }])
}
