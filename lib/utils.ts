import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return prefix ? `${prefix}_${rand}` : rand
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Деньги: мелкие суммы показываем с нужной точностью, чтобы не было «$0.00» у живых расходов */
export function formatCost(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '$0'
  const abs = Math.abs(value)
  if (abs < 0.0001) return '<$0.0001'
  if (abs < 0.01) return `$${value.toFixed(4)}`
  if (abs < 1) return `$${value.toFixed(3)}`
  return usd.format(value)
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m} мин ${s} с`
}

/** Цена за миллион токенов для подписи в каталоге */
export function formatPricePerM(perToken: number | undefined): string {
  if (perToken == null) return '—'
  if (perToken === 0) return 'бесплатно'
  const perM = perToken * 1_000_000
  return perM < 1 ? `$${perM.toFixed(2)}` : `$${perM.toFixed(perM < 10 ? 2 : 0)}`
}

const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })

export function formatRelative(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  const diff = (t - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'только что'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86_400 * 7) return rtf.format(Math.round(diff / 86_400), 'day')
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: abs > 86_400 * 300 ? 'numeric' : undefined })
}

/** Русское склонение: plural(5, ['модель', 'модели', 'моделей']) */
export function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1]
  return forms[2]
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}

export function dayKey(iso: string | number): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
