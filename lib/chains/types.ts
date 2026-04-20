// Chain system types for Hephaestus

export type ChainNodeType = 'action' | 'agent' | 'condition' | 'delay' | 'parallel' | 'loop'

export interface Condition {
  operator: 'and' | 'or' | 'not'
  conditions?: Condition[]
  field?: string // Field to check (e.g., "previousResult.success")
  operatorType?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'ends_with' | 'exists' | 'empty'
  value?: any
}

export interface ChainNode {
  id: string
  type: ChainNodeType
  name: string
  description?: string
  config: {
    // Action node
    actionId?: string
    actionInputs?: Record<string, any>
    
    // Agent node
    agentConfig?: {
      role?: string
      modelId?: string
      temperature?: number
      maxTokens?: number
      systemPrompt?: string
      skills?: string[]
    }
    
    // Condition node
    condition?: Condition
    trueBranch?: string // Node ID for true
    falseBranch?: string // Node ID for false
    
    // Delay node
    delayMs?: number
    
    // Loop node
    loopCondition?: Condition
    maxIterations?: number
    loopBody?: string // Node ID to loop
    
    // Parallel node
    parallelNodes?: string[] // Node IDs to execute in parallel
  }
  nextNodeId?: string // Default next node
  onError?: string // Error handler node ID
  retryCount?: number
}

export interface ChainEdge {
  id: string
  source: string
  target: string
  condition?: string // Expression for conditional routing
  label?: string
}

export type ChainStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface Chain {
  id: string
  name: string
  description: string
  nodes: ChainNode[]
  edges: ChainEdge[]
  triggerIds: string[] // Associated trigger IDs
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastExecutedAt?: string
  executionCount: number
  averageExecutionTime?: number
}

export interface ChainExecution {
  id: string
  chainId: string
  status: ChainStatus
  startedAt: string
  completedAt?: string
  currentNodeId?: string
  nodeResults: Record<string, {
    success: boolean
    data?: any
    error?: string
    startedAt: string
    completedAt: string
    retryCount: number
  }>
  context: Record<string, any>
  error?: string
}

export interface ChainExecutorOptions {
  maxExecutionTime?: number // ms
  maxNodes?: number
  enableRetries?: boolean
  debug?: boolean
  onNodeStart?: (nodeId: string, node: ChainNode) => void
  onNodeComplete?: (nodeId: string, result: any) => void
  onNodeError?: (nodeId: string, error: Error) => void
}

// Chain storage interface
export interface ChainStorage {
  getAll(): Promise<Chain[]>
  get(id: string): Promise<Chain | null>
  save(chain: Chain): Promise<void>
  delete(id: string): Promise<void>
  getExecutions(chainId: string, limit?: number): Promise<ChainExecution[]>
  saveExecution(execution: ChainExecution): Promise<void>
}

// File-based chain storage implementation
export class FileChainStorage implements ChainStorage {
  private chainsDir: string
  private executionsDir: string

  constructor(chainsDir = './chains', executionsDir = './chains/executions') {
    this.chainsDir = chainsDir
    this.executionsDir = executionsDir
  }

  async getAll(): Promise<Chain[]> {
    if (typeof window !== 'undefined') {
      // Client-side: fetch from API
      const res = await fetch('/api/chains')
      if (!res.ok) return []
      const data = await res.json()
      return data.chains || []
    }
    // Server-side: read from filesystem
    const fs = await import('fs/promises')
    const path = await import('path')
    
    try {
      const files = await fs.readdir(this.chainsDir)
      const chains: Chain[] = []
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.chainsDir, file), 'utf-8')
          chains.push(JSON.parse(content))
        }
      }
      
      return chains
    } catch {
      return []
    }
  }

  async get(id: string): Promise<Chain | null> {
    if (typeof window !== 'undefined') {
      const res = await fetch(`/api/chains/${id}`)
      if (!res.ok) return null
      return res.json()
    }
    // Server-side
    const fs = await import('fs/promises')
    const path = await import('path')
    
    try {
      const content = await fs.readFile(path.join(this.chainsDir, `${id}.json`), 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  async save(chain: Chain): Promise<void> {
    if (typeof window !== 'undefined') {
      await fetch('/api/chains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chain)
      })
      return
    }
    // Server-side
    const fs = await import('fs/promises')
    const path = await import('path')
    
    await fs.mkdir(this.chainsDir, { recursive: true })
    await fs.writeFile(
      path.join(this.chainsDir, `${chain.id}.json`),
      JSON.stringify(chain, null, 2)
    )
  }

  async delete(id: string): Promise<void> {
    if (typeof window !== 'undefined') {
      await fetch(`/api/chains/${id}`, { method: 'DELETE' })
      return
    }
    // Server-side
    const fs = await import('fs/promises')
    const path = await import('path')
    
    try {
      await fs.unlink(path.join(this.chainsDir, `${id}.json`))
    } catch {
      // Ignore errors
    }
  }

  async getExecutions(chainId: string, limit = 50): Promise<ChainExecution[]> {
    if (typeof window !== 'undefined') {
      const res = await fetch(`/api/chains/${chainId}/executions?limit=${limit}`)
      if (!res.ok) return []
      return res.json()
    }
    return []
  }

  async saveExecution(execution: ChainExecution): Promise<void> {
    if (typeof window !== 'undefined') {
      await fetch(`/api/chains/${execution.chainId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(execution)
      })
    }
  }
}

// Global chain storage instance
export const chainStorage = new FileChainStorage()
