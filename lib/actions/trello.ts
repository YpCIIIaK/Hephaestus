// Trello action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface TrelloCardInputs {
  boardId?: string
  listId: string
  name: string
  description?: string
  labels?: string[] // Label colors or IDs
  dueDate?: string // ISO 8601
  members?: string[] // Member IDs
  position?: 'top' | 'bottom'
  coverColor?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'pink' | 'sky' | 'lime' | 'black'
  cover?: {
    color?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'pink' | 'sky' | 'lime' | 'black'
    url?: string // Cover image URL
  }
}

interface TrelloListInputs {
  boardId: string
  name: string
  position?: 'top' | 'bottom'
}

const TRELLO_API_BASE = 'https://api.trello.com/1'

function getTrelloAuth(context: ActionContext): { key?: string; token?: string } {
  return {
    key: context.credentials?.trelloApiKey || process.env.TRELLO_API_KEY,
    token: context.credentials?.trelloToken || process.env.TRELLO_TOKEN,
  }
}

export const createTrelloCardAction: Action = {
  id: 'create-trello-card',
  name: 'Create Trello Card',
  description: 'Создать карточку в Trello',
  category: 'productivity',
  icon: 'trello',
  inputs: [
    { name: 'listId', type: 'string', required: true, description: 'ID списка (колонки)' },
    { name: 'name', type: 'string', required: true, description: 'Название карточки' },
    { name: 'description', type: 'textarea', required: false, description: 'Описание (Markdown поддерживается)' },
    { name: 'labels', type: 'json', required: false, description: 'JSON массив цветов меток (red, green, yellow, etc)' },
    { name: 'dueDate', type: 'string', required: false, description: 'Срок (ISO 8601)' },
    { name: 'members', type: 'json', required: false, description: 'JSON массив ID членов команды' },
    { name: 'position', type: 'select', required: false, description: 'Позиция в списке', default: 'bottom', options: ['top', 'bottom'] },
    { name: 'coverColor', type: 'select', required: false, description: 'Цвет обложки', options: ['blue', 'green', 'orange', 'red', 'purple', 'pink', 'sky', 'lime', 'black'] },
  ],
  outputs: [
    { name: 'cardId', type: 'string', description: 'ID карточки' },
    { name: 'shortUrl', type: 'string', description: 'Короткая ссылка' },
    { name: 'url', type: 'string', description: 'Полная ссылка' },
  ],
  config: { 
    requiresAuth: true, 
    authType: 'api_key',
    retryCount: 3,
    timeoutMs: 15000 
  },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const {
        listId,
        name,
        description,
        labels,
        dueDate,
        members,
        position = 'bottom',
        coverColor,
      } = inputs as TrelloCardInputs

      if (!listId || !name) {
        return {
          success: false,
          error: 'Missing required fields: listId, name',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const { key, token } = getTrelloAuth(context)
      
      if (!key || !token) {
        return {
          success: false,
          error: 'Trello API credentials not configured. Set TRELLO_API_KEY and TRELLO_TOKEN.',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const params = new URLSearchParams({
        key,
        token,
        idList: listId,
        name,
        pos: position,
      })

      if (description) params.append('desc', description)
      if (dueDate) params.append('due', new Date(dueDate).toISOString())
      if (labels && labels.length > 0) {
        labels.forEach(label => params.append('idLabels', label))
      }
      if (members && members.length > 0) {
        members.forEach(member => params.append('idMembers', member))
      }

      const res = await fetch(`${TRELLO_API_BASE}/cards?${params}`, {
        method: 'POST',
      })

      const data = await res.json()
      
      if (!res.ok) {
        return {
          success: false,
          error: `Trello API error: ${data.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Set cover color if specified
      if (coverColor) {
        const coverParams = new URLSearchParams({ key, token, value: coverColor })
        await fetch(`${TRELLO_API_BASE}/cards/${data.id}/cover?${coverParams}`, {
          method: 'PUT',
        })
      }

      return {
        success: true,
        data: {
          cardId: data.id,
          shortUrl: data.shortUrl,
          url: data.url,
          idShort: data.idShort,
          boardId: data.idBoard,
          listId: data.idList,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create Trello card',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Get Trello boards
export const getTrelloBoardsAction: Action = {
  id: 'get-trello-boards',
  name: 'Get Trello Boards',
  description: 'Получить список досок Trello',
  category: 'productivity',
  icon: 'layout',
  inputs: [
    { name: 'organizationId', type: 'string', required: false, description: 'ID организации (опционально)' },
    { name: 'filter', type: 'select', required: false, description: 'Фильтр', default: 'open', options: ['all', 'open', 'closed', 'members'] },
  ],
  outputs: [
    { name: 'boards', type: 'array', description: 'Список досок' },
  ],
  config: { requiresAuth: true, authType: 'api_key', timeoutMs: 10000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { organizationId, filter = 'open' } = inputs
      
      const { key, token } = getTrelloAuth(context)
      
      if (!key || !token) {
        return {
          success: false,
          error: 'Trello API credentials not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const params = new URLSearchParams({
        key,
        token,
        filter,
      })

      let url = `${TRELLO_API_BASE}/members/me/boards?${params}`
      if (organizationId) {
        url = `${TRELLO_API_BASE}/organizations/${organizationId}/boards?${params}`
      }

      const res = await fetch(url)
      const data = await res.json()
      
      if (!res.ok) {
        return {
          success: false,
          error: `Trello API error: ${data.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          boards: data.map((board: any) => ({
            id: board.id,
            name: board.name,
            desc: board.desc,
            url: board.url,
            starred: board.starred,
            background: board.prefs?.backgroundColor || board.prefs?.backgroundImage,
          })),
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get boards',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Get board lists
export const getTrelloListsAction: Action = {
  id: 'get-trello-lists',
  name: 'Get Trello Lists',
  description: 'Получить списки (колонки) доски Trello',
  category: 'productivity',
  icon: 'list',
  inputs: [
    { name: 'boardId', type: 'string', required: true, description: 'ID доски' },
  ],
  outputs: [
    { name: 'lists', type: 'array', description: 'Список колонок' },
  ],
  config: { requiresAuth: true, authType: 'api_key', timeoutMs: 10000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { boardId } = inputs
      
      const { key, token } = getTrelloAuth(context)
      
      if (!key || !token) {
        return {
          success: false,
          error: 'Trello API credentials not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const params = new URLSearchParams({
        key,
        token,
        cards: 'none',
      })

      const res = await fetch(`${TRELLO_API_BASE}/boards/${boardId}/lists?${params}`)
      const data = await res.json()
      
      if (!res.ok) {
        return {
          success: false,
          error: `Trello API error: ${data.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          lists: data.map((list: any) => ({
            id: list.id,
            name: list.name,
            pos: list.pos,
            closed: list.closed,
          })),
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get lists',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Register actions
actionRegistry.register(createTrelloCardAction)
actionRegistry.register(getTrelloBoardsAction)
actionRegistry.register(getTrelloListsAction)
