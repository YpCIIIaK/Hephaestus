'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UsageSource } from '../engine/llm'
import { dayKey } from '../utils'
import { persistStorage } from './storage'

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

interface UsageStore {
  events: UsageEvent[]
  add: (e: UsageEvent) => void
  clear: () => void
}

export const useUsage = create<UsageStore>()(
  persist(
    (set) => ({
      events: [],
      add: (e) => set((s) => ({ events: s.events.length >= MAX_EVENTS ? [...s.events.slice(-MAX_EVENTS + 1), e] : [...s.events, e] })),
      clear: () => set({ events: [] }),
    }),
    { name: 'heph-usage', storage: persistStorage },
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
