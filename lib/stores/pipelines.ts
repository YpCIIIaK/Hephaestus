'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NodeRun, Pipeline, PipelineRun } from '../engine/pipeline'
import { persistStorage } from './storage'

const MAX_RUNS = 60

interface PipelinesStore {
  pipelines: Pipeline[]
  runs: PipelineRun[]
  upsert: (p: Pipeline) => void
  remove: (id: string) => void
  addRun: (r: PipelineRun) => void
  patchRun: (id: string, patch: Partial<PipelineRun>) => void
  patchNodeRun: (runId: string, nodeId: string, patch: Partial<NodeRun>) => void
  removeRun: (id: string) => void
}

export const usePipelines = create<PipelinesStore>()(
  persist(
    (set) => ({
      pipelines: [],
      runs: [],
      upsert: (p) =>
        set((s) => ({
          pipelines: s.pipelines.some((x) => x.id === p.id) ? s.pipelines.map((x) => (x.id === p.id ? p : x)) : [p, ...s.pipelines],
        })),
      remove: (id) => set((s) => ({ pipelines: s.pipelines.filter((p) => p.id !== id), runs: s.runs.filter((r) => r.pipelineId !== id) })),
      addRun: (r) => set((s) => ({ runs: [r, ...s.runs].slice(0, MAX_RUNS) })),
      patchRun: (id, patch) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      patchNodeRun: (runId, nodeId, patch) =>
        set((s) => ({ runs: s.runs.map((r) => (r.id === runId ? { ...r, nodes: { ...r.nodes, [nodeId]: { ...r.nodes[nodeId], ...patch } } } : r)) })),
      removeRun: (id) => set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),
    }),
    {
      name: 'heph-pipelines',
      storage: persistStorage,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        usePipelines.setState({
          runs: state.runs.map((r) =>
            r.status === 'running'
              ? {
                  ...r,
                  status: 'aborted',
                  error: 'Прервано перезагрузкой страницы',
                  nodes: Object.fromEntries(Object.entries(r.nodes).map(([k, n]) => [k, n.status === 'running' ? { ...n, status: 'error' as const, error: 'Прервано' } : n])),
                }
              : r,
          ),
        })
      },
    },
  ),
)
