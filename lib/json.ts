// Модели часто оборачивают JSON в ```-блоки, добавляют пояснения или
// оставляют висячие запятые. Здесь — терпимое извлечение JSON из ответа.

function findBalanced(s: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']'
  const start = s.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

function repair(s: string): string {
  return s
    .replace(/,\s*([}\]])/g, '$1') // висячие запятые
    .replace(/[“”]/g, '"') // «умные» кавычки вокруг ключей
}

export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidates = [fenced, text].filter(Boolean) as string[]
  for (const c of candidates) {
    const trimmed = c.trim()
    for (const attempt of [trimmed, findBalanced(trimmed, '{'), findBalanced(trimmed, '[')]) {
      if (!attempt) continue
      for (const variant of [attempt, repair(attempt)]) {
        try {
          return JSON.parse(variant) as T
        } catch {
          // следующий вариант
        }
      }
    }
  }
  return null
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}

export function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.').replace('%', '')) : NaN
  return Number.isFinite(n) ? n : fallback
}

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
