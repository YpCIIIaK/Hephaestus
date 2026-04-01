import { ArenaNode, ArenaEdge, NodeStatus } from './types'
import { useArenaStore } from './store'
import { getTokenCount } from './tokenizer'
import { splitForRAG, estimateTokens } from './text-splitter'
import { SimpleVectorStore, getVectorStore } from './simple-vector-store'

// Per-node timeout — if a model hangs, we skip it and continue the pipeline
const NODE_TIMEOUT_MS = 300_000 // 300 seconds (5 minutes)

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s — "${label}" did not respond in time`)), ms)
    )
  ])
}

export function getTopologicalOrder(nodes: ArenaNode[], edges: ArenaEdge[]): string[] {
  const inDegree: Record<string, number> = {}
  const adjList: Record<string, string[]> = {}

  nodes.forEach(n => {
    inDegree[n.id] = 0
    adjList[n.id] = []
  })

  edges.forEach(e => {
    // Only count edges that exist between the provided nodes
    if (inDegree[e.target] !== undefined && inDegree[e.source] !== undefined) {
      inDegree[e.target]++
      adjList[e.source].push(e.target)
    }
  })

  const queue: string[] = Object.keys(inDegree).filter(id => inDegree[id] === 0)
  const topoOrder: string[] = []

  // Ensure queue is sorted by node level/type for consistency within layers
  // This helps make parallel nodes appear in a predictable order
  const sortQueue = (q: string[]) => {
    return q.sort((a, b) => {
      const nodeA = nodes.find(n => n.id === a)!
      const nodeB = nodes.find(n => n.id === b)!
      // Order: prompt -> search -> model -> validator -> aggregator -> code
      const typeOrder = { prompt: 0, search: 1, model: 2, validator: 3, aggregator: 4, code: 5 }
      if (typeOrder[nodeA.type as keyof typeof typeOrder] !== typeOrder[nodeB.type as keyof typeof typeOrder]) {
        return typeOrder[nodeA.type as keyof typeof typeOrder] - typeOrder[nodeB.type as keyof typeof typeOrder]
      }
      return nodeA.data.label.localeCompare(nodeB.data.label)
    })
  }

  let currentQueue = sortQueue(queue)

  while (currentQueue.length > 0) {
    const nextQueue: string[] = []
    for (const nodeId of currentQueue) {
      topoOrder.push(nodeId)
      const dependents = adjList[nodeId] || []
      for (const dep of dependents) {
        inDegree[dep]--
        if (inDegree[dep] === 0) {
          nextQueue.push(dep)
        }
      }
    }
    currentQueue = sortQueue(nextQueue)
  }

  return topoOrder
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Helper: Read file with optional Smart Read mode
async function readFileWithSmartMode(
  filePath: string,
  isSmartRead: boolean,
  smartQuery: string | undefined,
  maxLines: number | undefined,
  context: string,
  signal?: AbortSignal
): Promise<string> {
  // Classic mode: read whole file
  if (!isSmartRead) {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
      signal: signal || undefined
    })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error || 'Failed to read file')
    }
    const data = await res.json()
    return data.content
  }

  // Smart Read mode
  console.log(`[SmartRead] Planning read for: ${filePath}`)
  
  // Get file stats
  const statsRes = await fetch(`/api/files/read-lines?path=${encodeURIComponent(filePath)}`, {
    signal: signal || undefined
  })
  if (!statsRes.ok) {
    throw new Error('Failed to get file stats')
  }
  const fileStats = await statsRes.json()
  
  // Small file: read whole
  if (fileStats.totalLines <= 500) {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
      signal: signal || undefined
    })
    if (!res.ok) throw new Error('Failed to read file')
    const data = await res.json()
    return `[Smart Read: Small file, reading complete]\n\n${data.content}`
  }

  // Large file: AI plans line ranges
  const query = smartQuery?.replace(/\{\{input\}\}/g, context) || 
    `Analyze this file and identify the most relevant sections for: "${context.slice(0, 200)}"`
  const targetLines = maxLines || 500
  
  const planningPrompt = `You are an expert code analyzer. Given a file structure and a query, decide which line ranges to read.

File: ${filePath}
Total Lines: ${fileStats.totalLines}
Line Index (first 100 chars per line):
${fileStats.lineIndex.slice(0, 100).map((l: any) => `Line ${l.line}: ${l.preview}`).join('\n')}
${fileStats.hasMore ? '\n... (file continues) ...' : ''}

User Query: "${query}"

Output ONLY a JSON array of line ranges: [{"start": 1, "end": 50}, ...]
Rules:
- Read approximately ${targetLines} lines total
- Focus on imports, function definitions, error handling, code related to the query
- Skip boilerplate, comments, empty lines unless relevant

JSON ranges:`

  const planRes = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: signal || undefined,
    body: JSON.stringify({
      modelId: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        { role: 'system', content: 'Output only valid JSON arrays of line ranges.' },
        { role: 'user', content: planningPrompt }
      ],
      temperature: 0.1,
      maxTokens: 500
    })
  })
  
  if (!planRes.ok) throw new Error('Failed to plan line ranges')
  
  const planData = await planRes.json()
  const content = planData.content || planData.choices?.[0]?.message?.content || ''
  
  let lineRanges: Array<{start: number, end: number}> = []
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      lineRanges = JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.warn('[SmartRead] Failed to parse AI ranges, using fallback')
    lineRanges = [{ start: 1, end: Math.min(500, fileStats.totalLines) }]
  }
  
  // Validate ranges
  lineRanges = lineRanges
    .filter((r: any) => r.start > 0 && r.end > r.start)
    .map((r: any) => ({
      start: Math.max(1, Math.min(r.start, fileStats.totalLines)),
      end: Math.max(1, Math.min(r.end, fileStats.totalLines))
    }))
    .slice(0, 10)
  
  if (lineRanges.length === 0) {
    lineRanges = [{ start: 1, end: Math.min(targetLines, fileStats.totalLines) }]
  }
  
  console.log(`[SmartRead] Reading ${lineRanges.length} ranges:`, lineRanges)
  
  // Read selected ranges
  const readRes = await fetch('/api/files/read-lines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, lineRanges }),
    signal: signal || undefined
  })
  
  if (!readRes.ok) throw new Error('Failed to read line ranges')
  const readData = await readRes.json()
  
  return `[Smart Read: ${readData.totalLines} total lines, read ${readData.readLines} lines in ${readData.ranges?.length || 1} ranges]\n\nQuery: "${query}"\n\n--- SELECTED CONTENT ---\n\n${readData.content}`
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: any
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.ok) return res
      
      // If 429 (Too Many Requests), retry with exponential backoff
      if (res.status === 429) {
        const backoff = Math.pow(2, i) * 1000 + Math.random() * 500
        console.warn(`Rate limited (429). Retrying in ${Math.round(backoff)}ms... (Attempt ${i + 1}/${maxRetries})`)
        await sleep(backoff)
        continue
      }
      
      // Other non-ok responses
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error || `HTTP Error ${res.status}`)
    } catch (err: any) {
      lastError = err
      if (err.name === 'AbortError') throw err // Don't retry timeouts/aborts
      
      const backoff = Math.pow(2, i) * 1000
      console.warn(`Network error/failure. Retrying in ${backoff}ms... (${err.message})`)
      await sleep(backoff)
    }
  }
  throw lastError || new Error('Fetch failed after retries')
}

const COST_FALLBACK_PER_1K_TOKENS = 0.002

// Helper: Compress long contexts using a cheap model
async function compressContext(
  context: string,
  compressionModel: string,
  targetRatio: number,
  signal?: AbortSignal
): Promise<{ compressed: string; originalTokens: number; compressedTokens: number }> {
  const COMPRESSION_PROMPT = `You are a context compression expert. Your task is to summarize and compress the following text while preserving ALL key information, facts, names, dates, and relationships.

Rules:
- Keep all specific details (names, numbers, dates, technical terms)
- Preserve the structure and meaning
- Remove redundant words and filler phrases
- Output only the compressed text, no explanations

Original text to compress:
---
{context}
---

Compressed version:`

  console.log(`[Compression] Starting compression with ${compressionModel}, target ratio: ${targetRatio}`)
  
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: signal || undefined,
    body: JSON.stringify({
      modelId: compressionModel,
      messages: [
        { role: 'system', content: 'You are a precise context compressor. Keep all facts, remove only fluff.' },
        { role: 'user', content: COMPRESSION_PROMPT.replace('{context}', context) }
      ],
      temperature: 0.1,
      maxTokens: Math.ceil(context.length * 0.6) // Estimate: assume ~2 chars per token
    })
  })

  if (!res.ok) {
    console.warn('[Compression] Failed, returning original context')
    return { compressed: context, originalTokens: getTokenCount(context), compressedTokens: getTokenCount(context) }
  }

  const data = await res.json()
  const compressed = data.content || data.choices?.[0]?.message?.content || context

  // Clean up the response - remove any markdown formatting the model might add
  const cleanCompressed = compressed
    .replace(/^```[\s\S]*?\n/, '') // Remove opening code block
    .replace(/```$/, '') // Remove closing code block
    .replace(/^[\s\S]*?Compressed version:[\s]*/i, '') // Remove the prompt echo if present
    .trim()

  const originalTokens = getTokenCount(context)
  const compressedTokens = getTokenCount(cleanCompressed)
  
  console.log(`[Compression] Original: ${originalTokens} tokens → Compressed: ${compressedTokens} tokens (${Math.round((1 - compressedTokens/originalTokens) * 100)}% reduction)`)

  return { compressed: cleanCompressed, originalTokens, compressedTokens }
}

// Helper: Smart Fallback Chain - try primary model, then fallbacks on timeout or error
async function fetchWithSmartFallback(
  primaryModelId: string,
  fallbackModels: string[],
  fallbackTimeoutMs: number,
  fallbackMode: 'timeout' | 'on_error',
  requestBody: object,
  signal?: AbortSignal,
  onStatusUpdate?: (status: string, modelId: string) => void
): Promise<{ response: Response; usedModelId: string; isFallback: boolean }> {
  const allModels = [primaryModelId, ...fallbackModels]
  
  for (let i = 0; i < allModels.length; i++) {
    const modelId = allModels[i]
    const isFallback = i > 0
    
    if (isFallback && onStatusUpdate) {
      const reason = fallbackMode === 'on_error' ? 'Primary failed' : 'Primary timed out'
      onStatusUpdate(`${reason}, trying fallback ${i}...`, modelId)
    }
    
    console.log(`[Fallback] Trying model ${i + 1}/${allModels.length}: ${modelId}${isFallback ? ' (fallback)' : ''} [mode: ${fallbackMode}]`)
    
    // Create a timeout specifically for this model attempt (only in timeout mode)
    const modelController = new AbortController()
    let timeoutId: NodeJS.Timeout | null = null
    
    if (fallbackMode === 'timeout') {
      // In timeout mode: abort if taking too long
      timeoutId = setTimeout(() => modelController.abort(), fallbackTimeoutMs)
    }
    // In on_error mode: no timeout, let the model take as long as it needs
    
    // Merge the external signal with our timeout
    const abortHandler = () => modelController.abort()
    signal?.addEventListener('abort', abortHandler)
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: modelController.signal,
        body: JSON.stringify({ ...requestBody, modelId })
      })
      
      if (timeoutId) clearTimeout(timeoutId)
      
      if (res.ok) {
        console.log(`[Fallback] Success with ${modelId}${isFallback ? ' (fallback)' : ''}`)
        return { response: res, usedModelId: modelId, isFallback }
      }
      
      // If we get a non-ok response, try next fallback
      console.warn(`[Fallback] Model ${modelId} returned ${res.status}, trying next...`)
      
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId)
      
      if (err.name === 'AbortError') {
        if (fallbackMode === 'timeout') {
          console.log(`[Fallback] Model ${modelId} timed out after ${fallbackTimeoutMs}ms`)
        } else {
          // In on_error mode, AbortError means external abort (user cancelled)
          console.log(`[Fallback] Request aborted externally`)
          throw err // Re-throw external abort
        }
      } else {
        console.warn(`[Fallback] Model ${modelId} failed:`, err.message)
        // Network errors always trigger fallback regardless of mode
      }
    } finally {
      signal?.removeEventListener('abort', abortHandler)
    }
  }
  
  throw new Error(`All models failed: ${allModels.join(' → ')}`)
}

function allocatePromptCompletionCosts(promptTokens: number, completionTokens: number, modelId: string) {
  const totalTokens = promptTokens + completionTokens
  if (totalTokens <= 0) {
    return { promptCost: 0, completionCost: 0, totalCost: 0 }
  }

  // If pricing is available in the store we use it; otherwise we fall back to the same heuristic
  // currently used in `lib/store.ts`.
  const modelInStore = useArenaStore.getState().models.find(m => m.id === modelId)
  if (modelInStore?.pricing) {
    const tokenCost = (promptTokens * modelInStore.pricing.prompt) + (completionTokens * modelInStore.pricing.completion)
    const totalCost = tokenCost + modelInStore.pricing.request
    const promptShare = promptTokens / totalTokens
    const promptCost = totalCost * promptShare
    return { promptCost, completionCost: totalCost - promptCost, totalCost }
  }

  const totalCost = (totalTokens / 1000) * COST_FALLBACK_PER_1K_TOKENS
  const promptShare = promptTokens / totalTokens
  const promptCost = totalCost * promptShare
  return { promptCost, completionCost: totalCost - promptCost, totalCost }
}

export async function executePipeline(
  nodes: ArenaNode[],
  edges: ArenaEdge[],
  initialInput: string,
  onNodeUpdate: (
    nodeId: string,
    status: string,
    result?: string,
    tokens?: number,
    latencyMs?: number,
    promptTokens?: number,
    completionTokens?: number,
    promptCost?: number,
    completionCost?: number,
    startTime?: number,
    endTime?: number
  ) => void,
  initialResults: Record<string, string> = {},
  signal?: AbortSignal,
  options: { isDryRun?: boolean } = {}
) {
  if (signal?.aborted) throw new Error('Aborted')
  // Reset nodes to idle UNLESS they already have shared results
  for (const node of nodes) {
    if (initialResults[node.id] && !initialResults[node.id].startsWith('[Error]')) {
      onNodeUpdate(node.id, 'completed', initialResults[node.id])
    } else {
      onNodeUpdate(node.id, 'idle', undefined)
    }
  }

  const inDegree: Record<string, number> = {}
  const adjList: Record<string, string[]> = {}

  nodes.forEach(n => {
    inDegree[n.id] = 0
    adjList[n.id] = []
  })

  edges.forEach(e => {
    inDegree[e.target] = (inDegree[e.target] || 0) + 1
    if (!adjList[e.source]) adjList[e.source] = []
    adjList[e.source].push(e.target)
  })

  const queue: string[] = Object.keys(inDegree).filter(id => inDegree[id] === 0)

  const nodeResults: Record<string, string> = { ...initialResults }
  const topoOrder: string[] = []

  // 1. DISCOVER GLOBAL KNOWLEDGE (Live Scan from Canvas + Manual List)
  const { nodes: liveNodes, knowledgeBase: manualKB } = useArenaStore.getState()
  
  // Map file paths to their node data for Smart Read support
  const fileNodeMap = new Map<string, ArenaNode>()
  liveNodes
    .filter(n => n.type === 'file' && n.data.isGlobal && n.data.filePath)
    .forEach(n => fileNodeMap.set(n.data.filePath as string, n))
  
  const discoveredPaths = Array.from(fileNodeMap.keys())

  const combinedKB = Array.from(new Set([
    ...manualKB.map(p => p.replace(/\\/g, '/')),
    ...discoveredPaths.map(p => p.replace(/\\/g, '/'))
  ]))

  // RAG: Use BM25 search to find relevant chunks instead of loading entire files
  let globalKnowledgeContent = ''
  const store = getVectorStore()
  const indexedDocs = store.getStats().indexedDocuments
  
  if (combinedKB.length > 0) {
    console.log(`[PIPELINE] Knowledge Discovery: Found ${combinedKB.length} unique files (Live: ${discoveredPaths.length}, Manual: ${manualKB.length})`)
    
    // Check which files are indexed for RAG
    const indexedPaths = indexedDocs.map(d => d.source)
    const ragCandidates = combinedKB.filter(p => indexedPaths.includes(p.split('/').pop() || p))
    
    if (ragCandidates.length > 0) {
      // Use RAG search - find relevant chunks for the input query
      console.log(`[PIPELINE] Using RAG search for ${ragCandidates.length} indexed files`)
      const searchResults = store.search(initialInput, 3)
      
      if (searchResults.length > 0) {
        const ragContexts = searchResults.map(r => 
          `--- ${r.chunk.metadata.source} (L${r.chunk.startLine}-${r.chunk.endLine}, score: ${r.score.toFixed(2)}) ---\n${r.chunk.text}`
        )
        globalKnowledgeContent = ragContexts.join('\n\n')
        console.log(`[PIPELINE] RAG Results: ${searchResults.length} chunks found`)
      } else {
        console.log(`[PIPELINE] RAG search returned no results, falling back to full file load`)
        // Fallback to loading from non-indexed or all files
        globalKnowledgeContent = await loadFullKnowledge(combinedKB, fileNodeMap, initialInput, signal)
      }
    } else {
      // No indexed files, fall back to loading full files
      console.log(`[PIPELINE] No indexed files for RAG, loading full files`)
      globalKnowledgeContent = await loadFullKnowledge(combinedKB, fileNodeMap, initialInput, signal)
    }
  } else {
    console.log(`[PIPELINE] Knowledge Base is Empty. (Ensure 'Global Knowledge' is toggled on a File node)`)
  }

  // Helper: Load full knowledge (fallback when RAG returns nothing)
  async function loadFullKnowledge(
    paths: string[], 
    fileNodes: Map<string, ArenaNode>, 
    query: string, 
    sig?: AbortSignal
  ): Promise<string> {
    const fileContents = await Promise.all(
      paths.map(async (filePath) => {
        const fileNode = fileNodes.get(filePath)
        const isSmartRead = fileNode?.data.isSmartRead ?? false
        const smartQuery = fileNode?.data.smartQuery
        const maxLines = fileNode?.data.maxLines
        
        try {
          const content = await readFileWithSmartMode(
            filePath,
            isSmartRead,
            smartQuery,
            maxLines,
            query,
            sig
          )
          console.log(`[PIPELINE] KB Success: ${filePath} (${content.length} chars${isSmartRead ? ', Smart Read' : ''})`)
          return `--- FILE START: ${filePath} ---\n${content}\n--- FILE END: ${filePath} ---`
        } catch (e: any) {
          console.warn(`[PIPELINE] KB Warning: ${filePath}`, e.message)
          return null
        }
      })
    )
    const result = fileContents.filter(Boolean).join('\n\n')
    if (paths.length > 0 && !result) {
      console.error('[PIPELINE] CRITICAL: Knowledge Discovery found files but ALL failed to load.')
    } else {
      console.log(`[PIPELINE] Knowledge Base Loaded (${result.length} chars total)`)
    }
    return result
  }

  while (queue.length > 0) {
    const currentLayer = [...queue]
    queue.length = 0

    const layerPromises = currentLayer.map((nodeId, idx) => {
      if (signal?.aborted) return

      topoOrder.push(nodeId)
      
      const node = nodes.find(n => n.id === nodeId)!
      const { sessionCost, maxSessionBudget } = useArenaStore.getState()
      
      if (sessionCost >= maxSessionBudget) {
        console.warn(`[PIPELINE] Budget Exceeded: $${sessionCost.toFixed(3)} / $${maxSessionBudget.toFixed(2)}`)
        onNodeUpdate(nodeId, 'error', `Budget Exceeded ($${sessionCost.toFixed(3)}). Increase limit in Sidebar.`)
        return Promise.reject(new Error('BUDGET_EXCEEDED'))
      }

      onNodeUpdate(nodeId, 'running')
      console.log(`[PIPELINE] Starting Node: ${node.data.label} (${node.type})`, { id: nodeId })

      const nodeWork = async () => {
        // Stagger parallel nodes to avoid instant rate limits
        if (currentLayer.length > 1) {
          await sleep(idx * 300)
        }

        if (signal?.aborted) throw new Error('Aborted')
        const nodeWorkStart = Date.now()
        let result = ''
        let nodeStartTime = Date.now() // Record actual start time for Gantt

        const incomingEdges = edges.filter(e => e.target === nodeId)
        const inputs = incomingEdges.map(e => nodeResults[e.source] || '')
        let context = inputs.length > 0 ? inputs.join('\n\n') : initialInput
        
        // Inject Global Knowledge by default if not manually placed
        let finalContext = context;
        if (globalKnowledgeContent && !node.data.prompt?.includes('{{global}}')) {
          finalContext = `### GLOBAL KNOWLEDGE BASE ###\n${globalKnowledgeContent}\n\n### USER INPUT/CONTEXT ###\n${context}`;
        }

        console.log(`[PIPELINE] Node Input Context (${node.data.label}):`, finalContext.substring(0, 500) + (finalContext.length > 500 ? '...' : ''))

        if (node.type === 'prompt') {
          let promptTpl = node.data.prompt || '{{input}}'
          
          // Auto-append {{input}} if the user forgot to include the placeholder
          if (typeof promptTpl === 'string' && !promptTpl.includes('{{input}}') && !promptTpl.includes('{{context}}')) {
            promptTpl = `${promptTpl.trim()}\n\n{{input}}`
          }

          // Template replacements
          result = promptTpl
            .replace(/{{input}}/g, context)
            .replace(/{{context}}/g, context)
            .replace(/{{global}}/g, globalKnowledgeContent || '')

          const nodeEndTime = Date.now()
          onNodeUpdate(nodeId, 'completed', result, 0, nodeEndTime - nodeWorkStart, undefined, undefined, undefined, undefined, nodeStartTime, nodeEndTime)
        }
        else if (node.type === 'model') {
          const modelId = node.data.model?.id || 'openai/gpt-3.5-turbo'
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), NODE_TIMEOUT_MS)

          const modelContent = node.data.prompt 
            ? (node.data.prompt as string)
                .replace(/{{input}}/g, context)
                .replace(/{{global}}/g, globalKnowledgeContent)
            : finalContext;

          // Context Compression: Check if compression is enabled and context exceeds threshold
          let finalModelContent = modelContent
          let compressionApplied = false
          let compressionStats = null
          
          if (node.data.contextCompression?.enabled && !options.isDryRun) {
            const systemPrompt = node.data.model?.systemPrompt || ''
            const promptText = systemPrompt ? `${systemPrompt}\n\n${modelContent}` : modelContent
            const promptTokens = getTokenCount(promptText)
            const threshold = node.data.contextCompression.thresholdTokens ?? 1000
            
            if (promptTokens > threshold) {
              console.log(`[PIPELINE] Context exceeds threshold (${promptTokens} > ${threshold}), compressing...`)
              onNodeUpdate(nodeId, 'running', `Compressing context: ${promptTokens} tokens...`, 0)
              
              const compressionModel = node.data.contextCompression.modelId ?? 'google/gemma-2-2b-it:free'
              const targetRatio = node.data.contextCompression.targetRatio ?? 0.5
              
              try {
                compressionStats = await compressContext(
                  modelContent,
                  compressionModel,
                  targetRatio,
                  signal
                )
                
                if (compressionStats.compressedTokens < compressionStats.originalTokens * 0.9) {
                  finalModelContent = `[Context Compressed: ${compressionStats.originalTokens} → ${compressionStats.compressedTokens} tokens (${Math.round((1 - compressionStats.compressedTokens/compressionStats.originalTokens) * 100)}% smaller)]\n\n${compressionStats.compressed}`
                  compressionApplied = true
                  console.log(`[PIPELINE] Compression successful: ${compressionStats.originalTokens} → ${compressionStats.compressedTokens} tokens`)
                } else {
                  console.log(`[PIPELINE] Compression insufficient, using original`)
                }
              } catch (e) {
                console.warn(`[PIPELINE] Compression failed, using original:`, e)
              }
            }
          }

          const systemPrompt = node.data.model?.systemPrompt || ''
          // Token count is approximate: we tokenize the concatenation of system+user message content.
          // This matches how we already estimate tokens elsewhere, but now splits prompt vs completion.
          const promptText = systemPrompt ? `${systemPrompt}\n\n${finalModelContent}` : finalModelContent
          const promptTokens = getTokenCount(promptText, modelId)

          if (options.isDryRun) {
            const systemPromptForPreview = systemPrompt ? `[SYSTEM]\n${systemPrompt}\n\n` : ''
            result = `--- DRY RUN (API Bypassed) ---\n\n${systemPromptForPreview}[USER]\n${modelContent}`
            console.log(`[PIPELINE] Dry Run Model: ${node.data.label}`, { length: result.length })

            const completionTokens = 0
            const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, modelId)
            const nodeEndTime = Date.now()
            onNodeUpdate(
              nodeId,
              'completed',
              result,
              completionTokens,
              nodeEndTime - nodeWorkStart,
              promptTokens,
              completionTokens,
              promptCost,
              completionCost,
              nodeStartTime,
              nodeEndTime
            )
            nodeResults[nodeId] = result
            return { nodeId }
          }

          // Check if fallback chain is configured
          const fallbackModels = node.data.model?.fallbackModels
          const fallbackTimeoutMs = node.data.model?.fallbackTimeoutMs ?? 5000
          const hasFallbackChain = fallbackModels && fallbackModels.length > 0

          let res: Response
          let usedModelId = modelId
          let isFallback = false

          if (hasFallbackChain && !options.isDryRun) {
            // Use smart fallback chain
            const fallbackMode = node.data.model?.fallbackMode ?? 'timeout'
            const fallbackResult = await fetchWithSmartFallback(
              modelId,
              fallbackModels,
              fallbackTimeoutMs,
              fallbackMode,
              {
                messages: [
                  ...(node.data.model?.systemPrompt ? [{ role: 'system', content: node.data.model.systemPrompt }] : []),
                  { role: 'user', content: finalModelContent }
                ],
                temperature: node.data.model?.temperature,
                maxTokens: node.data.model?.maxTokens,
                webSearch: node.data.model?.webSearch
              },
              signal,
              (status: string, tryingModelId: string) => {
                onNodeUpdate(nodeId, 'running', `[${status}] ${tryingModelId}`, 0)
              }
            )
            res = fallbackResult.response
            usedModelId = fallbackResult.usedModelId
            isFallback = fallbackResult.isFallback
          } else {
            // Use standard fetch with retry
            res = await fetchWithRetry('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                modelId,
                messages: [
                  ...(node.data.model?.systemPrompt ? [{ role: 'system', content: node.data.model.systemPrompt }] : []),
                  { role: 'user', content: finalModelContent }
                ],
                temperature: node.data.model?.temperature,
                maxTokens: node.data.model?.maxTokens,
                webSearch: node.data.model?.webSearch
              })
            })
          }

          if (!res.body) { clearTimeout(timeoutId); throw new Error('No body') }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let text = ''
          let lastUpdate = 0
          const THROTTLE_MS = 100 // Update UI at most every 100ms per node

          try {
            while (true) {
              if (signal?.aborted) {
                reader.cancel()
                throw new Error('Aborted')
              }
              const { value, done } = await reader.read()
              if (done) break
              text += decoder.decode(value, { stream: true })
              
              const now = Date.now()
              if (now - lastUpdate > THROTTLE_MS) {
                onNodeUpdate(nodeId, 'running', text, Math.ceil(text.length / 3.5))
                lastUpdate = now
              }
            }
          } catch (err: any) {
            if (text.length > 50) {
              console.warn(`Streaming interrupted for ${nodeId}, returning partial results`, err)
              text += '\n\n[Note: Connection interrupted. This response is incomplete.]'
            } else {
              throw err
            }
          } finally {
            clearTimeout(timeoutId)
            reader.releaseLock()
          }
          result = text

          // Check if result contains error indicators
          const hasErrorIndicator = result.includes('[Error]') || result.includes('[Tool execution failed]') || result.includes('CRITICAL ERROR')
          const completionTokens = getTokenCount(result, usedModelId)
          const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, usedModelId)
          console.log(`[PIPELINE] Model Complete: ${node.data.label}`, { 
            completionTokens, 
            length: text.length, 
            hasError: hasErrorIndicator,
            usedModelId,
            isFallback 
          })
          
          // Add fallback info to result if applicable
          if (isFallback) {
            const fallbackMode = node.data.model?.fallbackMode ?? 'timeout'
            const reason = fallbackMode === 'on_error' ? 'failed' : `timed out after ${fallbackTimeoutMs}ms`
            result = `[Fallback Used: Primary model ${reason}, switched to ${usedModelId}]\n\n${result}`
          }
          
          const nodeEndTime = Date.now()
          onNodeUpdate(
            nodeId,
            hasErrorIndicator ? 'error' : 'completed',
            result,
            completionTokens,
            nodeEndTime - nodeWorkStart,
            promptTokens,
            completionTokens,
            promptCost,
            completionCost,
            nodeStartTime,
            nodeEndTime
          )
        }
        else if (node.type === 'validator') {
          let systemPrompt = ''
          if (node.data.validationType === 'consensus') {
            systemPrompt = 'Analyze the following outputs from different models. Find the consensus, synthesize the best combined answer, and highlight any major disagreements. Provide a final unified response.'
          } else if (node.data.validationType === 'scoring') {
            systemPrompt = 'Analyze the following outputs from different models. Score each output from 1 to 10 based on quality, accuracy, and completeness. Then clearly identify the highest scoring output and provide its content, along with a brief explanation of why it won.'
          } else {
            systemPrompt = node.data.prompt || 'Review and validate the following outputs according to standard best practices. Provide your final validated and corrected version.'
          }

          const modelId = node.data.model?.id || 'qwen/qwen3-coder-480b-a35b-instruct:free'
          const systemMsg = node.data.model?.systemPrompt || systemPrompt
          const userMsg = `Outputs to validate:\n\n${inputs.map((inp, i) => `--- OUTPUT ${i+1} ---\n${inp}`).join('\n\n')}`
          const promptText = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg
          const promptTokens = getTokenCount(promptText, modelId)
          console.log(`[PIPELINE] Validator Trace:`, {
            model: modelId,
            inputCount: inputs.length,
            rawInputs: inputs.map(i => i.substring(0, 100) + '...')
          })
          
          const errorCount = inputs.filter(inp => inp.startsWith('[Error]')).length
          if (inputs.length > 0 && errorCount === inputs.length) {
            throw new Error('Skipped: All parent nodes failed.')
          }

          const res = await fetchWithRetry('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: signal || undefined,
            body: JSON.stringify({
              modelId,
              messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: userMsg }
              ],
              temperature: node.data.model?.temperature ?? 0.3,
              maxTokens: node.data.model?.maxTokens ?? 4096,
              webSearch: node.data.model?.webSearch
            })
          })

          if (!res.body) throw new Error('No body')

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let text = ''
          let lastUpdate = 0
          const THROTTLE_MS = 100

          try {
            while (true) {
              if (signal?.aborted) {
                reader.cancel()
                throw new Error('Aborted')
              }
              const { value, done } = await reader.read()
              if (done) break
              text += decoder.decode(value, { stream: true })
              
              const now = Date.now()
              if (now - lastUpdate > THROTTLE_MS) {
                onNodeUpdate(nodeId, 'running', text, Math.ceil(text.length / 3.5), undefined, undefined, undefined, undefined, undefined, nodeStartTime, now)
                lastUpdate = now
              }
            }
          } catch (err: any) {
            if (text.length > 50) {
              console.warn(`Streaming interrupted for validator ${nodeId}, returning partial`, err)
              text += '\n\n[Note: Connection interrupted. This response is incomplete.]'
            } else {
              throw err
            }
          }
          result = text
          console.log(`[PIPELINE] Validator Complete: ${node.data.label}`, { length: text.length })

          // Check if result contains error indicators
          const hasErrorIndicator = result.includes('[Error]') || result.includes('[Tool execution failed]') || result.includes('CRITICAL ERROR')
          const completionTokens = getTokenCount(result, modelId)
          const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, modelId)
          const nodeEndTime = Date.now()
          onNodeUpdate(
            nodeId,
            hasErrorIndicator ? 'error' : 'completed',
            result,
            completionTokens,
            nodeEndTime - nodeWorkStart,
            promptTokens,
            completionTokens,
            promptCost,
            completionCost,
            nodeStartTime,
            nodeEndTime
          )
        }
        else if (node.type === 'file') {
          const filePath = node.data.filePath
          if (!filePath) throw new Error('No file path selected')

          result = await readFileWithSmartMode(
            filePath,
            node.data.isSmartRead ?? false,
            node.data.smartQuery,
            node.data.maxLines,
            context,
            signal
          )
          
          const nodeEndTime = Date.now()
          onNodeUpdate(nodeId, 'completed', result, 0, nodeEndTime - nodeWorkStart, undefined, undefined, undefined, undefined, nodeStartTime, nodeEndTime)
        }
        else if (node.type === 'search') {
          const query = node.data.searchQuery?.replace('{{input}}', context) || context
          const maxResults = node.data.maxResults || 5
          
          const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, maxResults }),
            signal: signal || undefined
          })

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            throw new Error(errData.error || 'Search API error')
          }

          const data = await res.json()
          result = data.results
          const nodeEndTime = Date.now()
          onNodeUpdate(nodeId, 'completed', result, 0, nodeEndTime - nodeWorkStart, undefined, undefined, undefined, undefined, nodeStartTime, nodeEndTime)
        }
        else if (node.type === 'aggregator') {
          const defaultSystem = 'You are an intelligent aggregator. Your task is to collect, beautifully format, and synthesize the following outputs into a cohesive final response.'
          const modelId = node.data.model?.id || 'meta-llama/llama-3.3-70b-instruct:free'
          console.log(`[PIPELINE] Aggregator Trace:`, {
            model: modelId,
            inputCount: inputs.length
          })

          const systemPrompt = node.data.model?.systemPrompt || defaultSystem
          const userMsg = `Outputs to aggregate:\n\n${inputs.map((inp, i) => `--- OUTPUT ${i+1} ---\n${inp}`).join('\n\n')}`
          const promptText = systemPrompt ? `${systemPrompt}\n\n${userMsg}` : userMsg
          const promptTokens = getTokenCount(promptText, modelId)

          const errorCount = inputs.filter(inp => inp.startsWith('[Error]')).length
          if (inputs.length > 0 && errorCount === inputs.length) {
            throw new Error('Skipped: All parent nodes failed.')
          }

          if (options.isDryRun) {
            const completionTokens = 0
            const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, modelId)
            const nodeEndTime = Date.now()
            result = `--- DRY RUN (API Bypassed) ---\n\n[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userMsg}`
            console.log(`[PIPELINE] Dry Run Aggregator: ${node.data.label}`)
            onNodeUpdate(
              nodeId,
              'completed',
              result,
              completionTokens,
              nodeEndTime - nodeWorkStart,
              promptTokens,
              completionTokens,
              promptCost,
              completionCost,
              nodeStartTime,
              nodeEndTime
            )
            nodeResults[nodeId] = result
            return { nodeId }
          }

          const res = await fetchWithRetry('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: signal || undefined,
            body: JSON.stringify({
              modelId,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMsg }
              ],
              temperature: node.data.model?.temperature ?? 0.5,
              maxTokens: node.data.model?.maxTokens ?? 4096,
              webSearch: node.data.model?.webSearch
            })
          })

          if (!res.body) throw new Error('No body')

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let text = ''
          let lastUpdate = 0
          const THROTTLE_MS = 100

          try {
            while (true) {
              if (signal?.aborted) {
                reader.cancel()
                throw new Error('Aborted')
              }
              const { value, done } = await reader.read()
              if (done) break
              text += decoder.decode(value, { stream: true })
              
              const now = Date.now()
              if (now - lastUpdate > THROTTLE_MS) {
                onNodeUpdate(nodeId, 'running', text, Math.ceil(text.length / 3.5), undefined, undefined, undefined, undefined, undefined, nodeStartTime, now)
                lastUpdate = now
              }
            }
          } catch (err: any) {
            if (text.length > 50) {
              console.warn(`Streaming interrupted for aggregator ${nodeId}, returning partial`, err)
              text += '\n\n[Note: Connection interrupted. This response is incomplete.]'
            } else {
              throw err
            }
          }
          result = text
          console.log(`[PIPELINE] Aggregator Complete: ${node.data.label}`, { length: text.length })

          // Check if result contains error indicators
          const hasErrorIndicator = result.includes('[Error]') || result.includes('[Tool execution failed]') || result.includes('CRITICAL ERROR')
          const completionTokens = getTokenCount(result, modelId)
          const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, modelId)
          const nodeEndTime = Date.now()
          onNodeUpdate(
            nodeId,
            hasErrorIndicator ? 'error' : 'completed',
            result,
            completionTokens,
            nodeEndTime - nodeWorkStart,
            promptTokens,
            completionTokens,
            promptCost,
            completionCost,
            nodeStartTime,
            nodeEndTime
          )
        }
        else if (node.type === 'router') {
          const modelId = node.data.model?.id || 'openai/gpt-3.5-turbo'
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), NODE_TIMEOUT_MS)

          const routingPrompt = node.data.routingPrompt || 'Classify the input. Output EXACTLY ONE word.'
          const systemMsg = `You are a strict routing classifier. Output EXACTLY ONE word that matches the requested categories. Do not output any markdown, punctuation, or explanations. Only the word.\n\nInstructions: ${routingPrompt}`
          const promptText = systemMsg ? `${systemMsg}\n\n${context}` : context
          const promptTokens = getTokenCount(promptText, modelId)

          if (options.isDryRun) {
             const completionTokens = 0
             const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, modelId)
             const nodeEndTime = Date.now()
             result = `--- DRY RUN (API Bypassed) ---\n\n[SYSTEM]\n${systemMsg}\n\n[USER]\n${context}`
             onNodeUpdate(
               nodeId,
               'completed',
               result,
               completionTokens,
               nodeEndTime - nodeWorkStart,
               promptTokens,
               completionTokens,
               promptCost,
               completionCost,
               nodeStartTime,
               nodeEndTime
             )
             nodeResults[nodeId] = result
             
             // Activate all paths in dry run so we can inspect downstream nodes
             const routingMap = node.data.routingMap || {}
             const activeEdges = Object.keys(routingMap)
             return { nodeId, activeEdges }
          }

          try {
            const res = await fetchWithRetry('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                modelId,
                messages: [
                  { role: 'system', content: systemMsg },
                  { role: 'user', content: context }
                ],
                temperature: 0.1,
                maxTokens: 50
              })
            })

            if (!res.body) throw new Error('No body')
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let text = ''
            
            while (true) {
              if (signal?.aborted) {
                reader.cancel()
                throw new Error('Aborted')
              }
              const { value, done } = await reader.read()
              if (done) break
              text += decoder.decode(value, { stream: true })
            }
            
            result = text.trim().toUpperCase()
            
            console.log(`[PIPELINE] Router Complete: ${node.data.label} -> Classification: ${result}`)

            const completionTokens = getTokenCount(result, modelId)
            const { promptCost, completionCost } = allocatePromptCompletionCosts(promptTokens, completionTokens, modelId)
            const nodeEndTime = Date.now()
            onNodeUpdate(
              nodeId,
              'completed',
              result,
              completionTokens,
              nodeEndTime - nodeWorkStart,
              promptTokens,
              completionTokens,
              promptCost,
              completionCost,
              nodeStartTime,
              nodeEndTime
            )
          } catch (err: any) {
            clearTimeout(timeoutId)
            throw err
          } finally {
            clearTimeout(timeoutId)
          }
        }
        else if (node.type === 'code') {
          // Code/Editor node - can write or edit files
          const operation = node.data.codeOperation || 'write'
          const filePath = node.data.targetFilePath
          
          if (!filePath) {
            throw new Error('No target file path specified for code node')
          }

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), NODE_TIMEOUT_MS)

          try {
            // If content is provided directly, use it; otherwise use AI to generate
            let fileContent = context
            
            if (node.data.useAI && !options.isDryRun) {
              // Use AI to generate/edit the content
              const modelId = node.data.model?.id || 'qwen/qwen3-coder-480b-a35b-instruct:free'
              const systemPrompt = node.data.model?.systemPrompt || 
                `You are a code expert. ${operation === 'edit' ? 'Edit the following code according to the instructions.' : 'Generate code based on the requirements.'} Output ONLY the code, no explanations.`
              
              const res = await fetchWithRetry('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                  modelId,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: context }
                  ],
                  temperature: node.data.model?.temperature ?? 0.2,
                  maxTokens: node.data.model?.maxTokens ?? 4096
                })
              })

              if (!res.body) throw new Error('No body')
              
              const reader = res.body.getReader()
              const decoder = new TextDecoder()
              let text = ''
              
              while (true) {
                if (signal?.aborted) {
                  reader.cancel()
                  throw new Error('Aborted')
                }
                const { value, done } = await reader.read()
                if (done) break
                text += decoder.decode(value, { stream: true })
              }
              
              fileContent = text.trim()
            }

            if (options.isDryRun) {
              result = `--- DRY RUN (File ${operation}) ---\n\nTarget: ${filePath}\n\n${fileContent.substring(0, 500)}${fileContent.length > 500 ? '...' : ''}`
              onNodeUpdate(nodeId, 'completed', result, 0)
              nodeResults[nodeId] = result
              return { nodeId }
            }

            // Perform the file operation
            const editRes = await fetch('/api/files/edit', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                filePath,
                operation,
                content: fileContent,
                createBackup: true
              })
            })

            const editResult = await editRes.json()

            if (!editResult.success) {
              throw new Error(`File ${operation} failed: ${editResult.error}`)
            }

            result = `[File ${operation} successful: ${filePath}]\n\n${fileContent.substring(0, 500)}${fileContent.length > 500 ? '...' : ''}`
            
            const nodeEndTime = Date.now()
            onNodeUpdate(
              nodeId,
              'completed',
              result,
              0,
              nodeEndTime - nodeWorkStart,
              undefined,
              undefined,
              undefined,
              undefined,
              nodeStartTime,
              nodeEndTime
            )
          } catch (err: any) {
            clearTimeout(timeoutId)
            throw err
          } finally {
            clearTimeout(timeoutId)
          }
        }

        nodeResults[nodeId] = result
        
        let activeEdges: string[] | undefined = undefined
        if (node.type === 'router') {
          const routingMap = node.data.routingMap || {}
          const matchedTargetId = Object.keys(routingMap).find(tId => routingMap[tId] === result)
          activeEdges = matchedTargetId ? [matchedTargetId] : []
        }
        
        return { nodeId, activeEdges }
      }

      // Wrap with timeout — if node hangs, mark error and continue pipeline
      return withTimeout(nodeWork(), NODE_TIMEOUT_MS, node.data.label || nodeId)
        .catch((err: Error) => {
          console.error(`Error/timeout in node ${nodeId}:`, err)
          const msg = err.message || 'Error occurred'
          nodeResults[nodeId] = `[Error] ${msg}`
          onNodeUpdate(nodeId, 'error', `[Error] ${msg}`)
        })
    })

    const layerResults = await Promise.all(layerPromises)

    // Advance queue
    const nextNodes = new Set<string>()
    for (const res of layerResults) {
      if (!res) continue // Aborted or error
      const { nodeId, activeEdges } = res
      
      const dependents = adjList[nodeId] || []
      for (const dep of dependents) {
        // If it's a router, we ONLY trigger the specific matched edge
        // Unmatched edges are effectively dead (inDegree never reaches 0, so they don't execute)
        if (activeEdges !== undefined && !activeEdges.includes(dep)) {
           // Skip this dependent visually
           onNodeUpdate(dep, 'skipped')
           // We do NOT decrement its inDegree to 0 or push it to nextNodes!
           // Anyone downstream from this skipped node will also stall cleanly.
           continue
        }

        inDegree[dep]--
        if (inDegree[dep] === 0) {
          nextNodes.add(dep)
        }
      }
    }
    queue.push(...Array.from(nextNodes))
  }

  return { results: nodeResults, topoOrder }
}
