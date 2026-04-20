// Webhook trigger implementation

import { 
  Trigger, 
  WebhookTriggerConfig, 
  TriggerEvent,
  triggerRegistry 
} from './types'
import { executeChain } from '../chains'
import { registerWebhookHandler, unregisterWebhookHandler } from './index'
import { NextRequest, NextResponse } from 'next/server'

// Create a webhook trigger
export async function createWebhookTrigger(
  name: string,
  description: string,
  config: Omit<WebhookTriggerConfig, 'type'>,
  chainIds: string[],
  id?: string
): Promise<Trigger> {
  const trigger: Trigger = {
    id: id || `webhook-${Date.now()}`,
    name,
    description,
    type: 'webhook',
    config: {
      type: 'webhook',
      ...config,
    },
    chainIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    triggerCount: 0,
  }

  // Register webhook handler
  await startWebhookTrigger(trigger)

  // Register in trigger registry
  triggerRegistry.register(trigger, async (event) => {
    await handleWebhookTrigger(trigger, event)
  })

  return trigger
}

// Start/register a webhook trigger
export async function startWebhookTrigger(trigger: Trigger): Promise<void> {
  if (trigger.type !== 'webhook') {
    throw new Error('Not a webhook trigger')
  }

  const config = trigger.config as WebhookTriggerConfig
  const path = config.path.startsWith('/') ? config.path : `/${config.path}`

  // Register the handler
  registerWebhookHandler(path, async (req: NextRequest, res: NextResponse) => {
    try {
      // Check IP whitelist if configured
      if (config.allowedIPs && config.allowedIPs.length > 0) {
        const clientIp = req.headers.get('x-forwarded-for') || 
                        req.headers.get('x-real-ip') || 
                        'unknown'
        
        if (!config.allowedIPs.includes(clientIp)) {
          return new NextResponse('Forbidden', { status: 403 })
        }
      }

      // Verify secret if configured
      if (config.secret) {
        const signature = req.headers.get('x-webhook-signature') ||
                         req.headers.get('x-hub-signature-256')
        
        if (!signature) {
          return new NextResponse('Missing signature', { status: 401 })
        }

        // For HMAC verification, we'd need crypto
        // This is a simplified check
        const providedSecret = req.headers.get('x-webhook-secret')
        if (providedSecret !== config.secret) {
          return new NextResponse('Invalid secret', { status: 401 })
        }
      }

      // Parse body
      let body: any
      const contentType = req.headers.get('content-type') || ''
      
      if (contentType.includes('application/json')) {
        body = await req.json()
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await req.formData()
        body = Object.fromEntries(formData)
      } else {
        body = await req.text()
      }

      // Create event
      const event: TriggerEvent = {
        id: `event-${Date.now()}`,
        triggerId: trigger.id,
        type: 'webhook',
        timestamp: new Date().toISOString(),
        data: {
          method: req.method,
          headers: Object.fromEntries(req.headers.entries()),
          body,
          query: Object.fromEntries(new URL(req.url).searchParams),
        },
        metadata: {
          source: 'webhook',
          ip: req.headers.get('x-forwarded-for') || 'unknown',
          userAgent: req.headers.get('user-agent') || 'unknown',
        }
      }

      // Handle the trigger
      await handleWebhookTrigger(trigger, event)

      // Return success response
      return NextResponse.json({ 
        success: true, 
        eventId: event.id,
        message: 'Webhook received and processed'
      })
    } catch (error) {
      console.error(`[Webhook Trigger] ${trigger.id} error:`, error)
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      )
    }
  })
}

// Handle webhook trigger event
async function handleWebhookTrigger(trigger: Trigger, event: TriggerEvent): Promise<void> {
  console.log(`[Webhook Trigger] ${trigger.name} triggered from ${event.metadata?.ip}`)
  
  // Execute associated chains
  const results = []
  for (const chainId of trigger.chainIds) {
    try {
      const result = await executeChain(chainId, {
        ...event.data,
        triggerType: 'webhook',
        triggerName: trigger.name,
        triggeredAt: event.timestamp,
        webhookEventId: event.id,
      })
      
      results.push({ chainId, status: result.status })
      console.log(`[Webhook Trigger] Chain ${chainId} executed:`, result.status)
    } catch (error) {
      results.push({ chainId, status: 'failed', error })
      console.error(`[Webhook Trigger] Chain ${chainId} failed:`, error)
    }
  }

  // Update trigger stats
  trigger.lastTriggeredAt = event.timestamp
  trigger.triggerCount++
  triggerRegistry.updateTrigger(trigger)

  // Store webhook execution result in event data
  event.data.chainResults = results
}

// Stop/unregister a webhook trigger
export function stopWebhookTrigger(triggerId: string): void {
  const trigger = triggerRegistry.get(triggerId)
  if (trigger && trigger.type === 'webhook') {
    const config = trigger.config as WebhookTriggerConfig
    const path = config.path.startsWith('/') ? config.path : `/${config.path}`
    unregisterWebhookHandler(path)
  }
}

// Generate a secure webhook path
export function generateWebhookPath(prefix = 'hook'): string {
  const random = Math.random().toString(36).substring(2, 15)
  const timestamp = Date.now().toString(36)
  return `${prefix}-${timestamp}-${random}`
}

// Generate a webhook secret
export function generateWebhookSecret(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

// Common webhook presets
export const webhookPresets = [
  { name: 'GitHub Push', event: 'push', provider: 'github' },
  { name: 'GitLab Merge Request', event: 'merge_request', provider: 'gitlab' },
  { name: 'Slack Event', event: 'event_callback', provider: 'slack' },
  { name: 'Stripe Payment', event: 'payment_intent.succeeded', provider: 'stripe' },
  { name: 'Custom JSON', event: 'custom', provider: 'generic' },
]

// Webhook verification helpers
export async function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    )
    
    const expectedSig = 'sha256=' + Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    
    return signature === expectedSig
  } catch {
    return false
  }
}
