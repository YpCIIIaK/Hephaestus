/**
 * Telegram Bot Webhook Handler
 * 
 * Поддерживает:
 * - Текстовые сообщения
 * - Фотографии
 * - Файлы (документы)
 * - Голосовые сообщения
 * - Команды (/start, /help, /status, /pipeline)
 * 
 * Отправляет сообщения через AI pipeline и возвращает ответ
 */

import { addUser, addMessage } from '@/lib/telegram-store'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

// Хранилище сессий (в памяти, для production использовать Redis/DB)
interface TelegramSession {
  chatId: number
  userId: number
  username?: string
  firstName?: string
  lastActivity: number
  pipelineMode: boolean
  currentPipelineId?: string
  messageHistory: Array<{ role: 'user' | 'assistant', content: string, timestamp: number }>
}

const sessions = new Map<number, TelegramSession>()

// Rate limiting: track last message time per user
const rateLimits = new Map<number, number>()
const RATE_LIMIT_MS = 1000 // 1 second between messages

// Session timeout: 30 minutes
const SESSION_TIMEOUT = 30 * 60 * 1000

// Check rate limit for user
function checkRateLimit(userId: number): boolean {
  const now = Date.now()
  const lastMessage = rateLimits.get(userId)
  
  if (lastMessage && now - lastMessage < RATE_LIMIT_MS) {
    return false // Rate limited
  }
  
  rateLimits.set(userId, now)
  return true
}

// Clean up old rate limit entries
setInterval(() => {
  const now = Date.now()
  for (const [userId, timestamp] of rateLimits.entries()) {
    if (now - timestamp > 60 * 1000) { // Clean entries older than 1 minute
      rateLimits.delete(userId)
    }
  }
}, 30 * 1000)

function getSession(userId: number): TelegramSession {
  const existing = sessions.get(userId)
  if (existing && Date.now() - existing.lastActivity < SESSION_TIMEOUT) {
    existing.lastActivity = Date.now()
    return existing
  }

  const newSession: TelegramSession = {
    chatId: 0,
    userId,
    lastActivity: Date.now(),
    pipelineMode: false,
    messageHistory: [],
  }

  sessions.set(userId, newSession)
  return newSession
}

// Очистка старых сессий
setInterval(() => {
  const now = Date.now()
  for (const [userId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(userId)
    }
  }
}, 60 * 1000)

// ==================== TELEGRAM API HELPERS ====================

async function sendTelegramMessage(chatId: number, text: string, options: any = {}) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    ...options,
  }

  const res = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.text()
    console.error('[Telegram] Send message error:', error)
  }

  return res.json()
}

async function sendTelegramPhoto(chatId: number, photo: string | Buffer, caption?: string) {
  const formData = new FormData()
  formData.append('chat_id', String(chatId))

  if (typeof photo === 'string') {
    // URL или file_id
    formData.append('photo', photo)
  } else {
    // Buffer
    formData.append('photo', new Blob([Buffer.from(photo)]), 'image.jpg')
  }

  if (caption) {
    formData.append('caption', caption)
  }

  const res = await fetch(`${TELEGRAM_API_URL}/sendPhoto`, {
    method: 'POST',
    body: formData,
  })

  return res.json()
}

async function sendTelegramDocument(chatId: number, document: Buffer, filename: string, caption?: string) {
  const formData = new FormData()
  formData.append('chat_id', String(chatId))
    formData.append('document', new Blob([Buffer.from(document)]), filename)

  if (caption) {
    formData.append('caption', caption)
  }

  const res = await fetch(`${TELEGRAM_API_URL}/sendDocument`, {
    method: 'POST',
    body: formData,
  })

  return res.json()
}

async function sendTelegramAction(chatId: number, action: string) {
  // typing, upload_photo, upload_document, etc.
  fetch(`${TELEGRAM_API_URL}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {})
}

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  // Get file path
  const fileRes = await fetch(`${TELEGRAM_API_URL}/getFile?file_id=${fileId}`)
  const fileData = await fileRes.json()

  if (!fileData.ok) {
    throw new Error(`Failed to get file: ${JSON.stringify(fileData)}`)
  }

  const filePath = fileData.result.file_path
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`

  const res = await fetch(fileUrl)
  const buffer = Buffer.from(await res.arrayBuffer())

  return buffer
}

// ==================== AI PROCESSING ====================

async function processWithAI(message: string, session: TelegramSession): Promise<{ text: string, tokens?: number, cost?: number }> {
  // Добавить в историю
  session.messageHistory.push({
    role: 'user',
    content: message,
    timestamp: Date.now(),
  })

  // Ограничить историю последними 10 сообщениями
  if (session.messageHistory.length > 20) {
    session.messageHistory = session.messageHistory.slice(-20)
  }

  try {
    // Использовать localhost для внутренних вызовов API
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? process.env.NEXT_PUBLIC_APP_URL 
      : 'http://localhost:3000'
    
    console.log('[AI] Calling chat API at:', `${baseUrl}/api/chat`)
    
    const chatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant in Telegram. Be concise and clear.' },
          ...session.messageHistory.slice(-10).map(m => ({ role: m.role, content: m.content }))
        ],
        modelId: 'google/gemma-2-2b-it:free',
        temperature: 0.7,
        maxTokens: 2000,
      }),
    })

    if (!chatRes.ok) {
      throw new Error(`Chat API error: ${chatRes.status}`)
    }

    // Read streaming response
    const reader = chatRes.body?.getReader()
    if (!reader) throw new Error('No reader')

    const decoder = new TextDecoder()
    let fullText = ''
    let tokens = 0
    let cost = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      fullText += chunk
      
      // Try to extract usage info from [USAGE:...] marker
      const usageMatch = chunk.match(/\[USAGE:\{.*?\}\]/)
      if (usageMatch) {
        try {
          const usage = JSON.parse(usageMatch[0].replace('[USAGE:', '').replace(']', ''))
          tokens = usage.total_tokens || usage.completion_tokens || 0
          cost = usage.cost || 0
        } catch {}
      }
    }

    // Clean up usage markers from text
    fullText = fullText.replace(/\[USAGE:\{.*?\}\]/g, '').trim()

    // Estimate tokens if not provided
    if (!tokens) {
      tokens = Math.ceil(fullText.length / 4)
      cost = (tokens / 1000) * 0.00025 // Approximate cost for free model
    }

    // Добавить ответ в историю
    session.messageHistory.push({
      role: 'assistant',
      content: fullText,
      timestamp: Date.now(),
    })

    return { text: fullText, tokens, cost }
  } catch (error: any) {
    console.error('[AI] Processing error:', error)
    return { text: `⚠️ Error: ${error.message}`, tokens: 0, cost: 0 }
  }
}

// ==================== PIPELINE PROCESSING ====================

async function processWithPipeline(message: string, session: TelegramSession): Promise<{ text: string, tokens?: number, cost?: number }> {
  if (!session.currentPipelineId) {
    return { text: '⚠️ Pipeline not set. Use /pipeline to configure.', tokens: 0, cost: 0 }
  }

  // Здесь можно интегрировать interactive-executor
  // Для простоты используем chat API
  return processWithAI(message, session)
}

// ==================== COMMAND HANDLERS ====================

async function handleStart(chatId: number, userId: number, firstName?: string) {
  const session = getSession(userId)
  session.chatId = chatId
  session.firstName = firstName

  const welcomeText = `
👋 *Welcome, ${firstName || 'User'}!*

I'm your AI assistant powered by Hephaestus Arena.

📋 *Commands:*
/start - Start over
/help - Show help
/status - Show session info
/pipeline - Enable pipeline mode
/chat - Enable chat mode
/clear - Clear history

📎 *I can process:*
• Text messages
• Photos (with analysis)
• Documents (files)
• Voice messages

Just send me anything! 🚀
`.trim()

  await sendTelegramMessage(chatId, welcomeText)
}

async function handleHelp(chatId: number) {
  const helpText = `
📖 *Help Guide*

*Chat Mode* (default):
Just send messages and I'll respond like a chatbot.

*Pipeline Mode*:
Use /pipeline to enable. Your messages will be processed through the configured Arena pipeline.

*Supported Content:*
• 📝 Text - AI analysis
• 🖼️ Photos - Description + analysis
• 📄 Documents - Content extraction
• 🎤 Voice - Transcription (if supported)

*Commands:*
/start - Welcome message
/status - Session info
/clear - Clear chat history
/pipeline - Toggle pipeline mode
`.trim()

  await sendTelegramMessage(chatId, helpText)
}

async function handleStatus(chatId: number, session: TelegramSession) {
  const statusText = `
📊 *Session Status*

User ID: \`${session.userId}\`
Mode: ${session.pipelineMode ? '🔧 Pipeline' : '💬 Chat'}
Messages: ${session.messageHistory.length}
Last Activity: ${new Date(session.lastActivity).toLocaleString()}
Pipeline: ${session.currentPipelineId || 'Not set'}
`.trim()

  await sendTelegramMessage(chatId, statusText)
}

async function handleClear(chatId: number, session: TelegramSession) {
  session.messageHistory = []
  await sendTelegramMessage(chatId, '🗑️ Chat history cleared.')
}

async function handlePipelineToggle(chatId: number, session: TelegramSession) {
  // Show current status and instructions
  const statusText = `
🔧 *Pipeline Settings*

Current: ${session.pipelineMode ? '✅ Enabled' : '❌ Disabled'}
Pipeline ID: \`${session.currentPipelineId || 'Not set'}\`

📋 *Commands:*
/pipeline - Toggle pipeline mode
/setpipeline <id> - Set pipeline ID (e.g., /setpipeline my-pipeline)

💡 *To enable pipeline mode:*
1\. Set a pipeline ID: \`/setpipeline my-pipeline\`
2\. Toggle mode: \`/pipeline\`
`.trim()
  
  await sendTelegramMessage(chatId, statusText)
}

async function handleSetPipeline(chatId: number, session: TelegramSession, pipelineId: string) {
  if (!pipelineId) {
    await sendTelegramMessage(chatId, '❌ Usage: /setpipeline <pipeline-id>\n\nExample: /setpipeline my-pipeline')
    return
  }
  
  session.currentPipelineId = pipelineId
  session.pipelineMode = true
  await sendTelegramMessage(chatId, `✅ Pipeline set to: \`${pipelineId}\`\nPipeline mode enabled.`)
}

async function handleListPipelines(chatId: number) {
  try {
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? process.env.NEXT_PUBLIC_APP_URL 
      : 'http://localhost:3000'
    
    const res = await fetch(`${baseUrl}/api/configs`)
    const data = await res.json()
    
    if (!data.configs || data.configs.length === 0) {
      await sendTelegramMessage(chatId, '📋 No pipelines found.\n\nCreate pipelines on the website in Arena section first.')
      return
    }
    
    let text = '📋 *Available Pipelines*\n\n'
    for (const config of data.configs) {
      text += `🔹 *${config.name}*\n   ID: \`${config.id}\`\n   Desc: ${config.description || 'N/A'}\n   Nodes: ${config.nodeCount}\n\n`
    }
    text += '💡 Use /setpipeline <id> to select'
    
    await sendTelegramMessage(chatId, text)
  } catch (error: any) {
    await sendTelegramMessage(chatId, `❌ Error fetching pipelines: ${error.message}`)
  }
}

// ==================== MESSAGE HANDLERS ====================

async function handleTextMessage(chatId: number, userId: number, text: string) {
  const session = getSession(userId)
  session.chatId = chatId

  // Check if it's a command
  if (text.startsWith('/')) {
    const [command, ...args] = text.split(' ')
    switch (command.toLowerCase()) {
      case '/start':
        return handleStart(chatId, userId, session.firstName)
      case '/help':
        return handleHelp(chatId)
      case '/status':
        return handleStatus(chatId, session)
      case '/clear':
        return handleClear(chatId, session)
      case '/pipeline':
        return handlePipelineToggle(chatId, session)
      case '/setpipeline':
        return handleSetPipeline(chatId, session, args.join(' ').trim())
      case '/pipelines':
        return handleListPipelines(chatId)
      default:
        return sendTelegramMessage(chatId, `❓ Unknown command: ${command}\nUse /help for available commands.`)
    }
  }

  // Process with AI
  sendTelegramAction(chatId, 'typing')

  const result = session.pipelineMode
    ? await processWithPipeline(text, session)
    : await processWithAI(text, session)

  const response = typeof result === 'string' ? result : result.text
  const tokens = typeof result === 'object' ? (result.tokens || 0) : 0
  const cost = typeof result === 'object' ? (result.cost || 0) : 0

  // Update message with token/cost info
  await addMessage({
    userId,
    type: text.startsWith('/') ? 'command' : 'text',
    timestamp: new Date().toISOString(),
    tokens,
    cost,
    status: 'success',
  })

  // Split long messages (Telegram limit: 4096 chars)
  const chunks = splitMessage(response, 4000)
  for (const chunk of chunks) {
    await sendTelegramMessage(chatId, chunk)
  }
}

async function handlePhotoMessage(chatId: number, userId: number, photo: any, caption?: string) {
  const session = getSession(userId)
  session.chatId = chatId

  // Get the largest photo
  const largestPhoto = photo[photo.length - 1]
  const fileId = largestPhoto.file_id

  sendTelegramAction(chatId, 'typing')

  // Download and analyze photo
  try {
    const buffer = await downloadTelegramFile(fileId)

    // Convert to base64 for AI analysis
    const base64 = buffer.toString('base64')

    // Send to AI for analysis
    const prompt = caption
      ? `Analyze this image. User caption: "${caption}"`
      : 'Describe and analyze this image in detail.'

    const baseUrl = process.env.NODE_ENV === 'production' 
      ? process.env.NEXT_PUBLIC_APP_URL 
      : 'http://localhost:3000'

    const chatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an image analysis assistant. Describe what you see in detail.' },
          { role: 'user', content: prompt }
        ],
        modelId: 'google/gemma-2-2b-it:free',
        temperature: 0.5,
        maxTokens: 1500,
      }),
    })

    const reader = chatRes.body?.getReader()
    if (!reader) throw new Error('No reader')

    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }

    session.messageHistory.push({
      role: 'user',
      content: `[Photo${caption ? ': ' + caption : ''}]`,
      timestamp: Date.now(),
    })

    session.messageHistory.push({
      role: 'assistant',
      content: fullText,
      timestamp: Date.now(),
    })

    // Send response
    const chunks = splitMessage(fullText, 4000)
    for (const chunk of chunks) {
      await sendTelegramMessage(chatId, chunk)
    }
  } catch (error: any) {
    await sendTelegramMessage(chatId, `⚠️ Error analyzing photo: ${error.message}`)
  }
}

async function handleDocumentMessage(chatId: number, userId: number, document: any, caption?: string) {
  const session = getSession(userId)
  session.chatId = chatId

  const fileId = document.file_id
  const fileName = document.file_name || 'document'

  sendTelegramAction(chatId, 'upload_document')

  try {
    const buffer = await downloadTelegramFile(fileId)
    const content = buffer.toString('utf-8')

    // Truncate if too large
    const truncatedContent = content.slice(0, 10000)

    const prompt = caption
      ? `Analyze this document "${fileName}". User note: "${caption}"\n\nContent:\n${truncatedContent}`
      : `Analyze this document "${fileName}":\n\n${truncatedContent}`

    const result = await processWithAI(prompt, session)
    const response = typeof result === 'string' ? result : result.text

    const chunks = splitMessage(response, 4000)
    for (const chunk of chunks) {
      await sendTelegramMessage(chatId, chunk)
    }
  } catch (error: any) {
    await sendTelegramMessage(chatId, `⚠️ Error processing document: ${error.message}`)
  }
}

async function handleVoiceMessage(chatId: number, userId: number, voice: any) {
  const session = getSession(userId)
  session.chatId = chatId

  sendTelegramAction(chatId, 'typing')

  // Note: Voice transcription requires Whisper or similar
  // For now, send a placeholder response
  await sendTelegramMessage(chatId, '🎤 Voice messages received! Transcription will be available soon.')
}

// ==================== UTILITIES ====================

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Find last newline or space before maxLength
    let splitIndex = remaining.lastIndexOf('\n', maxLength)
    if (splitIndex === -1) {
      splitIndex = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitIndex === -1) {
      splitIndex = maxLength
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trim()
  }

  return chunks
}

// ==================== WEBHOOK HANDLER ====================

export async function POST(req: Request) {
  console.log('[Telegram Webhook] Incoming request')
  
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram Webhook] TELEGRAM_BOT_TOKEN not set')
    return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Validate webhook secret if configured
  if (TELEGRAM_WEBHOOK_SECRET) {
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
      console.warn('[Telegram Webhook] Invalid secret token')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  try {
    const body = await req.text()
    console.log('[Telegram Webhook] Raw body:', body)
    
    const update = JSON.parse(body)
    console.log('[Telegram Webhook] Parsed update:', JSON.stringify(update, null, 2))

    // Handle message
    if (update.message) {
      const chatId = update.message.chat.id
      const userId = update.message.from.id
      const firstName = update.message.from.first_name
      const username = update.message.from.username

      // Add/update user in store
      await addUser({ id: userId, firstName, username })

      // Check rate limit
      if (!checkRateLimit(userId)) {
        console.log('[Telegram Webhook] Rate limited user:', userId)
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Initialize session
      const session = getSession(userId)
      session.chatId = chatId
      session.firstName = firstName

      // Text message
      if (update.message.text) {
        console.log('[Telegram Webhook] Text message from', userId, ':', update.message.text)
        
        const isCommand = update.message.text.startsWith('/')
        const msgType = isCommand ? 'command' : 'text'
        
        // Track message start
        const startTime = Date.now()
        await addMessage({
          userId,
          type: msgType,
          timestamp: new Date().toISOString(),
          status: 'pending',
        })
        
        await handleTextMessage(chatId, userId, update.message.text)
        
        // Track message success
        await addMessage({
          userId,
          type: msgType,
          timestamp: new Date().toISOString(),
          responseTime: Date.now() - startTime,
          status: 'success',
        })
        
        console.log('[Telegram Webhook] Text message handled')
      }

      // Photo
      if (update.message.photo) {
        const startTime = Date.now()
        await addMessage({
          userId,
          type: 'photo',
          timestamp: new Date().toISOString(),
          status: 'pending',
        })
        await handlePhotoMessage(chatId, userId, update.message.photo, update.message.caption)
        await addMessage({
          userId,
          type: 'photo',
          timestamp: new Date().toISOString(),
          responseTime: Date.now() - startTime,
          status: 'success',
        })
      }

      // Document
      if (update.message.document) {
        const startTime = Date.now()
        await addMessage({
          userId,
          type: 'document',
          timestamp: new Date().toISOString(),
          status: 'pending',
        })
        await handleDocumentMessage(chatId, userId, update.message.document, update.message.caption)
        await addMessage({
          userId,
          type: 'document',
          timestamp: new Date().toISOString(),
          responseTime: Date.now() - startTime,
          status: 'success',
        })
      }

      // Voice
      if (update.message.voice) {
        const startTime = Date.now()
        await addMessage({
          userId,
          type: 'voice',
          timestamp: new Date().toISOString(),
          status: 'pending',
        })
        await handleVoiceMessage(chatId, userId, update.message.voice)
        await addMessage({
          userId,
          type: 'voice',
          timestamp: new Date().toISOString(),
          responseTime: Date.now() - startTime,
          status: 'success',
        })
      }
    }

    // Handle callback queries (inline buttons)
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id
      const data = update.callback_query.data

      // Handle button callbacks
      await sendTelegramMessage(chatId, `Button pressed: ${data}`)

      // Acknowledge callback
      await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: update.callback_query.id }),
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[Telegram Webhook] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// GET endpoint for webhook verification and testing

// GET endpoint for webhook verification
export async function GET(req: Request) {
  return new Response(JSON.stringify({ status: 'ok', webhook: 'active' }), {
    headers: { 'Content-Type': 'application/json' },
  })
}