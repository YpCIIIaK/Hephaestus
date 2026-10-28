'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isAlias, pickAliasModel } from '../models'
import type { ModelAlias, ModelInfo, ServerStatus } from '../types'
import { useSettings } from './settings'
import { persistStorage } from './storage'

interface CatalogStore {
  models: ModelInfo[]
  fetchedAt: number | null
  errors: string[]
  loading: boolean
  status: ServerStatus | null
  refresh: (force?: boolean) => Promise<void>
  loadStatus: () => Promise<ServerStatus | null>
}

export const useCatalog = create<CatalogStore>()(
  persist(
    (set, get) => ({
      models: [],
      fetchedAt: null,
      errors: [],
      loading: false,
      status: null,
      refresh: async (force = false) => {
        if (get().loading) return
        set({ loading: true })
        try {
          const res = await fetch(`/api/models${force ? '?refresh=1' : ''}`)
          const data = (await res.json()) as { models: ModelInfo[]; errors: string[] }
          set({ models: data.models, errors: data.errors, fetchedAt: Date.now() })
        } catch (e) {
          set({ errors: [e instanceof Error ? e.message : String(e)] })
        } finally {
          set({ loading: false })
        }
      },
      loadStatus: async () => {
        try {
          const status = (await (await fetch('/api/status')).json()) as ServerStatus
          set({ status })
          return status
        } catch {
          return null
        }
      },
    }),
    { name: 'heph-catalog', storage: persistStorage, partialize: (s) => ({ models: s.models, fetchedAt: s.fetchedAt }) },
  ),
)

export function modelById(id: string): ModelInfo | undefined {
  return useCatalog.getState().models.find((m) => m.id === id)
}

/** Псевдоним → реальная модель: явный выбор в настройках или автоподбор по каталогу */
export function resolveModelId(id: string): string | null {
  if (!isAlias(id)) return id
  const chosen = useSettings.getState().aliases[id as ModelAlias]
  if (chosen) return chosen
  return pickAliasModel(id as ModelAlias, useCatalog.getState().models, useSettings.getState().freeOnly)
}

export function useResolvedModel(id: string): { id: string | null; info?: ModelInfo } {
  const aliases = useSettings((s) => s.aliases)
  const models = useCatalog((s) => s.models)
  const freeOnly = useSettings((s) => s.freeOnly)
  if (!isAlias(id)) return { id, info: models.find((m) => m.id === id) }
  const real = aliases[id as ModelAlias] || pickAliasModel(id as ModelAlias, models, freeOnly)
  return { id: real, info: real ? models.find((m) => m.id === real) : undefined }
}
