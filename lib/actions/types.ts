// Action system types for Hephaestus

export type ActionCategory = 'communication' | 'productivity' | 'monitoring' | 'data' | 'agent'
export type ActionInputType = 'string' | 'number' | 'boolean' | 'file' | 'json' | 'select' | 'textarea'
export type AuthType = 'oauth' | 'api_key' | 'basic' | 'none'

export interface ActionInput {
  name: string
  type: ActionInputType
  required: boolean
  description: string
  default?: any
  options?: string[] // For select type
}

export interface ActionOutput {
  name: string
  type: string
  description: string
}

export interface ActionConfig {
  requiresAuth: boolean
  authType?: AuthType
  rateLimit?: number // requests per minute
  retryCount?: number
  timeoutMs?: number
}

export interface ActionContext {
  credentials?: Record<string, string>
  agentId?: string
  chainId?: string
  triggerId?: string
  previousResults?: Record<string, any>
}

export interface ActionResult {
  success: boolean
  data?: any
  error?: string
  metadata?: {
    duration: number
    tokensUsed?: number
    cost?: number
    retryCount?: number
  }
}

export interface Action {
  id: string
  name: string
  description: string
  category: ActionCategory
  icon?: string
  inputs: ActionInput[]
  outputs: ActionOutput[]
  config: ActionConfig
  execute: (inputs: Record<string, any>, context: ActionContext) => Promise<ActionResult>
}

export interface ActionExecutionRecord {
  id: string
  actionId: string
  chainId?: string
  inputs: Record<string, any>
  result: ActionResult
  executedAt: string
  executedBy?: string
}

// Action registry for managing all available actions
export class ActionRegistry {
  private actions: Map<string, Action> = new Map()

  register(action: Action): void {
    this.actions.set(action.id, action)
  }

  unregister(actionId: string): void {
    this.actions.delete(actionId)
  }

  get(actionId: string): Action | undefined {
    return this.actions.get(actionId)
  }

  getAll(): Action[] {
    return Array.from(this.actions.values())
  }

  getByCategory(category: ActionCategory): Action[] {
    return this.getAll().filter(a => a.category === category)
  }

  clear(): void {
    this.actions.clear()
  }
}

// Global action registry instance
export const actionRegistry = new ActionRegistry()
