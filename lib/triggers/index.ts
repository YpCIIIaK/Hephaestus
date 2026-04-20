// Triggers system entry point for Hephaestus

export * from './types'
export { schedulePresets, describeCron, validateCronExpression } from './scheduler'
export { fileWatchPresets } from './file-watch'
export { webhookPresets, generateWebhookPath, generateWebhookSecret } from './webhook'

// Trigger state management
interface TriggerState {
  enabled: boolean
  lastTriggeredAt?: string
  triggerCount: number
  errorCount: number
}

const triggerStates = new Map<string, TriggerState>()

// Initialize trigger state
export function initTriggerState(triggerId: string): void {
  if (!triggerStates.has(triggerId)) {
    triggerStates.set(triggerId, {
      enabled: true,
      triggerCount: 0,
      errorCount: 0
    })
  }
}

// Enable/disable trigger
export function setTriggerEnabled(triggerId: string, enabled: boolean): void {
  initTriggerState(triggerId)
  const state = triggerStates.get(triggerId)!
  state.enabled = enabled
}

// Check if trigger is enabled
export function isTriggerEnabled(triggerId: string): boolean {
  return triggerStates.get(triggerId)?.enabled ?? true
}

// Record trigger execution
export function recordTriggerExecution(triggerId: string, success: boolean): void {
  initTriggerState(triggerId)
  const state = triggerStates.get(triggerId)!
  state.lastTriggeredAt = new Date().toISOString()
  state.triggerCount++
  if (!success) state.errorCount++
}

// Get trigger state
export function getTriggerState(triggerId: string): TriggerState | undefined {
  return triggerStates.get(triggerId)
}

// Schedule management (for cron triggers)
let scheduledJobs: Map<string, any> = new Map()

export function registerScheduledJob(triggerId: string, job: any): void {
  scheduledJobs.set(triggerId, job)
}

export function stopScheduledJob(triggerId: string): void {
  const job = scheduledJobs.get(triggerId)
  if (job && job.stop) {
    job.stop()
  }
  scheduledJobs.delete(triggerId)
}

export function clearAllScheduledJobs(): void {
  for (const [id, job] of scheduledJobs) {
    if (job && job.stop) {
      job.stop()
    }
  }
  scheduledJobs.clear()
}

// File watchers management
let fileWatchers: Map<string, any> = new Map()

export function registerFileWatcher(triggerId: string, watcher: any): void {
  fileWatchers.set(triggerId, watcher)
}

export function stopFileWatcher(triggerId: string): void {
  const watcher = fileWatchers.get(triggerId)
  if (watcher && watcher.close) {
    watcher.close()
  }
  fileWatchers.delete(triggerId)
}

export function clearAllFileWatchers(): void {
  for (const [id, watcher] of fileWatchers) {
    if (watcher && watcher.close) {
      watcher.close()
    }
  }
  fileWatchers.clear()
}

// Webhook handlers registry
const webhookHandlers = new Map<string, (req: any, res: any) => Promise<void>>()

export function registerWebhookHandler(
  path: string, 
  handler: (req: any, res: any) => Promise<void>
): void {
  webhookHandlers.set(path, handler)
}

export function getWebhookHandler(path: string): ((req: any, res: any) => Promise<void>) | undefined {
  return webhookHandlers.get(path)
}

export function unregisterWebhookHandler(path: string): void {
  webhookHandlers.delete(path)
}

export function getAllWebhookPaths(): string[] {
  return Array.from(webhookHandlers.keys())
}

// Cleanup function for shutdown
export function cleanupTriggers(): void {
  clearAllScheduledJobs()
  clearAllFileWatchers()
  webhookHandlers.clear()
}
