'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UsageSource } from '../engine/llm'
import { dayKey } from '../utils'
import { persistStorage } from './storage'
import type { SubscriptionLimits } from '../types'

export interface UsageEvent {
  id: string
  ts: number
  model: string
  source: UsageSource
  label?: string
  promptTokens: number
  completionTokens: number
  cost: number | null
  latencyMs: number
  ok: boolean
  error?: string
}

const MAX_EVENTS = 20_000

/** Расходы ключа по данным OpenRouter (сутки по UTC, неделя, месяц) */
export interface OpenRouterSpend {
  daily: number
  weekly: number
  monthly: number
  total: number
  limit: number | null
  remaining: number | null
  balance?: number | null
  fetchedAt: number
}

interface UsageStore {
  events: UsageEvent[]
  add: (e: UsageEvent) => void
  clear: () => void
  openrouter: OpenRouterSpend | null
  /** Лимиты включённых подписок — по последним событиям их CLI */
  subscriptions: SubscriptionLimits[]
  /** Подтянуть расходы OpenRouter и лимиты подписок; без force — не чаще раза в 15 секунд */
  refreshOpenRouter: (force?: boolean) => Promise<void>
}

let lastRefresh = 0

export const useUsage = create<UsageStore>()(
  persist(
    (set) => ({
      events: [],
      add: (e) => set((s) => ({ events: s.events.length >= MAX_EVENTS ? [...s.events.slice(-MAX_EVENTS + 1), e] : [...s.events, e] })),
      clear: () => set({ events: [] }),
      openrouter: null,
      subscriptions: [],
      refreshOpenRouter: async (force = false) => {
        if (!force && Date.now() - lastRefresh < 15_000) return
        lastRefresh = Date.now()
        try {
          const res = await fetch(`/api/usage${force ? '?refresh=1' : ''}`)
          const data = (await res.json()) as { openrouter: OpenRouterSpend | null; subscriptions?: SubscriptionLimits[] }
          set({ ...(data.openrouter ? { openrouter: data.openrouter } : {}), subscriptions: data.subscriptions ?? [] })
        } catch {
          // офлайн — остаёмся при своих подсчётах
        }
      },
    }),
    { name: 'heph-usage', storage: persistStorage, partialize: (s) => ({ events: s.events, openrouter: s.openrouter, subscriptions: s.subscriptions }) },
  ),
)

export function spentSince(events: UsageEvent[], since: number): number {
  let sum = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].ts < since) break
    sum += events[i].cost ?? 0
  }
  return sum
}

export function startOfDay(t = Date.now()) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfMonth(t = Date.now()) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

export function useSpend() {
  const events = useUsage((s) => s.events)
  return { today: spentSince(events, startOfDay()), month: spentSince(events, startOfMonth()) }
}

export { dayKey }
