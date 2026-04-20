// Trigger system types for Hephaestus

export type TriggerType = 'schedule' | 'webhook' | 'file_watch' | 'manual' | 'event'

export interface TriggerConfig {
  enabled: boolean
  retryOnFailure?: boolean
  maxRetries?: number
}

export interface ScheduleTriggerConfig extends TriggerConfig {
  type: 'schedule'
  cronExpression: string
  timezone: string
  inputData: Record<string, any>
}

export interface FileWatchTriggerConfig extends TriggerConfig {
  type: 'file_watch'
  paths: string[]
  events: ('create' | 'modify' | 'delete')[]
  debounce: number // ms
  recursive?: boolean
}

export interface WebhookTriggerConfig extends TriggerConfig {
  type: 'webhook'
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ANY'
  secret?: string
  allowedIPs?: string[]
  allowedHeaders?: string[]
}

export interface ManualTriggerConfig extends TriggerConfig {
  type: 'manual'
  description?: string
}

export interface EventTriggerConfig extends TriggerConfig {
  type: 'event'
  eventType: string
  filters?: Record<string, any>
}

export type TriggerSpecificConfig = 
  | ScheduleTriggerConfig 
  | FileWatchTriggerConfig 
  | WebhookTriggerConfig 
  | ManualTriggerConfig
  | EventTriggerConfig

export interface TriggerEvent {
  id: string
  triggerId: string
  type: TriggerType
  timestamp: string
  data: Record<string, any>
  metadata?: {
    source?: string
    ip?: string
    userAgent?: string
  }
}

export interface Trigger {
  id: string
  name: string
  description: string
  type: TriggerType
  config: TriggerSpecificConfig
  chainIds: string[] // Chains to execute when triggered
  createdAt: string
  updatedAt: string
  lastTriggeredAt?: string
  triggerCount: number
}

export type TriggerHandler = (event: TriggerEvent) => Promise<void>

// Trigger registry
export class TriggerRegistry {
  private triggers: Map<string, Trigger> = new Map()
  private handlers: Map<string, TriggerHandler> = new Map()

  register(trigger: Trigger, handler?: TriggerHandler): void {
    this.triggers.set(trigger.id, trigger)
    if (handler) {
      this.handlers.set(trigger.id, handler)
    }
  }

  unregister(triggerId: string): void {
    this.triggers.delete(triggerId)
    this.handlers.delete(triggerId)
  }

  get(triggerId: string): Trigger | undefined {
    return this.triggers.get(triggerId)
  }

  getAll(): Trigger[] {
    return Array.from(this.triggers.values())
  }

  getByType(type: TriggerType): Trigger[] {
    return this.getAll().filter(t => t.type === type)
  }

  getHandler(triggerId: string): TriggerHandler | undefined {
    return this.handlers.get(triggerId)
  }

  updateTrigger(trigger: Trigger): void {
    this.triggers.set(trigger.id, trigger)
  }

  clear(): void {
    this.triggers.clear()
    this.handlers.clear()
  }
}

// Global trigger registry
export const triggerRegistry = new TriggerRegistry()
