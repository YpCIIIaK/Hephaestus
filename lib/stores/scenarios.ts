'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DomainAnalysis, ScenarioConfig, ScenarioReport, StageId, StageState } from '../engine/scenario'
import type { Usage } from '../types'
import { persistStorage } from './storage'

export interface ScenarioRun {
  id: string
  config: ScenarioConfig
  status: 'running' | 'done' | 'error' | 'stopped'
  stages: Partial<Record<StageId, StageState>>
  report?: ScenarioReport | null
  raw?: string
  facts?: string
  analyses?: DomainAnalysis[]
  usage?: Usage
  error?: string
  createdAt: number
  finishedAt?: number
}

interface ScenariosStore {
  runs: ScenarioRun[]
  add: (r: ScenarioRun) => void
  patch: (id: string, patch: Partial<ScenarioRun>) => void
  setStage: (id: string, stage: StageId, s: StageState) => void
  remove: (id: string) => void
}

export const useScenarios = create<ScenariosStore>()(
  persist(
    (set) => ({
      runs: [],
      add: (r) => set((s) => ({ runs: [r, ...s.runs].slice(0, 100) })),
      patch: (id, patch) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      setStage: (id, stage, st) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, stages: { ...r.stages, [stage]: st } } : r)) })),
      remove: (id) => set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),
    }),
    {
      name: 'heph-scenarios',
      storage: persistStorage,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        useScenarios.setState({ runs: state.runs.map((r) => (r.status === 'running' ? { ...r, status: 'stopped', error: 'Прервано перезагрузкой страницы' } : r)) })
      },
    },
  ),
)
