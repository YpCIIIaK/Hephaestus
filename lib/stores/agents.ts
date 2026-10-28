'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUILTIN_AGENTS, type Agent } from '../agents'
import { uid } from '../utils'
import { persistStorage } from './storage'

interface AgentsStore {
  custom: Agent[]
  upsert: (a: Agent) => void
  remove: (id: string) => void
  duplicate: (id: string) => Agent | null
}

export const useAgents = create<AgentsStore>()(
  persist(
    (set, get) => ({
      custom: [],
      upsert: (a) => set((s) => ({ custom: s.custom.some((x) => x.id === a.id) ? s.custom.map((x) => (x.id === a.id ? a : x)) : [...s.custom, a] })),
      remove: (id) => set((s) => ({ custom: s.custom.filter((x) => x.id !== id) })),
      duplicate: (id) => {
        const src = getAgent(id)
        if (!src) return null
        const copy: Agent = { ...src, id: uid('agent'), name: `${src.name} (копия)`, builtin: false }
        get().upsert(copy)
        return copy
      },
    }),
    { name: 'heph-agents', storage: persistStorage },
  ),
)

export function allAgents(custom = useAgents.getState().custom): Agent[] {
  return [...custom, ...BUILTIN_AGENTS]
}

export function getAgent(id: string): Agent | undefined {
  return useAgents.getState().custom.find((a) => a.id === id) ?? BUILTIN_AGENTS.find((a) => a.id === id)
}

export function useAllAgents(): Agent[] {
  const custom = useAgents((s) => s.custom)
  return allAgents(custom)
}
