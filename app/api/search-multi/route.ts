/**
 * Multi-Source Web Search API
 * 
 * Поддерживает:
 * - DuckDuckGo Lite (бесплатно, без API key)
 * - SearXNG (self-hosted или публичные инстансы)
 * - Google Custom Search (требует API key)
 * - Bing Web Search (требует API key)
 * - RSS/News feeds
 * - Web scraping для извлечения контента страниц
 * 
 * Автоматический fallback между источниками
 */

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: 'duckduckgo' | 'searxng' | 'google' | 'bing' | 'rss' | 'scraped'
  score?: number
}

interface SearchConfig {
  query: string
  maxResults: number
  sources?: ('duckduckgo' | 'searxng' | 'google' | 'bing' | 'rss')[]
  scrapeContent?: boolean
  language?: string
  timeRange?: 'day' | 'week' | 'month' | 'year' | 'any'
}

// ==================== SEARCH PROVIDERS ====================

async function searchDuckDuckGo(query: string, maxResults: number, language = 'en'): Promise<SearchResult[]> {
  try {
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': `${language},en;q=0.5`,
        'Origin': 'https://lite.duckduckgo.com',
        'Referer': 'https://lite.duckduckgo.com/'
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10000)
    })

    if (!res.ok) return []

    const html = await res.text()
    const results: SearchResult[] = []
    
    // Parse results from DDG Lite HTML
    const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>(.*?)<\/td>/gi
    
    let links = [...html.matchAll(linkRegex)]
    let snippets = [...html.matchAll(snippetRegex)]
    
    for (let i = 0; i < Math.min(maxResults, links.length); i++) {
      const url = links[i][1].replace(/https?:\/\/(?:www\.)?duckduckgo\.com\/l\/\?uddg=/, '')
      const title = links[i][2].replace(/<[^>]+>/g, '').trim()
      const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]+>/g, '').trim() : ''
      
      if (title) {
        results.push({
          title,
          url: decodeURIComponent(url),
          snippet: snippet || title,
          source: 'duckduckgo'
        })
      }
    }
    
    return results
  } catch (e) {
    console.warn('[Search] DuckDuckGo failed:', e)
    return []
  }
}

async function searchSearXNG(query: string, maxResults: number, language = 'en'): Promise<SearchResult[]> {
  const searxngInstance = process.env.SEARCH_SEARXNG_URL || 'https://search.bus-hit.me'
  
  try {
    const url = `${searxngInstance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=${language}&pageno=1&max_results=${maxResults}`
    
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' }
    })
    
    if (!res.ok) return []
    
    const data = await res.json()
    
    return (data.results || []).slice(0, maxResults).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      source: 'searxng' as const,
      score: r.score
    }))
  } catch (e) {
    console.warn('[Search] SearXNG failed:', e)
    return []
  }
}

async function searchGoogle(query: string, maxResults: number, language = 'en'): Promise<SearchResult[]> {
  const apiKey = process.env.SEARCH_GOOGLE_API_KEY
  const cx = process.env.SEARCH_GOOGLE_CX
  
  if (!apiKey || !cx) return []
  
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}&lr=lang_${language}`
    
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    
    if (!res.ok) return []
    
    const data = await res.json()
    
    return (data.items || []).map((item: any) => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      source: 'google' as const
    }))
  } catch (e) {
    console.warn('[Search] Google failed:', e)
    return []
  }
}

async function searchBing(query: string, maxResults: number, language = 'en'): Promise<SearchResult[]> {
  const apiKey = process.env.SEARCH_BING_API_KEY
  
  if (!apiKey) return []
  
  try {
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${maxResults}&mkt=${language}-${language.toUpperCase()}`
    
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Ocp-Apim-Subscription-Key': apiKey }
    })
    
    if (!res.ok) return []
    
    const data = await res.json()
    
    return (data.webPages?.value || []).map((item: any) => ({
      title: item.name || '',
      url: item.url || '',
      snippet: item.snippet || '',
      source: 'bing' as const
    }))
  } catch (e) {
    console.warn('[Search] Bing failed:', e)
    return []
  }
}

async function searchRSS(feeds: string[], query: string, maxResults: number): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  
  for (const feedUrl of feeds.slice(0, 5)) {
    try {
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      
      const xml = await res.text()
      
      // Parse RSS/Atom feed
      const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || []
      
      for (const item of items.slice(0, maxResults)) {
        const title = item.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || ''
        const link = item.match(/<link[^>]*>(.*?)<\/link>/i)?.[1] || ''
        const desc = item.match(/<description[^>]*>(.*?)<\/description>/i)?.[1]?.replace(/<[^>]+>/g, '') || ''
        
        if (title && !query || (title.toLowerCase().includes(query.toLowerCase()) || desc.toLowerCase().includes(query.toLowerCase()))) {
          results.push({
            title: title.trim(),
            url: link,
            snippet: desc.trim().slice(0, 300),
            source: 'rss' as const
          })
        }
      }
    } catch (e) {
      console.warn(`[Search] RSS feed failed: ${feedUrl}`, e)
    }
  }
  
  return results.slice(0, maxResults)
}

// ==================== WEB SCRAPING ====================

async function scrapeWebContent(urls: string[], maxContentPerUrl = 5000): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  
  for (const url of urls.slice(0, 10)) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HephaestusBot/1.0; +https://github.com/YpCIIIaK/Hephaestus)'
        }
      })
      
      if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) continue
      
      const html = await res.text()
      
      // Extract readable content
      let content = html
      
      // Remove scripts and styles
      content = content.replace(/<script[\s\S]*?<\/script>/gi, '')
      content = content.replace(/<style[\s\S]*?<\/style>/gi, '')
      content = content.replace(/<[^>]+>/g, ' ')
      content = content.replace(/\s+/g, ' ').trim()
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      const title = titleMatch?.[1]?.trim() || url
      
      // Truncate content
      const snippet = content.slice(0, maxContentPerUrl)
      
      results.push({
        title,
        url,
        snippet,
        source: 'scraped' as const
      })
    } catch (e) {
      console.warn(`[Scrape] Failed: ${url}`, e)
    }
  }
  
  return results
}

// ==================== MAIN SEARCH FUNCTION ====================

export async function performMultiSearch(config: SearchConfig): Promise<SearchResult[]> {
  const {
    query,
    maxResults,
    sources = ['duckduckgo', 'searxng'],
    scrapeContent = false,
    language = 'en'
  } = config
  
  const allResults: SearchResult[] = []
  const promises: Promise<SearchResult[]>[] = []
  
  // Launch all search providers in parallel
  if (sources.includes('duckduckgo')) {
    promises.push(searchDuckDuckGo(query, maxResults, language))
  }
  
  if (sources.includes('searxng')) {
    promises.push(searchSearXNG(query, maxResults * 2, language))
  }
  
  if (sources.includes('google')) {
    promises.push(searchGoogle(query, maxResults, language))
  }
  
  if (sources.includes('bing')) {
    promises.push(searchBing(query, maxResults, language))
  }
  
  // Wait for all searches with timeout
  const results = await Promise.allSettled(promises)
  
  // Merge results
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value)
    }
  }
  
  // Deduplicate by URL
  const seen = new Set<string>()
  const uniqueResults = allResults.filter(r => {
    const normalizedUrl = r.url.toLowerCase().replace(/\/$/, '')
    if (seen.has(normalizedUrl)) return false
    seen.add(normalizedUrl)
    return true
  })
  
  // Sort by relevance (keep top results from each source)
  uniqueResults.sort((a, b) => {
    // Prefer sources with snippets
    const aHasSnippet = a.snippet.length > 50 ? 1 : 0
    const bHasSnippet = b.snippet.length > 50 ? 1 : 0
    return bHasSnippet - aHasSnippet || (b.score || 0) - (a.score || 0)
  })
  
  let finalResults = uniqueResults.slice(0, maxResults)
  
  // Scrape content if requested
  if (scrapeContent && finalResults.length > 0) {
    const urlsToScrape = finalResults.map(r => r.url).slice(0, Math.min(5, maxResults))
    const scrapedContent = await scrapeWebContent(urlsToScrape)
    
    // Merge scraped content with search results
    finalResults = finalResults.map(r => {
      const scraped = scrapedContent.find(s => s.url === r.url)
      return scraped ? { ...r, snippet: scraped.snippet, source: 'scraped' as const } : r
    })
  }
  
  return finalResults
}

// ==================== API HANDLER ====================

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      query,
      maxResults = 10,
      sources = ['duckduckgo', 'searxng'],
      scrapeContent = false,
      language = 'en',
      timeRange = 'any',
      rssFeeds = []
    } = body
    
    if (!query) {
      return Response.json({ error: 'Query is required' }, { status: 400 })
    }
    
    console.log(`[Multi-Search] Query: "${query}", Sources: ${sources.join(', ')}, Max: ${maxResults}`)
    
    let results = await performMultiSearch({
      query,
      maxResults,
      sources,
      scrapeContent,
      language
    })
    
    // Add RSS results if provided
    if (rssFeeds?.length > 0) {
      const rssResults = await searchRSS(rssFeeds, query, Math.floor(maxResults / 3))
      results = [...results, ...rssResults].slice(0, maxResults)
    }
    
    // Format for output
    const formattedResults = results.map(r => ({
      title: r.title,
      snippet: r.snippet,
      url: r.url,
      source: r.source
    }))
    
    const summary = {
      totalResults: results.length,
      sources: [...new Set(results.map(r => r.source))],
      hasScrapedContent: results.some(r => r.source === 'scraped'),
      query,
      timestamp: new Date().toISOString()
    }
    
    return Response.json({
      success: true,
      results: formattedResults,
      summary,
      metadata: {
        searchTime: Date.now(),
        sourcesUsed: sources
      }
    })
    
  } catch (error: any) {
    console.error('[Multi-Search] Error:', error)
    return Response.json({ error: error.message || 'Search failed' }, { status: 500 })
  }
}