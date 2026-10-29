import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEngines, mergeResults, normalizeUrl, parseBing, parseDdgHtml, parseWikipedia, resetSearchState, searchStatus, unwrapBingUrl, webSearch, type SearchEngine } from '@/lib/server/search'

// Фрагменты настоящей выдачи по запросу «ключевая ставка Банк России»
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

describe('метапоиск: разбор выдачи', () => {
  it('Bing: раскрывает ссылки ck/a?u=a1<base64> и чистит сниппеты', () => {
    const r = parseBing(fixture('bing.html'), 10)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({
      title: 'Ключевая ставка Банка России | Банк России',
      url: 'https://cbr.ru/hd_base/KeyRate/',
      snippet: expect.stringMatching(/^Данные доступны с 17\.09\.2013/),
    })
    expect(r.every((x) => !x.url.includes('bing.com'))).toBe(true)
    expect(unwrapBingUrl('https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1aHR0cHM6Ly9mdW5kc3RhdC5ydS9rZXktcmF0ZS8&amp;ntb=1')).toBe('https://fundstat.ru/key-rate/')
  })

  it('DuckDuckGo HTML: раскрывает uddg и пропускает рекламу', () => {
    const ad = '<div class="result results_links results_links_deep result--ad "><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Реклама</a></div>'
    const r = parseDdgHtml(ad + fixture('ddg-html.html'), 10)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ title: 'Ключевая ставка Банка России | Банк России', url: 'https://cbr.ru/hd_base/KeyRate/' })
    expect(r[0].snippet).toMatch(/^Данные доступны/)
  })

  it('Википедия: ссылки на статьи нужного языка', () => {
    const r = parseWikipedia({ query: { search: [{ title: 'Ключевая ставка', snippet: '<span class="searchmatch">Ключевая</span> ставка — процентная' }] } }, 'ru', 5)
    expect(r).toEqual([{ title: 'Ключевая ставка — Википедия', url: 'https://ru.wikipedia.org/wiki/%D0%9A%D0%BB%D1%8E%D1%87%D0%B5%D0%B2%D0%B0%D1%8F_%D1%81%D1%82%D0%B0%D0%B2%D0%BA%D0%B0', snippet: 'Ключевая ставка — процентная' }])
    expect(parseWikipedia({}, 'en', 5)).toEqual([])
  })
})

describe('метапоиск: слияние', () => {
  const engine = (id: string, weight = 1): SearchEngine => ({ id, name: id, weight, search: async () => [] })

  it('склеивает дубли и поднимает то, что нашли несколько поисковиков', () => {
    expect(normalizeUrl('https://www.cbr.ru/hd_base/KeyRate/?utm_source=x#top')).toBe(normalizeUrl('http://cbr.ru/hd_base/KeyRate'))
    const merged = mergeResults(
      [
        { engine: engine('a'), results: [{ title: 'A1', url: 'https://a.ru/1', snippet: '' }, { title: 'Общий', url: 'https://www.both.ru/x/', snippet: 'коротко' }] },
        { engine: engine('b'), results: [{ title: 'B1', url: 'https://b.ru/1', snippet: '' }, { title: 'Общий', url: 'https://both.ru/x?utm_medium=y', snippet: 'подробный сниппет' }] },
        { engine: engine('wiki', 0.6), results: [{ title: 'W', url: 'https://ru.wikipedia.org/wiki/X', snippet: '' }] },
      ],
      10,
    )
    expect(merged[0]).toEqual({ title: 'Общий', url: 'https://www.both.ru/x/', snippet: 'подробный сниппет' })
    expect(merged).toHaveLength(4)
    expect(merged.at(-1)!.title).toBe('W')
  })
})

describe('метапоиск: устойчивость', () => {
  const bingPage = () => new Response(fixture('bing.html'), { status: 200 })
  const ddgPage = () => new Response(fixture('ddg-html.html'), { status: 200 })
  const ddgBlocked = () => new Response('<div class="anomaly-modal__box">bots</div>', { status: 202 })

  beforeEach(() => {
    resetSearchState()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'], shouldAdvanceTime: true, advanceTimeDelta: 50 })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function route(handlers: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (url: string) => {
      const key = Object.keys(handlers).find((k) => String(url).includes(k))
      return key ? handlers[key]() : new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('продолжает работать, когда DuckDuckGo заблокировал запросы, и даёт ему отдохнуть', async () => {
    const fetchMock = route({ 'www.bing.com': bingPage, 'html.duckduckgo.com': ddgBlocked, 'lite.duckduckgo.com': ddgBlocked, 'wikipedia.org': () => Response.json({ query: { search: [] } }) })
    const r = await webSearch('ключевая ставка Банк России', 6)
    expect(r[0].url).toBe('https://cbr.ru/hd_base/KeyRate/')
    const ddg = searchStatus().find((e) => e.id === 'ddg-html')!
    expect(ddg.lastError).toMatch(/антибот/)
    expect(ddg.pausedUntil! - Date.now()).toBeGreaterThan(9 * 60_000)

    // следующий запрос к заблокированному поисковику не идёт
    fetchMock.mockClear()
    await webSearch('другой запрос', 6)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('duckduckgo'))).toBe(false)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('bing.com'))).toBe(true)
  })

  it('кэширует одинаковые запросы', async () => {
    const fetchMock = route({ 'www.bing.com': bingPage, 'html.duckduckgo.com': ddgPage, 'lite.duckduckgo.com': ddgPage, 'wikipedia.org': () => Response.json({}) })
    const a = await webSearch('Ключевая  ставка', 6)
    const calls = fetchMock.mock.calls.length
    const b = await webSearch('ключевая ставка', 6)
    expect(b).toEqual(a)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('если недоступны все поисковики — понятная ошибка с причинами', async () => {
    route({ 'www.bing.com': () => new Response('', { status: 429 }), duckduckgo: ddgBlocked, 'wikipedia.org': () => new Response('', { status: 503 }) })
    await expect(webSearch('что угодно', 6)).rejects.toThrow(/Веб-поиск временно недоступен: Bing ограничил запросы \(429\); .*антибот.*; Википедия ответил 503/)
  })

  it('SearXNG из .env подключается первым', () => {
    expect(getEngines().map((e) => e.id)).toEqual(['bing', 'ddg-html', 'ddg-lite', 'wikipedia'])
    vi.stubEnv('SEARXNG_URL', 'http://127.0.0.1:8888')
    expect(getEngines()[0].id).toBe('searxng')
    vi.unstubAllEnvs()
  })
})
