// Schedule trigger implementation using node-cron

import { 
  Trigger, 
  ScheduleTriggerConfig, 
  TriggerEvent,
  triggerRegistry 
} from './types'
import { executeChain } from '../chains'
import { registerScheduledJob, stopScheduledJob } from './index'

// Validate cron expression
export function validateCronExpression(expression: string): boolean {
  // Basic validation - node-cron will do more thorough validation
  const parts = expression.split(' ')
  if (parts.length !== 5 && parts.length !== 6) {
    return false
  }
  return true
}

// Get human-readable description of cron
export function describeCron(expression: string): string {
  const descriptions: Record<string, string> = {
    '* * * * *': 'Every minute',
    '0 * * * *': 'Every hour',
    '0 0 * * *': 'Every day at midnight',
    '0 9 * * 1-5': 'Every weekday at 9 AM',
    '0 9 * * 1': 'Every Monday at 9 AM',
    '0 0 * * 0': 'Every Sunday at midnight',
    '*/15 * * * *': 'Every 15 minutes',
    '0 */6 * * *': 'Every 6 hours',
  }
  
  return descriptions[expression] || `Cron: ${expression}`
}

// Create and start a schedule trigger
export async function createScheduleTrigger(
  name: string,
  description: string,
  config: Omit<ScheduleTriggerConfig, 'type'>,
  chainIds: string[],
  id?: string
): Promise<Trigger> {
  if (!validateCronExpression(config.cronExpression)) {
    throw new Error(`Invalid cron expression: ${config.cronExpression}`)
  }

  const trigger: Trigger = {
    id: id || `schedule-${Date.now()}`,
    name,
    description,
    type: 'schedule',
    config: {
      type: 'schedule',
      ...config,
    },
    chainIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    triggerCount: 0,
  }

  // Start the cron job
  await startScheduleTrigger(trigger)

  // Register in trigger registry
  triggerRegistry.register(trigger, async (event) => {
    await handleScheduleTrigger(trigger, event)
  })

  return trigger
}

// Start a schedule trigger
export async function startScheduleTrigger(trigger: Trigger): Promise<void> {
  if (trigger.type !== 'schedule') {
    throw new Error('Not a schedule trigger')
  }

  const config = trigger.config as ScheduleTriggerConfig
  
  // Stop existing job if any
  stopScheduledJob(trigger.id)

  // Only server-side
  if (typeof window !== 'undefined') return

  try {
    const cron = await import('node-cron')
    
    const job = cron.schedule(
      config.cronExpression,
      async () => {
        await handleScheduleTrigger(trigger, {
          id: `event-${Date.now()}`,
          triggerId: trigger.id,
          type: 'schedule',
          timestamp: new Date().toISOString(),
          data: config.inputData,
        })
      },
      {
        timezone: config.timezone || 'UTC',
        scheduled: config.enabled !== false,
      }
    )

    registerScheduledJob(trigger.id, job)
  } catch (error) {
    console.error(`Failed to start schedule trigger ${trigger.id}:`, error)
  }
}

// Handle schedule trigger event
async function handleScheduleTrigger(trigger: Trigger, event: TriggerEvent): Promise<void> {
  console.log(`[Schedule Trigger] ${trigger.name} triggered at ${event.timestamp}`)
  
  // Execute associated chains
  for (const chainId of trigger.chainIds) {
    try {
      const result = await executeChain(chainId, {
        ...event.data,
        triggerType: 'schedule',
        triggerName: trigger.name,
        triggeredAt: event.timestamp,
      })
      
      console.log(`[Schedule Trigger] Chain ${chainId} executed:`, result.status)
    } catch (error) {
      console.error(`[Schedule Trigger] Chain ${chainId} failed:`, error)
    }
  }

  // Update trigger stats
  trigger.lastTriggeredAt = event.timestamp
  trigger.triggerCount++
  triggerRegistry.updateTrigger(trigger)
}

// Stop a schedule trigger
export function stopScheduleTrigger(triggerId: string): void {
  stopScheduledJob(triggerId)
}

// Update schedule trigger
export async function updateScheduleTrigger(
  triggerId: string,
  updates: Partial<ScheduleTriggerConfig>
): Promise<Trigger | null> {
  const trigger = triggerRegistry.get(triggerId)
  if (!trigger || trigger.type !== 'schedule') {
    return null
  }

  // Update config
  trigger.config = {
    ...trigger.config,
    ...updates,
    type: 'schedule',
  }
  trigger.updatedAt = new Date().toISOString()

  // Restart with new config
  await startScheduleTrigger(trigger)
  triggerRegistry.updateTrigger(trigger)

  return trigger
}

// Common schedule presets
export const schedulePresets = [
  { name: 'Every minute', expression: '* * * * *' },
  { name: 'Every 5 minutes', expression: '*/5 * * * *' },
  { name: 'Every 15 minutes', expression: '*/15 * * * *' },
  { name: 'Every hour', expression: '0 * * * *' },
  { name: 'Every 6 hours', expression: '0 */6 * * *' },
  { name: 'Every day at midnight', expression: '0 0 * * *' },
  { name: 'Every day at 9 AM', expression: '0 9 * * *' },
  { name: 'Every weekday at 9 AM', expression: '0 9 * * 1-5' },
  { name: 'Every Monday at 9 AM', expression: '0 9 * * 1' },
  { name: 'Every Sunday at midnight', expression: '0 0 * * 0' },
  { name: 'First day of month at 9 AM', expression: '0 9 1 * *' },
]
