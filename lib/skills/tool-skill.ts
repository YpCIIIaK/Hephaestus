// Tool Skills - Skills that can bind to Actions for API execution
// Allows skills to not just instruct LLM, but actually perform operations

import type { Skill, SkillMetadata } from './types'
import { executeAction } from '../actions'
import type { ActionContext, ActionResult } from '../actions/types'

export interface ToolSkillConfig {
  // Which action this tool skill uses
  actionId: string
  // How to map skill inputs to action inputs
  inputMapping: Record<string, string | ((inputs: any) => any)>
  // Transform action output back to skill result
  outputTransform?: (result: ActionResult) => any
  // Validation before execution
  validateInputs?: (inputs: any) => string | null
}

export interface ToolSkill extends Skill {
  metadata: SkillMetadata & {
    isToolSkill: true
    actionId: string
  }
  config: ToolSkillConfig
  execute: (inputs: any, context?: any) => Promise<ActionResult>
}

// Registry for tool skills
class ToolSkillRegistry {
  private tools = new Map<string, ToolSkill>()

  register(toolSkill: ToolSkill): void {
    this.tools.set(toolSkill.metadata.id, toolSkill)
    console.log(`[ToolSkill] Registered: ${toolSkill.metadata.id} -> ${toolSkill.config.actionId}`)
  }

  get(id: string): ToolSkill | undefined {
    return this.tools.get(id)
  }

  has(id: string): boolean {
    return this.tools.has(id)
  }

  list(): ToolSkill[] {
    return Array.from(this.tools.values())
  }

  listByAction(actionId: string): ToolSkill[] {
    return this.list().filter(t => t.config.actionId === actionId)
  }
}

export const toolSkillRegistry = new ToolSkillRegistry()

export function createToolSkill(
  metadata: Omit<SkillMetadata, 'enabled'> & { id: string },
  content: string,
  config: ToolSkillConfig
): ToolSkill {
  const toolSkill: ToolSkill = {
    metadata: {
      ...metadata,
      enabled: true,
      isToolSkill: true,
      actionId: config.actionId,
    },
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config,
    execute: async (inputs: any, context?: ActionContext): Promise<ActionResult> => {
      if (config.validateInputs) {
        const err = config.validateInputs(inputs)
        if (err) {
          return {
            success: false,
            error: err,
            metadata: { duration: 0 },
          }
        }
      }

      const actionInputs: Record<string, any> = {}
      for (const [actionKey, mapping] of Object.entries(config.inputMapping)) {
        if (typeof mapping === 'function') {
          actionInputs[actionKey] = mapping(inputs)
        } else {
          actionInputs[actionKey] = inputs[mapping] ?? inputs[actionKey]
        }
      }

      const start = Date.now()
      const result = await executeAction(config.actionId, actionInputs, context)
      const duration = Date.now() - start

      if (config.outputTransform && result.success) {
        return {
          ...result,
          data: config.outputTransform(result),
          metadata: {
            ...result.metadata,
            duration,
          },
        }
      }

      return {
        ...result,
        metadata: {
          ...result.metadata,
          duration,
        },
      }
    },
  }

  toolSkillRegistry.register(toolSkill)
  return toolSkill
}

export function createRapidAPIToolSkill(
  id: string,
  name: string,
  description: string,
  rapidApiConfig: {
    endpoint: string
    method?: 'GET' | 'POST'
    host: string
    requiredParams: string[]
    optionalParams?: string[]
    apiKeyEnvVar?: string
  }
): ToolSkill {
  return createToolSkill(
    {
      id,
      name,
      description,
      category: 'api',
    },
    `## ${name}\n\n${description}\n`,
    {
      actionId: 'http_request',
      inputMapping: {
        url: (inputs: any) => {
          const baseUrl = `https://${rapidApiConfig.host}${rapidApiConfig.endpoint}`
          if ((rapidApiConfig.method || 'GET') === 'POST') return baseUrl

          const urlObj = new URL(baseUrl)
          for (const [key, value] of Object.entries(inputs || {})) {
            if (value !== undefined && value !== null && value !== '') {
              urlObj.searchParams.set(key, String(value))
            }
          }
          return urlObj.toString()
        },
        method: rapidApiConfig.method || 'GET',
        headers: (inputs: any) => ({
          'X-RapidAPI-Key':
            inputs?.apiKey ||
            process.env[rapidApiConfig.apiKeyEnvVar || 'RAPIDAPI_KEY'] ||
            '',
          'X-RapidAPI-Host': rapidApiConfig.host,
        }),
        body: (inputs: any) => ((rapidApiConfig.method || 'GET') === 'POST' ? inputs : undefined),
      },
      validateInputs: (inputs: any) => {
        for (const param of rapidApiConfig.requiredParams) {
          if (inputs?.[param] === undefined || inputs?.[param] === null || inputs?.[param] === '') {
            return `Missing required parameter: ${param}`
          }
        }
        return null
      },
      outputTransform: (result: ActionResult) => result.data?.data ?? result.data,
    }
  )
}

export function createWebhookToolSkill(
  id: string,
  name: string,
  description: string,
  webhookConfig: {
    url: string
    method?: 'POST' | 'PUT' | 'PATCH'
    secretHeader?: string
    secretEnvVar?: string
  }
): ToolSkill {
  return createToolSkill(
    {
      id,
      name,
      description,
      category: 'webhook',
    },
    `## ${name}\n\n${description}\n`,
    {
      actionId: 'http_request',
      inputMapping: {
        url: webhookConfig.url,
        method: webhookConfig.method || 'POST',
        headers: (_inputs: any) => {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (webhookConfig.secretHeader && webhookConfig.secretEnvVar) {
            headers[webhookConfig.secretHeader] = process.env[webhookConfig.secretEnvVar] || ''
          }
          return headers
        },
        body: (inputs: any) => inputs,
      },
    }
  )
}
