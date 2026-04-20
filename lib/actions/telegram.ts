// Telegram action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface TelegramInputs {
  chatId: string
  message: string
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  disableNotification?: boolean
  replyToMessageId?: number
  buttons?: Array<{
    text: string
    url?: string
    callbackData?: string
  }>
}

export const sendTelegramAction: Action = {
  id: 'send-telegram',
  name: 'Send Telegram Message',
  description: 'Отправить сообщение в Telegram канал или пользователю',
  category: 'communication',
  icon: 'send',
  inputs: [
    { name: 'chatId', type: 'string', required: true, description: 'Chat ID (например, @channel или 123456789)' },
    { name: 'message', type: 'textarea', required: true, description: 'Текст сообщения' },
    { name: 'parseMode', type: 'select', required: false, description: 'Форматирование', default: 'HTML', options: ['HTML', 'Markdown', 'MarkdownV2'] },
    { name: 'disableNotification', type: 'boolean', required: false, description: 'Отправить без уведомления', default: false },
    { name: 'replyToMessageId', type: 'number', required: false, description: 'ID сообщения для ответа' },
  ],
  outputs: [
    { name: 'messageId', type: 'number', description: 'ID отправленного сообщения' },
    { name: 'chatId', type: 'string', description: 'ID чата' },
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
        chatId, 
        message, 
        parseMode = 'HTML', 
        disableNotification = false,
        replyToMessageId 
      } = inputs as TelegramInputs

      if (!chatId || !message) {
        return {
          success: false,
          error: 'Missing required fields: chatId, message',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Client-side: use API
      if (typeof window !== 'undefined') {
        // Try to get bot token from localStorage first (set by Telegram panel)
        const botToken = localStorage.getItem('telegram_bot_token') || context.credentials?.telegramBotToken
        
        if (!botToken) {
          // Fallback to API
          const res = await fetch('/api/actions/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionId: 'send-telegram',
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

        // Send via Telegram API directly
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: parseMode,
            disable_notification: disableNotification,
            reply_to_message_id: replyToMessageId,
          })
        })

        const data = await res.json()
        
        if (!data.ok) {
          return {
            success: false,
            error: `Telegram API error: ${data.description}`,
            metadata: { duration: Date.now() - startTime }
          }
        }

        return {
          success: true,
          data: {
            messageId: data.result.message_id,
            chatId: data.result.chat.id.toString(),
            date: data.result.date,
          },
          metadata: { duration: Date.now() - startTime }
        }
      } else {
        // Server-side: use node-telegram-bot-api or direct API
        const botToken = context.credentials?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN
        
        if (!botToken) {
          return {
            success: false,
            error: 'Telegram bot token not configured',
            metadata: { duration: Date.now() - startTime }
          }
        }

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: parseMode,
            disable_notification: disableNotification,
            reply_to_message_id: replyToMessageId,
          })
        })

        const data = await res.json()
        
        if (!data.ok) {
          return {
            success: false,
            error: `Telegram API error: ${data.description}`,
            metadata: { duration: Date.now() - startTime }
          }
        }

        return {
          success: true,
          data: {
            messageId: data.result.message_id,
            chatId: data.result.chat.id.toString(),
            date: data.result.date,
          },
          metadata: { duration: Date.now() - startTime }
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to send Telegram message',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Additional Telegram actions
export const sendTelegramPhotoAction: Action = {
  id: 'send-telegram-photo',
  name: 'Send Telegram Photo',
  description: 'Отправить фото в Telegram',
  category: 'communication',
  icon: 'image',
  inputs: [
    { name: 'chatId', type: 'string', required: true, description: 'Chat ID' },
    { name: 'photoUrl', type: 'string', required: true, description: 'URL фото или base64' },
    { name: 'caption', type: 'string', required: false, description: 'Подпись к фото' },
    { name: 'parseMode', type: 'select', required: false, description: 'Форматирование', default: 'HTML', options: ['HTML', 'Markdown', 'MarkdownV2'] },
  ],
  outputs: [
    { name: 'messageId', type: 'number', description: 'ID сообщения' },
  ],
  config: { requiresAuth: true, authType: 'api_key', timeoutMs: 30000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { chatId, photoUrl, caption, parseMode = 'HTML' } = inputs
      
      const botToken = context.credentials?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN
      
      if (!botToken) {
        return {
          success: false,
          error: 'Telegram bot token not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const url = `https://api.telegram.org/bot${botToken}/sendPhoto`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          caption,
          parse_mode: parseMode,
        })
      })

      const data = await res.json()
      
      if (!data.ok) {
        return {
          success: false,
          error: `Telegram API error: ${data.description}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: { messageId: data.result.message_id },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to send photo',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Register actions
actionRegistry.register(sendTelegramAction)
actionRegistry.register(sendTelegramPhotoAction)
