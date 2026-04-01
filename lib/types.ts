export type NodeStatus = 'idle' | 'running' | 'completed' | 'error' | 'skipped'

export interface PipelineStep {
  nodeId: string
  label: string
  type: string
  status: NodeStatus
  result?: string
  tokens?: number
  // Measured duration for the node execution (ms). Helps compute tokens/sec.
  latencyMs?: number
  // Absolute timestamps for Gantt/waterfall visualization
  startTime?: number
  endTime?: number
  // Model metadata for AI steps (model/validator/aggregator/router nodes).
  modelId?: string
  modelName?: string
  // Token/cost efficiency split for AI steps.
  // Note: "tokens" remains the completion/generation tokens to keep existing UI behaviour.
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
  // Smart Fallback Chain - models to try if primary fails/times out
  fallbackModels?: string[]
  fallbackMode?: 'timeout' | 'on_error'  // When to trigger fallback
  fallbackTimeoutMs?: number  // Timeout before switching to fallback (default: 5000ms, only for timeout mode)
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

export interface ArenaNode {
  id: string
  type: 'model' | 'prompt' | 'validator' | 'aggregator' | 'search' | 'file' | 'router' | 'code'
  position: { x: number; y: number }
  data: {
    label: string
    model?: Model
    prompt?: string
    validationType?: 'consensus' | 'scoring' | 'custom'
    searchQuery?: string
    maxResults?: number
    filePath?: string
    isGlobal?: boolean
    // Smart File Reader mode (IDE-like selective reading)
    isSmartRead?: boolean
    smartQuery?: string
    maxLines?: number
    // Context Compression (auto-compress long contexts)
    contextCompression?: {
      enabled: boolean
      thresholdTokens?: number  // Сжимать если контекст больше (default: 1000)
      targetRatio?: number      // Целевое сжатие (default: 0.5 = 50%)
      modelId?: string          // Модель для сжатия (default: cheap free model)
    }
    routingPrompt?: string
    routingMap?: Record<string, string>
    // Code/Editor node properties
    codeOperation?: 'write' | 'edit' | 'append' | 'delete'
    targetFilePath?: string
    useAI?: boolean
    status?: NodeStatus
    result?: string
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
