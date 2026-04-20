import { NextRequest, NextResponse } from 'next/server'
import { triggerRegistry, Trigger } from '@/lib/triggers'

// GET /api/triggers - List all triggers
export async function GET() {
  try {
    const triggers = triggerRegistry.getAll().map(trigger => ({
      id: trigger.id,
      name: trigger.name,
      description: trigger.description,
      type: trigger.type,
      config: trigger.config,
      chainIds: trigger.chainIds,
      enabled: trigger.config.enabled,
      createdAt: trigger.createdAt,
      updatedAt: trigger.updatedAt,
      lastTriggeredAt: trigger.lastTriggeredAt,
      triggerCount: trigger.triggerCount,
    }))

    return NextResponse.json({ triggers })
  } catch (error) {
    console.error('Failed to list triggers:', error)
    return NextResponse.json(
      { error: 'Failed to list triggers' },
      { status: 500 }
    )
  }
}

// POST /api/triggers - Create or update a trigger
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { 
      id,
      name, 
      description, 
      type, 
      config, 
      chainIds = [],
    } = body

    // Validate
    if (!name || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: name, type' },
        { status: 400 }
      )
    }

    const triggerId = id || `${type}-${Date.now()}`
    
    const trigger: Trigger = {
      id: triggerId,
      name,
      description: description || '',
      type,
      config: {
        ...config,
        type,
        enabled: config?.enabled !== false,
      },
      chainIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      triggerCount: 0,
    }

    triggerRegistry.register(trigger)

    // Start the trigger based on type
    if (type === 'schedule') {
      const { createScheduleTrigger } = await import('@/lib/triggers/scheduler')
      await createScheduleTrigger(name, description, config, chainIds, triggerId)
    } else if (type === 'file_watch') {
      const { createFileWatchTrigger } = await import('@/lib/triggers/file-watch')
      await createFileWatchTrigger(name, description, config, chainIds, triggerId)
    } else if (type === 'webhook') {
      const { createWebhookTrigger } = await import('@/lib/triggers/webhook')
      await createWebhookTrigger(name, description, config, chainIds, triggerId)
    }

    return NextResponse.json({ 
      success: true,
      trigger: {
        id: trigger.id,
        name: trigger.name,
        type: trigger.type,
        enabled: trigger.config.enabled,
      }
    })
  } catch (error: any) {
    console.error('Failed to create trigger:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create trigger' },
      { status: 500 }
    )
  }
}

// DELETE /api/triggers?id=xxx - Delete a trigger
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Missing trigger id' },
        { status: 400 }
      )
    }

    const trigger = triggerRegistry.get(id)
    if (!trigger) {
      return NextResponse.json(
        { error: 'Trigger not found' },
        { status: 404 }
      )
    }

    // Stop the trigger
    if (trigger.type === 'schedule') {
      const { stopScheduleTrigger } = await import('@/lib/triggers/scheduler')
      stopScheduleTrigger(id)
    } else if (trigger.type === 'file_watch') {
      const { stopFileWatchTrigger } = await import('@/lib/triggers/file-watch')
      stopFileWatchTrigger(id)
    } else if (trigger.type === 'webhook') {
      const { stopWebhookTrigger } = await import('@/lib/triggers/webhook')
      stopWebhookTrigger(id)
    }

    triggerRegistry.unregister(id)

    return NextResponse.json({ 
      success: true,
      message: `Trigger ${id} deleted` 
    })
  } catch (error: any) {
    console.error('Failed to delete trigger:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete trigger' },
      { status: 500 }
    )
  }
}
