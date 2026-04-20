// File watch trigger implementation using chokidar

import { 
  Trigger, 
  FileWatchTriggerConfig, 
  TriggerEvent,
  triggerRegistry 
} from './types'
import { executeChain } from '../chains'
import { registerFileWatcher, stopFileWatcher } from './index'

// Create and start a file watch trigger
export async function createFileWatchTrigger(
  name: string,
  description: string,
  config: Omit<FileWatchTriggerConfig, 'type'>,
  chainIds: string[],
  id?: string
): Promise<Trigger> {
  const trigger: Trigger = {
    id: id || `file-watch-${Date.now()}`,
    name,
    description,
    type: 'file_watch',
    config: {
      type: 'file_watch',
      ...config,
    },
    chainIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    triggerCount: 0,
  }

  // Start the file watcher
  await startFileWatchTrigger(trigger)

  // Register in trigger registry
  triggerRegistry.register(trigger, async (event) => {
    await handleFileWatchTrigger(trigger, event)
  })

  return trigger
}

// Start a file watch trigger
export async function startFileWatchTrigger(trigger: Trigger): Promise<void> {
  if (trigger.type !== 'file_watch') {
    throw new Error('Not a file watch trigger')
  }

  const config = trigger.config as FileWatchTriggerConfig
  
  // Stop existing watcher if any
  stopFileWatcher(trigger.id)

  // Only server-side
  if (typeof window !== 'undefined') return

  try {
    const chokidar = await import('chokidar')
    
    const watcher = chokidar.watch(config.paths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      recursive: config.recursive !== false,
      awaitWriteFinish: {
        stabilityThreshold: config.debounce || 1000,
        pollInterval: 100
      }
    })

    // Handle events
    const handleEvent = async (eventType: 'create' | 'modify' | 'delete', path: string) => {
      if (!config.events.includes(eventType)) return

      const event: TriggerEvent = {
        id: `event-${Date.now()}`,
        triggerId: trigger.id,
        type: 'file_watch',
        timestamp: new Date().toISOString(),
        data: {
          eventType,
          path,
          fileName: path.split(/[/\\]/).pop(),
        },
      }

      await handleFileWatchTrigger(trigger, event)
    }

    if (config.events.includes('create')) {
      watcher.on('add', (path) => handleEvent('create', path))
      watcher.on('addDir', (path) => handleEvent('create', path))
    }

    if (config.events.includes('modify')) {
      watcher.on('change', (path) => handleEvent('modify', path))
    }

    if (config.events.includes('delete')) {
      watcher.on('unlink', (path) => handleEvent('delete', path))
      watcher.on('unlinkDir', (path) => handleEvent('delete', path))
    }

    watcher.on('error', (error) => {
      console.error(`[File Watch Trigger] ${trigger.id} error:`, error)
    })

    registerFileWatcher(trigger.id, watcher)
  } catch (error) {
    console.error(`Failed to start file watch trigger ${trigger.id}:`, error)
  }
}

// Handle file watch trigger event
async function handleFileWatchTrigger(trigger: Trigger, event: TriggerEvent): Promise<void> {
  console.log(`[File Watch Trigger] ${trigger.name} triggered: ${event.data.eventType} ${event.data.path}`)
  
  // Debounce: check if we already processed this file recently
  const cacheKey = `${event.data.path}:${event.data.eventType}`
  const lastProcessed = fileWatchCache.get(cacheKey)
  const now = Date.now()
  
  if (lastProcessed && (now - lastProcessed) < 1000) {
    return // Skip duplicate events within 1 second
  }
  
  fileWatchCache.set(cacheKey, now)

  // Execute associated chains
  for (const chainId of trigger.chainIds) {
    try {
      const result = await executeChain(chainId, {
        ...event.data,
        triggerType: 'file_watch',
        triggerName: trigger.name,
        triggeredAt: event.timestamp,
      })
      
      console.log(`[File Watch Trigger] Chain ${chainId} executed:`, result.status)
    } catch (error) {
      console.error(`[File Watch Trigger] Chain ${chainId} failed:`, error)
    }
  }

  // Update trigger stats
  trigger.lastTriggeredAt = event.timestamp
  trigger.triggerCount++
  triggerRegistry.updateTrigger(trigger)
}

// Simple cache for debouncing
const fileWatchCache = new Map<string, number>()

// Stop a file watch trigger
export function stopFileWatchTrigger(triggerId: string): void {
  stopFileWatcher(triggerId)
}

// Common file watch presets
export const fileWatchPresets = [
  { 
    name: 'Markdown files', 
    paths: ['**/*.md'],
    events: ['create', 'modify'] as const,
  },
  { 
    name: 'TypeScript files', 
    paths: ['**/*.ts', '**/*.tsx'],
    events: ['modify'] as const,
  },
  { 
    name: 'Configuration files', 
    paths: ['**/*.json', '**/*.yaml', '**/*.yml', '**/*.toml'],
    events: ['modify'] as const,
  },
  { 
    name: 'Documentation', 
    paths: ['docs/**/*', 'README.md', 'CHANGELOG.md'],
    events: ['create', 'modify'] as const,
  },
]
