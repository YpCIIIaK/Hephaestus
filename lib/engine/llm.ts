import type { DecideRequest, DecideResult, LLMEvent, LLMRequest, LLMResult } from '../types'

// Контракт вызова модели для движков. В браузере его реализует
// lib/client/llm.ts (поток /api/llm), в тестах — заглушка.

export interface LLMCallOptions {
  signal?: AbortSignal
  onEvent?: (e: LLMEvent) => void
  /** Метка для аналитики: какой раздел и какой узел потратил токены */
  meta?: { source: UsageSource; label?: string }
}

export type UsageSource = 'chat' | 'pipeline' | 'debate' | 'scenario' | 'judge' | 'system'

export type LLMCall = (req: LLMRequest, opts?: LLMCallOptions) => Promise<LLMResult>

/** Вызов модели решений; модель выбирается в настройках. Есть только если она включена */
export type DecideCall = (req: Omit<DecideRequest, 'model'>, opts?: Pick<LLMCallOptions, 'signal' | 'meta'>) => Promise<DecideResult>

export class AbortedError extends Error {
  constructor() {
    super('Остановлено')
    this.name = 'AbortError'
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortedError()
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e instanceof AbortedError)
}
