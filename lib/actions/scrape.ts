// Web Scraping action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface ScrapeInputs {
  url: string
  selectors: Record<string, string> | string // CSS selectors or single string
  waitFor?: string // Selector to wait for
  waitTime?: number // Milliseconds to wait
  scrollToBottom?: boolean
  headers?: Record<string, string>
  usePuppeteer?: boolean // Use headless browser vs simple fetch
}

interface ScrapeResult {
  url: string
  title?: string
  data: Record<string, any>
  scrapedAt: string
}

export const webScrapeAction: Action = {
  id: 'web-scrape',
  name: 'Web Scraping',
  description: 'Спарсить данные с веб-сайта используя CSS селекторы',
  category: 'data',
  icon: 'globe',
  inputs: [
    { name: 'url', type: 'string', required: true, description: 'URL для парсинга' },
    { name: 'selectors', type: 'json', required: true, description: 'JSON объект с CSS селекторами {title: "h1", links: "a[href]"}' },
    { name: 'waitFor', type: 'string', required: false, description: 'Селектор для ожидания загрузки (для динамических сайтов)' },
    { name: 'waitTime', type: 'number', required: false, description: 'Время ожидания после загрузки (мс)', default: 1000 },
    { name: 'scrollToBottom', type: 'boolean', required: false, description: 'Прокрутить до конца страницы', default: false },
    { name: 'headers', type: 'json', required: false, description: 'JSON объект с HTTP заголовками' },
    { name: 'usePuppeteer', type: 'boolean', required: false, description: 'Использовать headless browser (для JS-сайтов)', default: false },
  ],
  outputs: [
    { name: 'url', type: 'string', description: 'Исходный URL' },
    { name: 'title', type: 'string', description: 'Заголовок страницы' },
    { name: 'data', type: 'object', description: 'Результаты парсинга по селекторам' },
    { name: 'scrapedAt', type: 'string', description: 'Время парсинга' },
  ],
  config: { 
    requiresAuth: false,
    retryCount: 2,
    timeoutMs: 60000,
    rateLimit: 30 // requests per minute
  },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { 
        url, 
        selectors,
        waitFor,
        waitTime = 1000,
        scrollToBottom = false,
        headers = {},
        usePuppeteer = false,
      } = inputs as ScrapeInputs

      if (!url) {
        return {
          success: false,
          error: 'Missing required field: url',
          metadata: { duration: Date.now() - startTime }
        }
      }

      let parsedSelectors: Record<string, string>
      if (typeof selectors === 'string') {
        try {
          parsedSelectors = JSON.parse(selectors)
        } catch {
          // Single selector
          parsedSelectors = { content: selectors }
        }
      } else {
        parsedSelectors = selectors
      }

      // Server-side only
      if (typeof window === 'undefined') {
        let result: ScrapeResult

        if (usePuppeteer) {
          // Use Puppeteer for JS-rendered sites
          result = await scrapeWithPuppeteer(url, parsedSelectors, {
            waitFor,
            waitTime,
            scrollToBottom,
            headers,
          })
        } else {
          // Use Cheerio for static sites (faster)
          result = await scrapeWithCheerio(url, parsedSelectors, { headers })
        }

        return {
          success: true,
          data: result,
          metadata: { duration: Date.now() - startTime }
        }
      } else {
        // Client-side: use API
        const res = await fetch('/api/actions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: 'web-scrape',
            inputs,
            context
          })
        })
        
        if (!res.ok) {
          const error = await res.text()
          return {
            success: false,
            error: `API error: ${error}`,
            metadata: { duration: Date.now() - startTime }
          }
        }
        
        return await res.json()
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to scrape website',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Cheerio-based scraping (fast, for static sites)
async function scrapeWithCheerio(
  url: string, 
  selectors: Record<string, string>,
  options: { headers?: Record<string, string> }
): Promise<ScrapeResult> {
  const cheerio = await import('cheerio')
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      ...options.headers,
    }
  })

  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}: ${res.statusText}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)
  
  const data: Record<string, any> = {}
  
  for (const [key, selector] of Object.entries(selectors)) {
    const elements = $(selector)
    
    if (elements.length === 0) {
      data[key] = null
    } else if (elements.length === 1) {
      // Single element
      const el = elements.first()
      data[key] = extractElementData(el, $)
    } else {
      // Multiple elements
      data[key] = elements.map((_, el) => extractElementData($(el), $)).get()
    }
  }

  return {
    url,
    title: $('title').text().trim() || undefined,
    data,
    scrapedAt: new Date().toISOString(),
  }
}

function extractElementData(el: any, $: any): any {
  const href = el.attr('href')
  const src = el.attr('src')
  const text = el.text().trim()
  
  return {
    text,
    html: el.html(),
    href: href ? resolveUrl(href, '') : undefined,
    src: src ? resolveUrl(src, '') : undefined,
    attributes: el.attr(),
  }
}

function resolveUrl(url: string, base: string): string {
  if (url.startsWith('http')) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${base}${url}`
  return url
}

// Puppeteer-based scraping (for JS-rendered sites)
async function scrapeWithPuppeteer(
  url: string,
  selectors: Record<string, string>,
  options: {
    waitFor?: string
    waitTime?: number
    scrollToBottom?: boolean
    headers?: Record<string, string>
  }
): Promise<ScrapeResult> {
  const puppeteer = await import('puppeteer')
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    const page = await browser.newPage()
    
    // Set headers
    if (options.headers) {
      await page.setExtraHTTPHeaders(options.headers)
    }
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')

    await page.goto(url, { waitUntil: 'networkidle2' })

    // Wait for specific element if requested
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10000 })
    }

    // Additional wait time
    if (options.waitTime && options.waitTime > 0) {
      await page.waitForTimeout(options.waitTime)
    }

    // Scroll to bottom if requested (for infinite scroll)
    if (options.scrollToBottom) {
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0
          const distance = 100
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight
            window.scrollBy(0, distance)
            totalHeight += distance

            if (totalHeight >= scrollHeight) {
              clearInterval(timer)
              resolve()
            }
          }, 100)
        })
      })
    }

    // Extract data using selectors
    const data = await page.evaluate((selectors) => {
      const result: Record<string, any> = {}
      
      for (const [key, selector] of Object.entries(selectors)) {
        const elements = document.querySelectorAll(selector)
        
        if (elements.length === 0) {
          result[key] = null
        } else if (elements.length === 1) {
          const el = elements[0] as HTMLElement
          result[key] = {
            text: el.innerText?.trim(),
            html: el.innerHTML,
            href: (el as HTMLAnchorElement).href,
            src: (el as HTMLImageElement).src,
          }
        } else {
          result[key] = Array.from(elements).map(el => ({
            text: (el as HTMLElement).innerText?.trim(),
            html: (el as HTMLElement).innerHTML,
            href: (el as HTMLAnchorElement).href,
            src: (el as HTMLImageElement).src,
          }))
        }
      }
      
      return result
    }, selectors)

    const title = await page.title()

    return {
      url,
      title: title || undefined,
      data,
      scrapedAt: new Date().toISOString(),
    }
  } finally {
    await browser.close()
  }
}

// Register action
actionRegistry.register(webScrapeAction)
