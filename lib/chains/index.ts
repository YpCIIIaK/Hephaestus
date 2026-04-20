// Chains system entry point for Hephaestus

export * from './types'

import { 
  Chain, 
  ChainExecution, 
  ChainNode, 
  ChainEdge, 
  ChainNodeType,
  ChainStatus,
  Condition,
  chainStorage,
  ChainExecutorOptions 
} from './types'
import { actionRegistry, executeAction } from '../actions'
import { evaluateCondition } from './conditions'

// Active executions tracking
const activeExecutions = new Map<string, ChainExecution>()

// Chain executor class
export class ChainExecutor {
  private chain: Chain
  private execution: ChainExecution
  private options: ChainExecutorOptions
  private aborted = false

  constructor(chain: Chain, options: ChainExecutorOptions = {}) {
    this.chain = chain
    this.options = {
      maxExecutionTime: 300000, // 5 minutes
      maxNodes: 100,
      enableRetries: true,
      debug: false,
      ...options
    }

    this.execution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      chainId: chain.id,
      status: 'idle',
      startedAt: new Date().toISOString(),
      nodeResults: {},
      context: {},
    }
  }

  async execute(initialContext: Record<string, any> = {}): Promise<ChainExecution> {
    this.execution.context = { ...initialContext }
    this.execution.status = 'running'
    
    activeExecutions.set(this.execution.id, this.execution)

    const startTime = Date.now()
    const executionTimeout = setTimeout(() => {
      this.abort('Execution timeout exceeded')
    }, this.options.maxExecutionTime)

    try {
      // Find starting nodes (no incoming edges)
      const incomingEdges = new Set(this.chain.edges.map(e => e.target))
      const startNodes = this.chain.nodes.filter(n => !incomingEdges.has(n.id))

      if (startNodes.length === 0 && this.chain.nodes.length > 0) {
        // If no clear start, use first node
        startNodes.push(this.chain.nodes[0])
      }

      // Execute starting nodes
      for (const node of startNodes) {
        if (this.aborted) break
        await this.executeNode(node)
      }

      // Update final status
      if (this.aborted) {
        this.execution.status = 'cancelled'
      } else {
        const hasErrors = Object.values(this.execution.nodeResults).some(r => !r.success)
        this.execution.status = hasErrors ? 'failed' : 'completed'
      }

      this.execution.completedAt = new Date().toISOString()
      
      // Update chain stats
      this.chain.executionCount++
      this.chain.lastExecutedAt = new Date().toISOString()
      
      return this.execution
    } finally {
      clearTimeout(executionTimeout)
      activeExecutions.delete(this.execution.id)
      
      // Save execution history
      await chainStorage.saveExecution(this.execution)
      await chainStorage.save(this.chain)
    }
  }

  private async executeNode(node: ChainNode): Promise<any> {
    if (this.aborted) return

    const nodeStartTime = Date.now()
    this.execution.currentNodeId = node.id
    
    this.options.onNodeStart?.(node.id, node)

    // Check max nodes
    const executedCount = Object.keys(this.execution.nodeResults).length
    if (executedCount >= (this.options.maxNodes || 100)) {
      this.recordNodeError(node, new Error('Max nodes limit exceeded'))
      return
    }

    try {
      let result: any

      switch (node.type) {
        case 'action':
          result = await this.executeActionNode(node)
          break
        case 'agent':
          result = await this.executeAgentNode(node)
          break
        case 'condition':
          result = await this.executeConditionNode(node)
          break
        case 'delay':
          result = await this.executeDelayNode(node)
          break
        case 'parallel':
          result = await this.executeParallelNode(node)
          break
        case 'loop':
          result = await this.executeLoopNode(node)
          break
        default:
          throw new Error(`Unknown node type: ${node.type}`)
      }

      this.recordNodeSuccess(node, result, nodeStartTime)
      this.options.onNodeComplete?.(node.id, result)

      // Continue to next node
      await this.continueToNextNode(node, result)

      return result
    } catch (error: any) {
      this.recordNodeError(node, error, nodeStartTime)
      this.options.onNodeError?.(node.id, error)

      // Try error handler
      if (node.onError) {
        const errorNode = this.chain.nodes.find(n => n.id === node.onError)
        if (errorNode) {
          this.execution.context.error = error
          await this.executeNode(errorNode)
        }
      }

      throw error
    }
  }

  private async executeActionNode(node: ChainNode): Promise<any> {
    const { actionId, actionInputs = {} } = node.config
    
    if (!actionId) {
      throw new Error('Action node missing actionId')
    }

    // Resolve input values from context
    const resolvedInputs = this.resolveTemplate(actionInputs)

    const result = await executeAction(actionId, resolvedInputs, {
      chainId: this.chain.id,
      previousResults: this.execution.nodeResults,
    })

    if (!result.success) {
      throw new Error(result.error || 'Action failed')
    }

    return result.data
  }

  private async executeAgentNode(node: ChainNode): Promise<any> {
    const { agentConfig = {} } = node.config
    
    // For now, delegate to the executor pipeline
    // This would integrate with the existing agent system
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: agentConfig.modelId || 'openai/gpt-3.5-turbo',
        messages: [
          ...(agentConfig.systemPrompt ? [{ role: 'system', content: agentConfig.systemPrompt }] : []),
          { role: 'user', content: this.execution.context.input || '' }
        ],
        temperature: agentConfig.temperature ?? 0.7,
        maxTokens: agentConfig.maxTokens ?? 1000,
      })
    })

    if (!res.ok) {
      throw new Error(`Agent API error: ${res.statusText}`)
    }

    const data = await res.json()
    return { content: data.content, tokens: data.tokens }
  }

  private async executeConditionNode(node: ChainNode): Promise<any> {
    const { condition, trueBranch, falseBranch } = node.config
    
    if (!condition) {
      throw new Error('Condition node missing condition')
    }

    const result = evaluateCondition(condition, this.execution.context)
    
    // Store result for branching
    this.execution.context[node.id] = result

    // Execute appropriate branch
    const nextNodeId = result ? trueBranch : falseBranch
    if (nextNodeId) {
      const nextNode = this.chain.nodes.find(n => n.id === nextNodeId)
      if (nextNode) {
        await this.executeNode(nextNode)
      }
    }

    return result
  }

  private async executeDelayNode(node: ChainNode): Promise<any> {
    const { delayMs = 1000 } = node.config
    
    return new Promise((resolve) => {
      setTimeout(() => resolve({ delayed: delayMs }), delayMs)
    })
  }

  private async executeParallelNode(node: ChainNode): Promise<any> {
    const { parallelNodes = [] } = node.config
    
    const results = await Promise.all(
      parallelNodes.map(async (nodeId) => {
        const parallelNode = this.chain.nodes.find(n => n.id === nodeId)
        if (!parallelNode) return null
        return this.executeNode(parallelNode)
      })
    )

    return { parallelResults: results }
  }

  private async executeLoopNode(node: ChainNode): Promise<any> {
    const { loopCondition, maxIterations = 10, loopBody } = node.config
    
    if (!loopCondition || !loopBody) {
      throw new Error('Loop node missing loopCondition or loopBody')
    }

    const results = []
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++
      
      // Check condition
      const shouldContinue = evaluateCondition(loopCondition, this.execution.context)
      if (!shouldContinue) break

      // Execute loop body
      const bodyNode = this.chain.nodes.find(n => n.id === loopBody)
      if (bodyNode) {
        const result = await this.executeNode(bodyNode)
        results.push(result)
      }
    }

    return { iterations: iteration, results }
  }

  private async continueToNextNode(currentNode: ChainNode, result: any): Promise<void> {
    // Check for explicit next node
    if (currentNode.nextNodeId) {
      const nextNode = this.chain.nodes.find(n => n.id === currentNode.nextNodeId)
      if (nextNode) {
        await this.executeNode(nextNode)
      }
      return
    }

    // Check for edge connections
    const outgoingEdges = this.chain.edges.filter(e => e.source === currentNode.id)
    
    for (const edge of outgoingEdges) {
      // Check edge condition
      if (edge.condition) {
        const shouldFollow = this.evaluateEdgeCondition(edge.condition, result)
        if (!shouldFollow) continue
      }

      const nextNode = this.chain.nodes.find(n => n.id === edge.target)
      if (nextNode) {
        await this.executeNode(nextNode)
      }
    }
  }

  private evaluateEdgeCondition(condition: string, result: any): boolean {
    // Simple expression evaluation
    // Support: {{result.field}} > 5, {{context.key}} === 'value'
    try {
      const resolved = condition
        .replace(/\{\{result\.([^}]+)\}\}/g, (match, path) => {
          const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], result)
          return JSON.stringify(value)
        })
        .replace(/\{\{context\.([^}]+)\}\}/g, (match, path) => {
          const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], this.execution.context)
          return JSON.stringify(value)
        })

      // eslint-disable-next-line no-eval
      return eval(resolved)
    } catch {
      return false
    }
  }

  private resolveTemplate(obj: any): any {
    if (typeof obj === 'string') {
      return obj
        .replace(/\{\{([^}]+)\}\}/g, (match, path) => {
          const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], this.execution.context)
          return value !== undefined ? String(value) : match
        })
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveTemplate(item))
    }
    if (obj && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, this.resolveTemplate(v)])
      )
    }
    return obj
  }

  private recordNodeSuccess(node: ChainNode, data: any, startTime: number): void {
    this.execution.nodeResults[node.id] = {
      success: true,
      data,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      retryCount: 0,
    }
  }

  private recordNodeError(node: ChainNode, error: Error, startTime?: number): void {
    this.execution.nodeResults[node.id] = {
      success: false,
      error: error.message,
      startedAt: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
      completedAt: new Date().toISOString(),
      retryCount: 0,
    }
  }

  abort(reason?: string): void {
    this.aborted = true
    this.execution.error = reason || 'Aborted by user'
  }
}

// Execute a chain by ID
export async function executeChain(
  chainId: string,
  context?: Record<string, any>,
  options?: ChainExecutorOptions
): Promise<ChainExecution> {
  const chain = await chainStorage.get(chainId)
  
  if (!chain) {
    return {
      id: '',
      chainId,
      status: 'failed',
      startedAt: new Date().toISOString(),
      nodeResults: {},
      context: context || {},
      error: `Chain '${chainId}' not found`
    }
  }

  if (!chain.enabled) {
    return {
      id: '',
      chainId,
      status: 'failed',
      startedAt: new Date().toISOString(),
      nodeResults: {},
      context: context || {},
      error: `Chain '${chainId}' is disabled`
    }
  }

  const executor = new ChainExecutor(chain, options)
  return executor.execute(context)
}

// Get active executions
export function getActiveExecutions(): ChainExecution[] {
  return Array.from(activeExecutions.values())
}

// Abort an active execution
export function abortExecution(executionId: string, reason?: string): boolean {
  const execution = activeExecutions.get(executionId)
  if (!execution) return false
  
  execution.status = 'cancelled'
  execution.error = reason || 'Aborted by user'
  execution.completedAt = new Date().toISOString()
  
  return true
}

// Re-export
export { evaluateCondition } from './conditions'
