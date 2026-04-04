export type NodeStatus = 'idle' | 'running' | 'completed' | 'error' | 'skipped'

export interface PipelineStep {
  nodeId: string
  label: string
  type: string
  status: NodeStatus
  result?: string
  tokens?: number
  latencyMs?: number
  startTime?: number
  endTime?: number
  modelId?: string
  modelName?: string
  promptTokens?: number
  completionTokens?: number
  promptCost?: number
  completionCost?: number
}

export interface Model {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | 'google' | 'meta' | 'mistral' | 'custom'
  description: string
  enabled: boolean
  level: number
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  webSearch?: boolean
  pricing?: {
    prompt: number
    completion: number
    request: number
  }
  fallbackModels?: string[]
  fallbackMode?: 'timeout' | 'on_error'
  fallbackTimeoutMs?: number
}

export interface ArenaNode {
  id: string
  type: 'prompt' | 'model' | 'validator' | 'aggregator' | 'search' | 'file' | 'router' | 'code' | 'classifier' | 'analyst' | 'researcher' | 'synthesizer' | 'summarizer'
  label: string
  data: {
    prompt?: string
    model?: Model
    filePath?: string
    isGlobal?: boolean
    result?: string
    status?: NodeStatus
    maxTokens?: number
    temperature?: number
    systemPrompt?: string
    agentPresetId?: string
    agentRole?: string
    agentDomain?: string
    jsonMode?: boolean
    jsonSchema?: string
    contextCompression?: {
      enabled: boolean
      thresholdTokens: number
      targetRatio?: number
      modelId?: string
    }
    fallbackModels?: string[]
    fallbackMode?: 'timeout' | 'on_error'
    fallbackTimeoutMs?: number
    searchQuery?: string
    codeAction?: 'write' | 'edit' | 'append' | 'delete'
    codePath?: string
    codeContent?: string
    // File node extra props
    isSmartRead?: boolean
    smartQuery?: string
    maxLines?: number
    // Search node extra props
    maxResults?: number
    searchSources?: ('duckduckgo' | 'searxng' | 'google' | 'bing' | 'rss')[]
    scrapeContent?: boolean
    searchLanguage?: string
    rssFeeds?: string[]
    // Router node extra props
    routingPrompt?: string
    routingMap?: Record<string, string>
    // Validator node extra props
    validationType?: string
    // Code node extra props
    codeOperation?: string
    targetFilePath?: string
    useAI?: boolean
    // Label stored in data for quick access
    label?: string
  }
}

export interface ArenaEdge {
  id: string
  source: string
  target: string
  type: 'data' | 'validation' | 'feedback'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  modelId?: string
  modelName?: string
  timestamp: string
}

export interface ModelResponse {
  id: string
  modelId: string
  modelName: string
  messageId?: string
  content: string
  status: 'pending' | 'streaming' | 'complete' | 'error'
  tokens?: number
  latency?: number
  isCollapsed?: boolean
  collapsedStepIds?: string[]
  pipelineSteps?: PipelineStep[]
  billedNodeIds?: string[]
}

export interface ArenaConfig {
  id: string
  name: string
  description: string
  nodes: ArenaNode[]
  edges: ArenaEdge[]
  knowledgeBase?: string[]
  createdAt: string
  updatedAt: string
}

export interface HistoricalChat {
  id: string
  title: string
  messages: ChatMessage[]
  responses: ModelResponse[]
  date: string
}

export interface UsageEvent {
  id: string
  timestamp: string
  modelId: string
  modelName: string
  tokens: number
  cost: number
  type: 'chat' | 'pipeline' | 'error'
}

// Telegram Bot Types
export interface TelegramUser {
  id: number
  username?: string
  firstName?: string
  lastName?: string
  firstSeen: string
  lastActive: string
  messageCount: number
  photoCount: number
  documentCount: number
  voiceCount: number
}

export interface TelegramMessage {
  id: string
  userId: number
  type: 'text' | 'photo' | 'document' | 'voice' | 'command'
  content: string
  timestamp: string
  responseTime?: number
  responseTokens?: number
  status: 'success' | 'error' | 'pending'
}

export interface TelegramStats {
  totalUsers: number
  activeUsers24h: number
  totalMessages: number
  messagesByType: { text: number; photo: number; document: number; voice: number; command: number }
  avgResponseTime: number
  totalTokens: number
  totalCost: number
  topCommands: Array<{ command: string; count: number }>
  messagesPerHour: Array<{ hour: number; count: number }>
  errors24h: number
}