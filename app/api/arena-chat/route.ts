import { ArenaChatConfig, ArenaChatMessage } from '@/lib/types'

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
    const { action, config, userMessage } = body as {
      action: 'start' | 'round' | 'step'
      config?: ArenaChatConfig
      userMessage?: string
    }

    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400 })
    }

    if (action === 'start') {
      if (!config || !config.participantModelIds || config.participantModelIds.length === 0) {
        return new Response(JSON.stringify({ error: 'Need config with participantModelIds' }), { status: 400 })
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
      const allModelIds = config.participantModelIds
      let currentRound = 0

      // Первый раунд — каждая модель отвечает на тему
      for (const modelId of allModelIds) {
        const model = await getModelInfo(modelId)
        const contextMessages = buildContextMessagesForAPI(messages, modelId, config)
        
        const systemPrompt = config.perModelSystemPrompt?.[modelId] 
          || config.systemPrompt 
          || 'Вы участвуете в дискуссии с другими ИИ-моделями. Изложите свою точку зрения.'

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
      }

      currentRound = 1

      return new Response(JSON.stringify({
        messages,
        currentRound,
        isRunning: currentRound < config.maxRounds,
      }))
    }

    if (action === 'round') {
      // Один полный раунд — каждая модель отвечает, видя предыдущие ответы
      if (!config || !config.participantModelIds || config.participantModelIds.length === 0) {
        return new Response(JSON.stringify({ error: 'Need config' }), { status: 400 })
      }

      const previousMessages: ArenaChatMessage[] = body.previousMessages || []
      const currentRoundNum = body.currentRound || 0
      const newRoundNum = currentRoundNum + 1

      const newMessages: ArenaChatMessage[] = [...previousMessages]

      for (const modelId of config.participantModelIds) {
        const model = await getModelInfo(modelId)
        const contextMessages = buildContextMessagesForAPI(newMessages, modelId, config)
        
        const systemPrompt = config.perModelSystemPrompt?.[modelId] 
          || config.systemPrompt 
          || 'Вы участвуете в дискуссии с другими ИИ-моделями. Ответьте на их аргументы.'

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
      }

      const isRunning = newRoundNum < config.maxRounds

      return new Response(JSON.stringify({
        messages: newMessages,
        currentRound: newRoundNum,
        isRunning,
      }))
    }

    if (action === 'step') {
      // Один шаг — ОДНА модель отвечает (для sequential mode с видимостью в реальном времени)
      if (!config || !config.participantModelIds) {
        return new Response(JSON.stringify({ error: 'Need config' }), { status: 400 })
      }

      const currentIndex = body.currentModelIndex ?? 0
      const modelId = config.participantModelIds[currentIndex]
      
      if (!modelId) {
        return new Response(JSON.stringify({ error: 'Invalid model index' }), { status: 400 })
      }

      const previousMessages: ArenaChatMessage[] = body.previousMessages || []
      const model = await getModelInfo(modelId)
      const contextMessages = buildContextMessagesForAPI(previousMessages, modelId, config)
      
      const systemPrompt = config.perModelSystemPrompt?.[modelId] 
        || config.systemPrompt 
        || 'Вы участвуете в дискуссии с другими ИИ-моделями.'

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
        turn: body.currentRound || 1,
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify({
        message: assistantMsg,
        nextModelIndex: (currentIndex + 1) % config.participantModelIds.length,
        isRoundComplete: (currentIndex + 1) >= config.participantModelIds.length,
      }))
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 })
  } catch (error: any) {
    console.error('Arena Chat Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
}

async function getModelInfo(modelId: string) {
  // Try to get model from store defaults or use defaults
  const defaults: Record<string, { name: string; temperature: number; maxTokens: number }> = {
    'openai/gpt-4o-mini': { name: 'GPT-4o Mini', temperature: 0.7, maxTokens: 2048 },
    'openai/gpt-4o': { name: 'GPT-4o', temperature: 0.7, maxTokens: 2048 },
    'anthropic/claude-3.5-sonnet': { name: 'Claude 3.5 Sonnet', temperature: 0.7, maxTokens: 2048 },
    'anthropic/claude-3-opus': { name: 'Claude 3 Opus', temperature: 0.7, maxTokens: 2048 },
    'google/gemini-pro': { name: 'Gemini Pro', temperature: 0.7, maxTokens: 2048 },
    'openai/o3-mini': { name: 'GPT-4', temperature: 0.7, maxTokens: 4096 },
  }

  // Check Ollama models
  if (isLocalModel(modelId)) {
    const ollamaModel = extractOllamaModel(modelId)
    return {
      name: `Ollama: ${ollamaModel}`,
      temperature: 0.7,
      maxTokens: 2048,
    }
  }

  return defaults[modelId] || { 
    name: modelId.split('/').pop() || modelId, 
    temperature: 0.7, 
    maxTokens: 2048 
  }
}

function buildContextMessagesForAPI(
  messages: ArenaChatMessage[],
  currentModelId: string,
  config: ArenaChatConfig
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = []
  
  // Добавляем все сообщения в хронологическом порядке
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.modelId === currentModelId) {
      // Свои предыдущие ответы
      result.push({ role: 'assistant', content: msg.content })
    } else if (msg.modelId) {
      // Ответы других моделей — как "user" сообщения чтобы модель видела их
      const context = buildModelContext(messages, currentModelId, config.visibleMessagesPerModel, config.mode)
      result.push({ 
        role: 'user', 
        content: `[Ответ от ${msg.modelName}]:\n${msg.content}\n\n---\nВаш ответ:` 
      })
    }
  }

  // Если сообщений нет, добавляем тему
  if (result.length === 0) {
    result.push({ role: 'user', content: config.topic })
  }

  return result
}