// Slack action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface SlackInputs {
  channel: string
  text: string
  blocks?: any[] // Slack Block Kit blocks
  attachments?: any[]
  threadTs?: string // For replying in thread
  unfurlLinks?: boolean
}

export const sendSlackAction: Action = {
  id: 'send-slack',
  name: 'Send Slack Message',
  description: 'Отправить сообщение в Slack канал',
  category: 'communication',
  icon: 'hash',
  inputs: [
    { name: 'channel', type: 'string', required: true, description: 'Канал (#general) или user ID (@U123456)' },
    { name: 'text', type: 'textarea', required: true, description: 'Текст сообщения (поддерживает mrkdwn)' },
    { name: 'blocks', type: 'json', required: false, description: 'Block Kit JSON blocks' },
    { name: 'threadTs', type: 'string', required: false, description: 'Thread timestamp для ответа в тред' },
    { name: 'unfurlLinks', type: 'boolean', required: false, description: 'Развернуть ссылки', default: true },
  ],
  outputs: [
    { name: 'ts', type: 'string', description: 'Message timestamp ID' },
    { name: 'channel', type: 'string', description: 'Channel ID' },
    { name: 'permalink', type: 'string', description: 'Permanent link to message' },
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
        channel, 
        text, 
        blocks, 
        threadTs, 
        unfurlLinks = true 
      } = inputs as SlackInputs

      if (!channel || !text) {
        return {
          success: false,
          error: 'Missing required fields: channel, text',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const botToken = context.credentials?.slackBotToken || process.env.SLACK_BOT_TOKEN
      
      if (!botToken) {
        return {
          success: false,
          error: 'Slack bot token not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Normalize channel format
      const normalizedChannel = channel.startsWith('#') || channel.startsWith('@') 
        ? channel 
        : `#${channel}`

      const payload: any = {
        channel: normalizedChannel,
        text,
        unfurl_links: unfurlLinks,
        unfurl_media: unfurlLinks,
      }

      if (blocks) {
        payload.blocks = typeof blocks === 'string' ? JSON.parse(blocks) : blocks
      }

      if (threadTs) {
        payload.thread_ts = threadTs
      }

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`,
        },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      
      if (!data.ok) {
        return {
          success: false,
          error: `Slack API error: ${data.error}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          ts: data.ts,
          channel: data.channel,
          permalink: data.permalink,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to send Slack message',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Slack file upload action
export const uploadSlackFileAction: Action = {
  id: 'upload-slack-file',
  name: 'Upload Slack File',
  description: 'Загрузить файл в Slack',
  category: 'communication',
  icon: 'file-up',
  inputs: [
    { name: 'channels', type: 'string', required: true, description: 'Каналы через запятую (#general,#random)' },
    { name: 'content', type: 'string', required: true, description: 'Содержимое файла (base64 или текст)' },
    { name: 'filename', type: 'string', required: true, description: 'Имя файла' },
    { name: 'title', type: 'string', required: false, description: 'Заголовок файла' },
    { name: 'initialComment', type: 'string', required: false, description: 'Комментарий к файлу' },
    { name: 'filetype', type: 'string', required: false, description: 'Тип файла (auto, text, csv, etc)' },
  ],
  outputs: [
    { name: 'fileId', type: 'string', description: 'File ID' },
    { name: 'permalink', type: 'string', description: 'Permanent link' },
  ],
  config: { requiresAuth: true, authType: 'api_key', timeoutMs: 60000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { channels, content, filename, title, initialComment, filetype = 'auto' } = inputs
      
      const botToken = context.credentials?.slackBotToken || process.env.SLACK_BOT_TOKEN
      
      if (!botToken) {
        return {
          success: false,
          error: 'Slack bot token not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // For files, we need to use multipart/form-data
      // This is a simplified version - in production, use proper form-data
      const formData = new FormData()
      formData.append('channels', channels)
      formData.append('filename', filename)
      formData.append('content', content)
      if (title) formData.append('title', title)
      if (initialComment) formData.append('initial_comment', initialComment)
      if (filetype !== 'auto') formData.append('filetype', filetype)

      const res = await fetch('https://slack.com/api/files.upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
        },
        body: formData
      })

      const data = await res.json()
      
      if (!data.ok) {
        return {
          success: false,
          error: `Slack API error: ${data.error}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          fileId: data.file?.id,
          permalink: data.file?.permalink,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to upload file',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Register actions
actionRegistry.register(sendSlackAction)
actionRegistry.register(uploadSlackFileAction)
