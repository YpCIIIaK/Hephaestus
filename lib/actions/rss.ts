// RSS Feed action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface RssFetchInputs {
  url: string
  limit?: number
  filterKeywords?: string[]
  since?: string // ISO date
}

interface RssFeedInputs {
  title: string
  description: string
  items: Array<{
    title: string
    link: string
    pubDate?: string
    content?: string
    categories?: string[]
  }>
  outputPath?: string
}

export const fetchRssAction: Action = {
  id: 'fetch-rss',
  name: 'Fetch RSS Feed',
  description: 'Получить новости из RSS/Atom ленты с фильтрацией',
  category: 'data',
  icon: 'rss',
  inputs: [
    { name: 'url', type: 'string', required: true, description: 'URL RSS ленты (Atom/RSS 1.0/2.0)' },
    { name: 'limit', type: 'number', required: false, description: 'Максимум записей', default: 20 },
    { name: 'filterKeywords', type: 'json', required: false, description: 'JSON массив ключевых слов для фильтрации' },
    { name: 'since', type: 'string', required: false, description: 'Дата "от" (ISO 8601) - только записи после' },
  ],
  outputs: [
    { name: 'title', type: 'string', description: 'Название ленты' },
    { name: 'description', type: 'string', description: 'Описание ленты' },
    { name: 'items', type: 'array', description: 'Записи ленты' },
    { name: 'itemCount', type: 'number', description: 'Количество записей' },
  ],
  config: { 
    requiresAuth: false,
    retryCount: 3,
    timeoutMs: 30000 
  },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { 
        url, 
        limit = 20, 
        filterKeywords,
        since 
      } = inputs as RssFetchInputs

      if (!url) {
        return {
          success: false,
          error: 'Missing required field: url',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Server-side: use rss-parser
      if (typeof window === 'undefined') {
        const Parser = (await import('rss-parser')).default
        const parser = new Parser({
          timeout: 20000,
          headers: {
            'User-Agent': 'Hephaestus RSS Reader/1.0'
          }
        })

        const feed = await parser.parseURL(url)
        
        let items = feed.items || []
        
        // Apply date filter
        if (since) {
          const sinceDate = new Date(since)
          items = items.filter(item => {
            const itemDate = item.pubDate ? new Date(item.pubDate) : null
            return itemDate && itemDate >= sinceDate
          })
        }
        
        // Apply keyword filter
        if (filterKeywords && filterKeywords.length > 0) {
          const keywords = filterKeywords.map(k => k.toLowerCase())
          items = items.filter(item => {
            const text = `${item.title || ''} ${item.content || ''} ${item.categories?.join(' ') || ''}`.toLowerCase()
            return keywords.some(keyword => text.includes(keyword))
          })
        }
        
        // Limit results
        items = items.slice(0, limit)
        
        // Format items
        const formattedItems = items.map(item => ({
          title: item.title || 'Untitled',
          link: item.link || item.guid,
          pubDate: item.pubDate || item.isoDate,
          content: item['content:encoded'] || item.content || item.summary,
          categories: item.categories || [],
          author: item.author || item.creator,
          guid: item.guid || item.id,
        }))

        return {
          success: true,
          data: {
            title: feed.title || 'Untitled Feed',
            description: feed.description || '',
            link: feed.link,
            lastBuildDate: feed.lastBuildDate,
            items: formattedItems,
            itemCount: formattedItems.length,
            sourceUrl: url,
          },
          metadata: { duration: Date.now() - startTime }
        }
      } else {
        // Client-side: use API proxy
        const res = await fetch('/api/actions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: 'fetch-rss',
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
        error: error.message || 'Failed to fetch RSS feed',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Create RSS feed from content
export const createRssFeedAction: Action = {
  id: 'create-rss-feed',
  name: 'Create RSS Feed',
  description: 'Создать RSS ленту из данных и сохранить в файл',
  category: 'data',
  icon: 'file-output',
  inputs: [
    { name: 'title', type: 'string', required: true, description: 'Название ленты' },
    { name: 'description', type: 'string', required: true, description: 'Описание ленты' },
    { name: 'items', type: 'json', required: true, description: 'JSON массив записей {title, link, pubDate, content, categories?}' },
    { name: 'outputPath', type: 'string', required: false, description: 'Путь для сохранения (например, ./public/feeds/news.xml)' },
    { name: 'siteUrl', type: 'string', required: false, description: 'URL сайта' },
  ],
  outputs: [
    { name: 'feedUrl', type: 'string', description: 'URL созданной ленты' },
    { name: 'itemCount', type: 'number', description: 'Количество записей' },
  ],
  config: { requiresAuth: false, timeoutMs: 10000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { title, description, items, outputPath, siteUrl = 'https://example.com' } = inputs as RssFeedInputs

      if (!title || !description || !items) {
        return {
          success: false,
          error: 'Missing required fields: title, description, items',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Server-side only
      if (typeof window === 'undefined') {
        const fs = await import('fs/promises')
        const path = await import('path')

        // Build RSS XML
        const now = new Date().toUTCString()
        const feedUrl = `${siteUrl}/feeds/${path.basename(outputPath || 'feed.xml')}`
        
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${siteUrl}</link>
    <description>${escapeXml(description)}</description>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
`

        for (const item of items.slice(0, 50)) {
          const pubDate = item.pubDate ? new Date(item.pubDate).toUTCString() : now
          xml += `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${item.link}</link>
      <pubDate>${pubDate}</pubDate>
      ${item.categories?.map(c => `<category>${escapeXml(c)}</category>`).join('\n      ') || ''}
      <description><![CDATA[${item.content || ''}]]></description>
      <guid isPermaLink="true">${item.link}</guid>
    </item>
`
        }

        xml += `  </channel>
</rss>`

        // Save to file if path provided
        if (outputPath) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true })
          await fs.writeFile(outputPath, xml, 'utf-8')
        }

        return {
          success: true,
          data: {
            feedUrl: outputPath ? `${siteUrl}/${outputPath.replace(/^\.\/public\//, '')}` : null,
            itemCount: items.length,
            xml: outputPath ? undefined : xml,
          },
          metadata: { duration: Date.now() - startTime }
        }
      } else {
        // Client-side: use API
        const res = await fetch('/api/actions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: 'create-rss-feed',
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
        error: error.message || 'Failed to create RSS feed',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Register actions
actionRegistry.register(fetchRssAction)
actionRegistry.register(createRssFeedAction)
