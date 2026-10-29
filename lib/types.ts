// Общие типы, которые используют и сервер, и клиент.

// ─── Модели ──────────────────────────────────────────────────────────────

export type ProviderId = 'openrouter' | 'ollama' | 'custom'

export interface ModelInfo {
  id: string
  name: string
  provider: ProviderId
  /** Компания-разработчик: openai, anthropic, google… */
  vendor: string
  description?: string
  contextLength?: number
  /** Цена в долларах за один токен */
  pricing?: { prompt: number; completion: number }
  supportsTools?: boolean
  supportsReasoning?: boolean
  /** Unix-время публикации модели (у OpenRouter) */
  created?: number
}

/** Псевдонимы моделей: агенты и шаблоны ссылаются на роль, а не на конкретную модель */
export type ModelAlias = '@smart' | '@default' | '@fast'

// ─── Сообщения и вызовы LLM ─────────────────────────────────────────────

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/** Наборы инструментов, которые можно выдать модели */
export type ToolsetId = 'web' | 'files_read' | 'files_write' | 'knowledge' | 'skills'

export interface LLMRequest {
  model: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  tools?: ToolsetId[]
  jsonMode?: boolean
  /** Максимум шагов цикла «модель → инструмент → модель» */
  maxToolSteps?: number
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  /** Стоимость в долларах; null, если провайдер её не сообщил и цены неизвестны */
  cost: number | null
}

/** События потокового ответа /api/llm (NDJSON, одно событие на строку) */
export type LLMEvent =
  | { t: 'text'; v: string }
  | { t: 'reasoning'; v: string }
  | { t: 'tool_call'; id: string; name: string; args: string }
  | { t: 'tool_result'; id: string; name: string; ok: boolean; preview: string }
  | { t: 'notice'; v: string }
  | { t: 'usage'; usage: Usage; model: string }
  | { t: 'error'; message: string; status?: number }
  | { t: 'done'; finish: string }

export interface ToolTrace {
  id: string
  name: string
  args: string
  ok?: boolean
  preview?: string
}

export interface LLMResult {
  text: string
  reasoning: string
  tools: ToolTrace[]
  usage: Usage
  model: string
  latencyMs: number
  error?: string
  aborted?: boolean
}

// ─── Статус сервера ──────────────────────────────────────────────────────

export interface ServerStatus {
  openrouter: { configured: boolean; source: 'settings' | 'env' | null; masked?: string }
  ollama: { url: string; reachable: boolean; models: number }
  custom: { url: string | null; configured: boolean }
  searxng: boolean
  /** Свой метапоиск: поисковики и их состояние */
  search: { id: string; name: string; pausedUntil?: number; lastError?: string; ok: number; failed: number }[]
  workspace: string
}

// ─── Навыки ──────────────────────────────────────────────────────────────

export interface SkillMeta {
  id: string
  name: string
  description: string
  category?: string
}

export interface Skill extends SkillMeta {
  content: string
  updatedAt: string
}

// ─── База знаний ─────────────────────────────────────────────────────────

export interface KnowledgeDoc {
  id: string
  title: string
  source: 'workspace' | 'upload' | 'text'
  path?: string
  chunks: number
  tokens: number
  indexedAt: string
}

export interface KnowledgeHit {
  docId: string
  title: string
  text: string
  score: number
  startLine: number
  endLine: number
}

// ─── Workspace ───────────────────────────────────────────────────────────

export interface WorkspaceEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size?: number
  children?: WorkspaceEntry[]
}
