// Actions system entry point for Hephaestus

export * from './types'

// Import all actions to register them
import './email'
import './telegram'
import './slack'
import './notion'
import './calendar'
import './trello'
import './rss'
import './scrape'
import './http-request'

// Re-export action registry
import { actionRegistry } from './types'
export { actionRegistry }

// Helper function to execute an action by ID
export async function executeAction(
  actionId: string,
  inputs: Record<string, any>,
  context?: import('./types').ActionContext
): Promise<import('./types').ActionResult> {
  const action = actionRegistry.get(actionId)
  
  if (!action) {
    return {
      success: false,
      error: `Action '${actionId}' not found`
    }
  }

  // Validate required inputs
  for (const input of action.inputs) {
    if (input.required && (inputs[input.name] === undefined || inputs[input.name] === '')) {
      return {
        success: false,
        error: `Missing required input: ${input.name} (${input.description})`
      }
    }
  }

  // Set defaults for optional inputs
  const finalInputs = { ...inputs }
  for (const input of action.inputs) {
    if (finalInputs[input.name] === undefined && input.default !== undefined) {
      finalInputs[input.name] = input.default
    }
  }

  // Execute with timeout
  const timeout = action.config.timeoutMs || 30000
  const startTime = Date.now()
  
  try {
    const result = await Promise.race([
      action.execute(finalInputs, context || {}),
      new Promise<import('./types').ActionResult>((_, reject) => 
        setTimeout(() => reject(new Error(`Action timed out after ${timeout}ms`)), timeout)
      )
    ])
    
    return result
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Action execution failed',
      metadata: { duration: Date.now() - startTime }
    }
  }
}

// Get all actions grouped by category
export function getActionsByCategory() {
  const categories = ['communication', 'productivity', 'monitoring', 'data', 'agent'] as const
  return categories.map(cat => ({
    category: cat,
    actions: actionRegistry.getByCategory(cat)
  })).filter(c => c.actions.length > 0)
}
