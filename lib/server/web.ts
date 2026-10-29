// Веб-поиск и загрузка страниц для инструментов модели.

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36'

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/** Ссылки DuckDuckGo ведут через редирект //duckduckgo.com/l/?uddg=<url> */
export function unwrapDdgUrl(href: string): string {
  const decoded = decodeEntities(href)
  const m = decoded.match(/[?&]uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return m[1]
    }
  }
  return decoded.startsWith('//') ? `https:${decoded}` : decoded
}

export function parseDdgLite(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []
  const linkRe = /<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/gi
  const links = html.match(linkRe) ?? []
  const snippets = html.match(/<td[^>]*class=['"]result-snippet['"][^>]*>[\s\S]*?<\/td>/gi) ?? []
  for (let i = 0; i < links.length && results.length < max; i++) {
    const href = links[i].match(/href=['"]([^'"]+)['"]/i)?.[1]
    if (!href) continue
    const url = unwrapDdgUrl(href)
    if (url.includes('duckduckgo.com/y.js')) continue // реклама
    results.push({ title: stripTags(links[i]), url, snippet: stripTags(snippets[i] ?? '') })
  }
  return results
}

export function isDdgBlocked(status: number, html: string): boolean {
  return /anomaly-modal/.test(html) || (status === 202 && !/result-link/.test(html))
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (!results.length) return `По запросу «${query}» ничего не найдено.`
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
}

// ─── Загрузка страницы ───────────────────────────────────────────────────

const PRIVATE_HOST = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
]

/** Модель не должна ходить по локальной сети: страница с prompt injection может натравить её на наш же API */
export function assertPublicUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Некорректный URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Разрешены только http и https')
  if (PRIVATE_HOST.some((re) => re.test(u.hostname))) throw new Error('Адреса локальной сети недоступны')
  return u
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Number(n)) + ' ')
  const text = decodeEntities(body.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { title, text }
}

export async function fetchPage(raw: string, maxChars = 12_000, signal?: AbortSignal): Promise<string> {
  const url = assertPublicUrl(raw)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,application/json;q=0.9' },
    redirect: 'follow',
    signal: signal ?? AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Страница ответила ${res.status}`)
  assertPublicUrl(res.url || url.toString())
  const type = res.headers.get('content-type') ?? ''
  const raw2 = (await res.text()).slice(0, 3_000_000)
  const { title, text } = type.includes('html') ? htmlToText(raw2) : { title: '', text: raw2 }
  const clipped = text.length > maxChars ? text.slice(0, maxChars) + '\n…[обрезано]' : text
  return `${title ? `# ${title}\n` : ''}${url.toString()}\n\n${clipped}`
}
