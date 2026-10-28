'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DebateConfig, DebateMessage, DebateVerdict } from '../engine/debate'
import { persistStorage } from './storage'

export interface DebateSession {
  id: string
  config: DebateConfig
  messages: DebateMessage[]
  verdict?: DebateVerdict | null
  verdictRaw?: string
  status: 'idle' | 'running' | 'paused' | 'judging' | 'done' | 'stopped' | 'error'
  round: number
  createdAt: number
  error?: string
}

interface DebatesStore {
  sessions: DebateSession[]
  upsert: (s: DebateSession) => void
  patch: (id: string, patch: Partial<DebateSession>) => void
  addMessage: (id: string, m: DebateMessage) => void
  patchMessage: (id: string, msgId: string, patch: Partial<DebateMessage>) => void
  remove: (id: string) => void
}

export const useDebates = create<DebatesStore>()(
  persist(
    (set) => ({
      sessions: [],
      upsert: (d) => set((s) => ({ sessions: s.sessions.some((x) => x.id === d.id) ? s.sessions.map((x) => (x.id === d.id ? d : x)) : [d, ...s.sessions] })),
      patch: (id, patch) => set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      addMessage: (id, m) => set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, messages: [...x.messages, m] } : x)) })),
      patchMessage: (id, msgId, patch) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, messages: x.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) } : x)) })),
      remove: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
    }),
    {
      name: 'heph-debates',
      storage: persistStorage,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        useDebates.setState({
          sessions: state.sessions.map((d) =>
            d.status === 'running' || d.status === 'judging' || d.status === 'paused'
              ? { ...d, status: 'stopped', messages: d.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'error' as const, error: 'Прервано' } : m)) }
              : d,
          ),
        })
      },
    },
  ),
)
