import { decodeEntities, isDdgBlocked, parseDdgLite, stripTags, UA, unwrapDdgUrl, type SearchResult } from './web'

// Свой метапоиск: несколько бесплатных поисковиков без ключей опрашиваются
// параллельно, выдачи сливаются. Если один поисковик блокирует запросы
// (капча, 429), он отдыхает, а поиск продолжает работать на остальных.
// Ответы кэшируются, а к одному поисковику ходим не чаще раза в секунду.

const ENGINE_TIMEOUT_MS = 10_000
const MIN_INTERVAL_MS = 1000
const CACHE_TTL_MS = 15 * 60_000
const CACHE_MAX = 200
const BLOCK_COOLDOWN_MS = 10 * 60_000
const BLOCK_COOLDOWN_MAX_MS = 60 * 60_000
const ERROR_COOLDOWN_MS = 2 * 60_000

export class EngineBlockedError extends Error {}

export interface SearchEngine {
  id: string
  name: string
  /** Вес в общей выдаче: справочные источники идут ниже обычного поиска */
  weight: number
  search: (query: string, max: number, signal: AbortSignal) => Promise<SearchResult[]>
}

async function get(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9', 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8', ...init.headers },
    signal,
  })
}

function checkStatus(res: Response, name: string) {
  if (res.status === 429 || res.status === 403) throw new EngineBlockedError(`${name} ограничил запросы (${res.status})`)
  if (!res.ok) throw new Error(`${name} ответил ${res.status}`)
}

// ─── Парсеры выдачи ──────────────────────────────────────────────────────

/** Ссылки Bing ведут через bing.com/ck/a?…&u=a1<base64url> */
export function unwrapBingUrl(href: string): string {
  const decoded = decodeEntities(href)
  const m = decoded.match(/[?&]u=a1([^&]+)/)
  if (!m) return decoded
  try {
    return Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return decoded
  }
}

export function parseBing(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []
  const blocks = html.split('<li class="b_algo"').slice(1)
  for (const block of blocks) {
    if (results.length >= max) break
    const a = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const url = unwrapBingUrl(a[1])
    if (!/^https?:\/\//.test(url)) continue
    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ''
    results.push({ title: stripTags(a[2]), url, snippet: stripTags(snippet).replace(/^[^·]{0,20}·\s*/, '') })
  }
  return results
}

export function parseDdgHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []
  const blocks = html.split(/<div class="result results_links/).slice(1)
  for (const block of blocks) {
    if (results.length >= max) break
    if (/result--ad/.test(block.slice(0, 200))) continue // реклама
    const a = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const url = unwrapDdgUrl(a[1])
    if (!/^https?:\/\//.test(url) || url.includes('duckduckgo.com/y.js')) continue
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ''
    results.push({ title: stripTags(a[2]), url, snippet: stripTags(snippet) })
  }
  return results
}

export function parseWikipedia(json: unknown, lang: string, max: number): SearchResult[] {
  const items = (json as { query?: { search?: { title?: string; snippet?: string }[] } })?.query?.search ?? []
  return items.slice(0, max).flatMap((it) =>
    it.title ? [{ title: `${it.title} — Википедия`, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, '_'))}`, snippet: stripTags(it.snippet ?? '') }] : [],
  )
}

// ─── Поисковики ──────────────────────────────────────────────────────────

const bing: SearchEngine = {
  id: 'bing',
  name: 'Bing',
  weight: 1,
  async search(query, max, signal) {
    const res = await get(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, signal)
    checkStatus(res, 'Bing')
    const html = await res.text()
    if (/captcha|b_captcha/i.test(html) && !html.includes('b_algo')) throw new EngineBlockedError('Bing просит пройти капчу')
    return parseBing(html, max)
  },
}

const ddgHtml: SearchEngine = {
  id: 'ddg-html',
  name: 'DuckDuckGo',
  weight: 1,
  async search(query, max, signal) {
    const res = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, signal)
    checkStatus(res, 'DuckDuckGo')
    const html = await res.text()
    if (/anomaly-modal/.test(html) || (res.status === 202 && !html.includes('result__a'))) throw new EngineBlockedError('DuckDuckGo просит пройти антибот-проверку')
    return parseDdgHtml(html, max)
  },
}

const ddgLite: SearchEngine = {
  id: 'ddg-lite',
  name: 'DuckDuckGo Lite',
  weight: 0.9,
  async search(query, max, signal) {
    const res = await get('https://lite.duckduckgo.com/lite/', signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(query)}&kl=wt-wt`,
    })
    checkStatus(res, 'DuckDuckGo Lite')
    const html = await res.text()
    if (isDdgBlocked(res.status, html)) throw new EngineBlockedError('DuckDuckGo Lite просит пройти антибот-проверку')
    return parseDdgLite(html, max)
  },
}

const wikipedia: SearchEngine = {
  id: 'wikipedia',
  name: 'Википедия',
  weight: 0.6,
  async search(query, max, signal) {
    const lang = /[а-яё]/i.test(query) ? 'ru' : 'en'
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srprop=snippet&srlimit=${Math.min(max, 5)}&srsearch=${encodeURIComponent(query)}`
    const res = await get(url, signal, { headers: { 'User-Agent': 'Hephaestus/2.0 (https://github.com/YpCIIIaK/Hephaestus)' } })
    checkStatus(res, 'Википедия')
    return parseWikipedia(await res.json(), lang, max)
  },
}

function searxng(base: string): SearchEngine {
  return {
    id: 'searxng',
    name: 'SearXNG',
    weight: 1.1,
    async search(query, max, signal) {
      const res = await get(`${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json`, signal, { headers: { Accept: 'application/json' } })
      checkStatus(res, 'SearXNG')
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
      return (data.results ?? []).slice(0, max).map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }))
    },
  }
}

export function getEngines(): SearchEngine[] {
  const list = [bing, ddgHtml, ddgLite, wikipedia]
  return process.env.SEARXNG_URL ? [searxng(process.env.SEARXNG_URL), ...list] : list
}

// ─── Слияние выдач ───────────────────────────────────────────────────────

const TRACKING = /^(utm_\w+|yclid|gclid|fbclid|from|ref)$/i

/** Ключ для поиска дублей: без протокола, www, якоря, трекинговых параметров и «/» в конце */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
    const query = u.searchParams.toString()
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`.toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

/** Reciprocal rank fusion: результат, найденный несколькими поисковиками, поднимается выше */
export function mergeResults(lists: { engine: SearchEngine; results: SearchResult[] }[], max: number): SearchResult[] {
  const merged = new Map<string, SearchResult & { score: number }>()
  for (const { engine, results } of lists) {
    results.forEach((r, rank) => {
      const key = normalizeUrl(r.url)
      const score = engine.weight / (rank + 10)
      const prev = merged.get(key)
      if (!prev) merged.set(key, { ...r, score })
      else {
        prev.score += score
        if (r.snippet.length > prev.snippet.length) prev.snippet = r.snippet
        if (!prev.title && r.title) prev.title = r.title
      }
    })
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ title, url, snippet }) => ({ title, url, snippet }))
}

// ─── Состояние поисковиков и кэш ─────────────────────────────────────────

export interface EngineStatus {
  id: string
  name: string
  /** До какого времени поисковик отдыхает после блокировки или ошибки */
  pausedUntil?: number
  lastError?: string
  ok: number
  failed: number
}

const state = new Map<string, EngineStatus & { strikes: number; nextSlot: number }>()
const cache = new Map<string, { at: number; results: SearchResult[] }>()

function stateOf(e: SearchEngine) {
  let s = state.get(e.id)
  if (!s) state.set(e.id, (s = { id: e.id, name: e.name, ok: 0, failed: 0, strikes: 0, nextSlot: 0 }))
  return s
}

export function searchStatus(): EngineStatus[] {
  return getEngines().map((e) => {
    const { strikes: _s, nextSlot: _n, ...pub } = stateOf(e)
    return pub
  })
}

/** Для тестов */
export function resetSearchState() {
  state.clear()
  cache.clear()
}

async function runEngine(e: SearchEngine, query: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const s = stateOf(e)
  // Вежливость: не чаще раза в секунду к одному поисковику
  const wait = s.nextSlot - Date.now()
  s.nextSlot = Math.max(Date.now(), s.nextSlot) + MIN_INTERVAL_MS
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  const timeout = AbortSignal.timeout(ENGINE_TIMEOUT_MS)
  try {
    const results = await e.search(query, max, signal ? AbortSignal.any([signal, timeout]) : timeout)
    s.ok++
    s.strikes = 0
    s.pausedUntil = undefined
    s.lastError = undefined
    return results
  } catch (err) {
    if (signal?.aborted) throw err
    s.failed++
    s.lastError = err instanceof Error ? (err.name === 'TimeoutError' ? `${e.name} не ответил вовремя` : err.message) : String(err)
    const blocked = err instanceof EngineBlockedError
    s.strikes++
    s.pausedUntil = Date.now() + (blocked ? Math.min(BLOCK_COOLDOWN_MS * 2 ** (s.strikes - 1), BLOCK_COOLDOWN_MAX_MS) : ERROR_COOLDOWN_MS)
    throw err
  }
}

export async function webSearch(query: string, max = 6, signal?: AbortSignal): Promise<SearchResult[]> {
  const key = `${max}\n${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results

  const engines = getEngines()
  let active = engines.filter((e) => !((stateOf(e).pausedUntil ?? 0) > Date.now()))
  // Все на паузе — пробуем того, кто освободится раньше всех
  if (!active.length) active = [engines.reduce((a, b) => ((stateOf(a).pausedUntil ?? 0) <= (stateOf(b).pausedUntil ?? 0) ? a : b))]

  const settled = await Promise.allSettled(active.map(async (engine) => ({ engine, results: await runEngine(engine, query, max, signal) })))
  if (signal?.aborted) throw new DOMException('Поиск остановлен', 'AbortError')
  const lists = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (!lists.length) {
    const reasons = settled.map((r) => (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : '')).filter(Boolean)
    throw new Error(`Веб-поиск временно недоступен: ${reasons.join('; ')}. Повторите позже или укажите свой SearXNG в .env (SEARXNG_URL)`)
  }
  const results = mergeResults(lists, max)
  cache.set(key, { at: Date.now(), results })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return results
}
