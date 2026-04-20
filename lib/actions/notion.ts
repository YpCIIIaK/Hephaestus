// Notion action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface NotionPageInputs {
  parentPageId?: string
  databaseId?: string
  title: string
  content?: string
  icon?: string
  properties?: Record<string, any>
}

interface NotionDatabaseInputs {
  databaseId: string
  properties: Record<string, any>
  children?: any[]
}

export const createNotionPageAction: Action = {
  id: 'create-notion-page',
  name: 'Create Notion Page',
  description: 'Создать страницу в Notion с контентом',
  category: 'productivity',
  icon: 'file-text',
  inputs: [
    { name: 'parentPageId', type: 'string', required: false, description: 'ID родительской страницы (необходим parentPageId ИЛИ databaseId)' },
    { name: 'databaseId', type: 'string', required: false, description: 'ID базы данных для создания записи' },
    { name: 'title', type: 'string', required: true, description: 'Заголовок страницы' },
    { name: 'content', type: 'textarea', required: false, description: 'Markdown контент (будет конвертирован в Notion blocks)' },
    { name: 'icon', type: 'string', required: false, description: 'Emoji иконка (например, 📄)' },
    { name: 'properties', type: 'json', required: false, description: 'JSON свойства для базы данных' },
  ],
  outputs: [
    { name: 'pageId', type: 'string', description: 'ID созданной страницы' },
    { name: 'url', type: 'string', description: 'URL страницы' },
  ],
  config: { 
    requiresAuth: true, 
    authType: 'api_key',
    retryCount: 3,
    timeoutMs: 30000 
  },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { parentPageId, databaseId, title, content, icon, properties } = inputs as NotionPageInputs

      if (!title) {
        return {
          success: false,
          error: 'Missing required field: title',
          metadata: { duration: Date.now() - startTime }
        }
      }

      if (!parentPageId && !databaseId) {
        return {
          success: false,
          error: 'Either parentPageId or databaseId is required',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const apiToken = context.credentials?.notionApiToken || process.env.NOTION_API_TOKEN
      
      if (!apiToken) {
        return {
          success: false,
          error: 'Notion API token not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Convert markdown content to Notion blocks
      const blocks = content ? markdownToNotionBlocks(content) : []

      const payload: any = {
        icon: icon ? { type: 'emoji', emoji: icon } : undefined,
        properties: {
          title: {
            title: [{ text: { content: title } }]
          },
          ...properties
        },
        children: blocks.length > 0 ? blocks : undefined,
      }

      // Remove undefined values
      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) delete payload[key]
      })

      let url: string
      let body: any

      if (databaseId) {
        url = 'https://api.notion.com/v1/pages'
        body = {
          parent: { database_id: databaseId },
          ...payload
        }
      } else {
        url = 'https://api.notion.com/v1/pages'
        body = {
          parent: { page_id: parentPageId },
          ...payload
        }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      })

      const data = await res.json()
      
      if (!res.ok) {
        return {
          success: false,
          error: `Notion API error: ${data.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          pageId: data.id,
          url: data.url,
          createdTime: data.created_time,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create Notion page',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Helper to convert markdown to Notion blocks
function markdownToNotionBlocks(markdown: string): any[] {
  const blocks: any[] = []
  const lines = markdown.split('\n')
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    if (!trimmed) {
      continue
    }
    
    // Heading
    if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ text: { content: trimmed.slice(2) } }]
        }
      })
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ text: { content: trimmed.slice(3) } }]
        }
      })
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ text: { content: trimmed.slice(4) } }]
        }
      })
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // Bullet list
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ text: { content: trimmed.slice(2) } }]
        }
      })
    } else if (/^\d+\.\s/.test(trimmed)) {
      // Numbered list
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ text: { content: trimmed.replace(/^\d+\.\s/, '') } }]
        }
      })
    } else if (trimmed.startsWith('> ')) {
      // Quote
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: [{ text: { content: trimmed.slice(2) } }]
        }
      })
    } else if (trimmed.startsWith('```')) {
      // Code block (simplified)
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ text: { content: trimmed.replace(/```/g, '') } }],
          language: 'plain text'
        }
      })
    } else {
      // Paragraph
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: trimmed } }]
        }
      })
    }
  }
  
  return blocks
}

// Query Notion database action
export const queryNotionDatabaseAction: Action = {
  id: 'query-notion-database',
  name: 'Query Notion Database',
  description: 'Поиск записей в базе данных Notion',
  category: 'productivity',
  icon: 'search',
  inputs: [
    { name: 'databaseId', type: 'string', required: true, description: 'ID базы данных' },
    { name: 'filter', type: 'json', required: false, description: 'Notion filter JSON' },
    { name: 'sorts', type: 'json', required: false, description: 'Notion sorts JSON' },
    { name: 'pageSize', type: 'number', required: false, description: 'Количество результатов', default: 100 },
  ],
  outputs: [
    { name: 'results', type: 'array', description: 'Результаты запроса' },
    { name: 'hasMore', type: 'boolean', description: 'Есть еще результаты' },
  ],
  config: { requiresAuth: true, authType: 'api_key', timeoutMs: 15000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { databaseId, filter, sorts, pageSize = 100 } = inputs
      
      const apiToken = context.credentials?.notionApiToken || process.env.NOTION_API_TOKEN
      
      if (!apiToken) {
        return {
          success: false,
          error: 'Notion API token not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const body: any = { page_size: pageSize }
      if (filter) body.filter = typeof filter === 'string' ? JSON.parse(filter) : filter
      if (sorts) body.sorts = typeof sorts === 'string' ? JSON.parse(sorts) : sorts

      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      })

      const data = await res.json()
      
      if (!res.ok) {
        return {
          success: false,
          error: `Notion API error: ${data.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          results: data.results,
          hasMore: data.has_more,
          nextCursor: data.next_cursor,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to query database',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Register actions
actionRegistry.register(createNotionPageAction)
actionRegistry.register(queryNotionDatabaseAction)
