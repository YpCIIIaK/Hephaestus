import type { LLMCall } from '@/lib/engine/llm'
import type { LLMRequest, LLMResult } from '@/lib/types'

export function fakeLLM(answer: (req: LLMRequest, n: number) => string | { error: string }, opts: { delay?: number } = {}) {
  const calls: LLMRequest[] = []
  const llm: LLMCall = async (req, o) => {
    calls.push(req)
    const a = answer(req, calls.length)
    if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay))
    if (o?.signal?.aborted) return { text: '', reasoning: '', tools: [], usage: { promptTokens: 0, completionTokens: 0, cost: 0 }, model: req.model, latencyMs: 0, aborted: true }
    if (typeof a !== 'string') return { text: '', reasoning: '', tools: [], usage: { promptTokens: 0, completionTokens: 0, cost: 0 }, model: req.model, latencyMs: 1, error: a.error } satisfies LLMResult
    o?.onEvent?.({ t: 'text', v: a })
    return { text: a, reasoning: '', tools: [], usage: { promptTokens: 10, completionTokens: 5, cost: 0.001 }, model: req.model, latencyMs: 1 } satisfies LLMResult
  }
  return { llm, calls }
}

export const lastUser = (req: LLMRequest) => [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
export const system = (req: LLMRequest) => req.messages.find((m) => m.role === 'system')?.content ?? ''
