import { ArenaChatConfig, ArenaChatMessage, DebateModel } from '@/lib/types'

// Ollama local configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

function isLocalModel(modelId: string): boolean {
  return modelId?.startsWith('ollama/') || modelId?.startsWith('local/')
}

function extractOllamaModel(modelId: string): string {
  return modelId?.replace(/^(ollama|local)\//, '')
}

async function callModel(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
  maxTokens?: number,
  signal?: AbortSignal
): Promise<string> {
  // LOCAL OLLAMA MODE
  if (isLocalModel(modelId)) {
    const ollamaModel = extractOllamaModel(modelId)
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: messages,
        stream: false,
        options: {
          temperature: temperature ?? 0.7,
          num_predict: maxTokens ?? 2048,
        }
      }),
      signal,
    })

    if (!ollamaRes.ok) {
      throw new Error(`Ollama error: ${ollamaRes.statusText}`)
    }

    const data = await ollamaRes.json()
    return data.message?.content || ''
  }

  // OPENROUTER MODE
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing')
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost:3000',
      'X-Title': 'AI Aggregator App',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 2048,
    }),
    signal,
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`OpenRouter error: ${res.status} ${errorText}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

function buildModelContext(
  allMessages: ArenaChatMessage[],
  currentModelId: string,
  visiblePerModel: number,
  mode: 'debate' | 'collaboration' | 'sequential'
): string {
  // Группируем сообщения по моделям
  const byModel = new Map<string, ArenaChatMessage[]>()
  const userMessages: ArenaChatMessage[] = []
  
  for (const msg of allMessages) {
    if (msg.role === 'user') {
      userMessages.push(msg)
    } else if (msg.modelId) {
      if (!byModel.has(msg.modelId)) {
        byModel.set(msg.modelId, [])
      }
      byModel.get(msg.modelId)!.push(msg)
    }
  }

  // Формируем контекст: последние N сообщений каждой модели
  let context = ''
  
  if (userMessages.length > 0) {
    const lastUser = userMessages[userMessages.length - 1]
    context += `**Начальная тема от пользователя:**\n${lastUser.content}\n\n`
  }

  context += '--- История обсуждения ---\n\n'

  // Показываем все сообщения в хронологическом порядке, но последние N каждой модели
  const recentMessages = allMessages.slice(-visiblePerModel * byModel.size)
  
  for (const msg of recentMessages) {
    if (msg.role === 'assistant' && msg.modelName) {
      const speakerTag = msg.modelId === currentModelId ? '(ВЫ)' : `(другая модель)`
      context += `[${msg.modelName}] ${speakerTag}: ${msg.content}\n\n`
    }
  }

  if (mode === 'debate') {
    context += '--- КОНТЕКСТ ДЕБатов ---\n'
    context += 'Вы участвуете в дебатах с другими ИИ. Аргументированно изложите свою позицию, '
    context += 'можете не соглашаться с оппонентами и приводить контраргументы.\n'
  } else if (mode === 'collaboration') {
    context += '--- КОНТЕКСТ СОВМЕСТНОЙ РАБОТЫ ---\n'
    context += 'Вы работаете в команде с другими ИИ над решением задачи. '
    context += 'Дополняйте ответы других участников, развивайте идеи.\n'
  } else {
    context += '--- ПОСЛЕДОВАТЕЛЬНАЯ ДИСКУССИЯ ---\n'
    context += 'Каждая модель высказывается по очереди. Прочитайте предыдущие ответы и добавьте свой.\n'
  }

  return context
}

// POST /api/arena-chat/start — начать новую сессию и сделать первый раунд
// POST /api/arena-chat/round — сделать следующий раунд
// POST /api/arena-chat/stream — streaming всех раундов через SSE

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log('[Arena Chat API] Received request:', { action: body.action, participants: body.config?.participants?.map((p: any) => p.id) })
    const { action, config, userMessage } = body as {
      action: 'start' | 'round' | 'step'
      config?: ArenaChatConfig
      userMessage?: string
    }

    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400 })
    }

    if (action === 'start') {
      if (!config || !config.participants || config.participants.length === 0) {
        return new Response(JSON.stringify({ error: 'Need config with participants' }), { status: 400 })
      }

      // Создаём начальное сообщение от пользователя
      const userMsg: ArenaChatMessage = {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: config.topic,
        turn: 0,
        timestamp: new Date().toISOString(),
      }

      // Каждая модель отвечает по очереди
      const messages: ArenaChatMessage[] = [userMsg]
      const perModelHistory: Record<string, ArenaChatMessage[]> = {}
      let currentRound = 0

      // Первый раунд — каждая модель отвечает на тему
      for (const participant of config.participants) {
        const modelId = participant.id
        const model = await getModelInfo(participant)
        const contextMessages = buildContextMessagesForAPI(messages, modelId, config)
        
        const systemPrompt = config.perModelSystemPrompt?.[modelId] 
          || config.systemPrompt 
          || 'Вы участвуете в дискуссии с другими ИИ-моделями. Изложите свою точку зрения.'

        console.log('[Arena Chat API] Calling model:', modelId, 'messages count:', [{ role: 'system', content: systemPrompt }, ...contextMessages].length)
        const content = await callModel(
          modelId,
          [{ role: 'system', content: systemPrompt }, ...contextMessages],
          model.temperature,
          model.maxTokens
        )

        const assistantMsg: ArenaChatMessage = {
          id: `msg-${modelId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content,
          modelId,
          modelName: model.name,
          turn: 1,
          timestamp: new Date().toISOString(),
        }
        messages.push(assistantMsg)
        
        if (!perModelHistory[modelId]) {
          perModelHistory[modelId] = []
        }
        perModelHistory[modelId].push(assistantMsg)
      }

      currentRound = 1

      return new Response(JSON.stringify({
        messages,
        perModelHistory,
        currentRound,
        isRunning: currentRound < config.maxRounds,
      }))
    }

    if (action === 'round') {
      // Один полный раунд — каждая модель отвечает, видя предыдущие ответы
      if (!config || !config.participants || config.participants.length === 0) {
        return new Response(JSON.stringify({ error: 'Need config' }), { status: 400 })
      }

      const previousMessages: ArenaChatMessage[] = body.previousMessages || []
      const currentHistory: Record<string, ArenaChatMessage[]> = body.perModelHistory || {}
      const currentRoundNum = body.currentRound || 0
      const newRoundNum = currentRoundNum + 1

      console.log('[Arena Chat API] Round request:', { currentRoundNum, newRoundNum, maxRounds: config.maxRounds, participants: config.participants.map((p: any) => p.id) })

      const newMessages: ArenaChatMessage[] = [...previousMessages]
      const newHistory: Record<string, ArenaChatMessage[]> = {}
      
      // Copy existing history
      for (const key of Object.keys(currentHistory)) {
        newHistory[key] = [...currentHistory[key]]
      }

      for (const participant of config.participants) {
        console.log('[Arena Chat API] Round processing participant:', participant)
        const modelId = participant.id
        console.log('[Arena Chat API] modelId:', modelId)
        const model = await getModelInfo(participant)
        console.log('[Arena Chat API] modelInfo:', model)
        const contextMessages = buildContextMessagesForAPI(newMessages, modelId, config)
        console.log('[Arena Chat API] contextMessages count:', contextMessages.length)
        
        const systemPrompt = config.perModelSystemPrompt?.[modelId] 
          || config.systemPrompt 
          || 'Вы участвуете в дискуссии с другими ИИ-моделями. Ответьте на их аргументы.'

        console.log('[Arena Chat API] Calling model:', modelId, 'messages count:', [{ role: 'system', content: systemPrompt }, ...contextMessages].length)
        const content = await callModel(
          modelId,
          [{ role: 'system', content: systemPrompt }, ...contextMessages],
          model.temperature,
          model.maxTokens
        )

        const assistantMsg: ArenaChatMessage = {
          id: `msg-${modelId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content,
          modelId,
          modelName: model.name,
          turn: newRoundNum,
          timestamp: new Date().toISOString(),
        }
        newMessages.push(assistantMsg)
        
        if (!newHistory[modelId]) {
          newHistory[modelId] = []
        }
        newHistory[modelId].push(assistantMsg)
      }

      const isRunning = newRoundNum < config.maxRounds

      return new Response(JSON.stringify({
        messages: newMessages,
        perModelHistory: newHistory,
        currentRound: newRoundNum,
        isRunning,
      }))
    }

    if (action === 'step') {
      // Один шаг — ОДНА модель отвечает (для sequential mode с видимостью в реальном времени)
      if (!config || !config.participants) {
        return new Response(JSON.stringify({ error: 'Need config' }), { status: 400 })
      }

      const currentIndex = body.currentModelIndex ?? 0
      const participant = config.participants[currentIndex]
      
      if (!participant) {
        return new Response(JSON.stringify({ error: 'Invalid model index' }), { status: 400 })
      }

      const previousMessages: ArenaChatMessage[] = body.previousMessages || []
      const model = await getModelInfo(participant)
      const contextMessages = buildContextMessagesForAPI(previousMessages, participant.id, config)
      
      const systemPrompt = config.perModelSystemPrompt?.[participant.id] 
        || config.systemPrompt 
        || 'Вы участвуете в дискуссии с другими ИИ-моделями.'

      const content = await callModel(
        participant.id,
        [{ role: 'system', content: systemPrompt }, ...contextMessages],
        model.temperature,
        model.maxTokens
      )

      const assistantMsg: ArenaChatMessage = {
        id: `msg-${participant.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content,
        modelId: participant.id,
        modelName: model.name,
        turn: body.currentRound || 1,
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify({
        message: assistantMsg,
        nextModelIndex: (currentIndex + 1) % config.participants.length,
        isRoundComplete: (currentIndex + 1) >= config.participants.length,
      }))
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 })
  } catch (error: any) {
    console.error('Arena Chat Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
}

async function getModelInfo(participant: DebateModel) {
  // Use participant config or fallbacks
  const modelId = participant.id
  
  // Check Ollama models
  if (isLocalModel(modelId)) {
    const ollamaModel = extractOllamaModel(modelId)
    return {
      name: participant.name || `Ollama: ${ollamaModel}`,
      temperature: participant.temperature ?? 0.7,
      maxTokens: participant.maxTokens ?? 2048,
    }
  }

  return {
    name: participant.name || modelId.split('/').pop() || modelId,
    temperature: participant.temperature ?? 0.7,
    maxTokens: participant.maxTokens ?? 2048,
  }
}

function buildContextMessagesForAPI(
  messages: ArenaChatMessage[],
  currentModelId: string,
  config: ArenaChatConfig
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = []
  
  // Filter messages based on contextMode
  let relevantMessages = messages
  
  if (config.contextMode === 'topic_only') {
    // Only include the initial user topic message
    relevantMessages = messages.filter(m => m.role === 'user')
  } else if (config.contextMode === 'last_round') {
    // Only include messages from the last round
    const maxTurn = Math.max(...messages.filter(m => m.role === 'assistant').map(m => m.turn), 0)
    if (maxTurn > 0) {
      relevantMessages = messages.filter(m => m.role === 'user' || m.turn >= maxTurn)
    }
  }
  // 'full' mode uses all messages (default)
  
  // Добавляем все сообщения в хронологическом порядке
  for (const msg of relevantMessages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.modelId === currentModelId) {
      // Свои предыдущие ответы
      result.push({ role: 'assistant', content: msg.content })
    } else if (msg.modelId) {
      // Ответы других моделей — как "user" сообщения чтобы модель видела их
      result.push({ 
        role: 'user', 
        content: `[${msg.modelName || msg.modelId}]: ${msg.content}` 
      })
    }
  }

  // Если сообщений нет, добавляем тему
  if (result.length === 0) {
    result.push({ role: 'user', content: config.topic })
  }

  return result
}