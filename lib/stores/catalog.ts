'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EFFORT_LABELS, isAlias, pickAliasModel, splitEffort } from '../models'
import type { ModelAlias, ModelInfo, ServerStatus } from '../types'
import { useSettings } from './settings'
import { persistStorage } from './storage'

interface CatalogStore {
  models: ModelInfo[]
  fetchedAt: number | null
  errors: string[]
  loading: boolean
  status: ServerStatus | null
  /** Модели, которые ответили «недоступна» (403/404): id → причина и время */
  unavailable: Record<string, { reason: string; at: number }>
  markUnavailable: (id: string, reason: string) => void
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
      unavailable: {},
      markUnavailable: (id, reason) => set((s) => ({ unavailable: { ...s.unavailable, [id]: { reason, at: Date.now() } } })),
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
    { name: 'heph-catalog', storage: persistStorage, partialize: (s) => ({ models: s.models, fetchedAt: s.fetchedAt, unavailable: s.unavailable }) },
  ),
)

/** Через сутки недоступную модель снова пробуем: её могли открыть для всех */
const UNAVAILABLE_TTL_MS = 24 * 3600_000

/** Каталог без моделей, которые недавно ответили «недоступна» — их не берёт автовыбор */
export function usableModels(models: ModelInfo[], unavailable: CatalogStore['unavailable']): ModelInfo[] {
  const now = Date.now()
  return models.filter((m) => !(unavailable[m.id] && now - unavailable[m.id].at < UNAVAILABLE_TTL_MS))
}

/** Модель каталога; для «модель@усилие» — та же модель с усилием в названии */
export function modelById(id: string): ModelInfo | undefined {
  return findIn(useCatalog.getState().models, id)
}

export function findIn(models: ModelInfo[], id: string): ModelInfo | undefined {
  const { base, effort } = splitEffort(id)
  const info = models.find((m) => m.id === base)
  return info && effort ? { ...info, id, name: `${info.name} · ${EFFORT_LABELS[effort].short}` } : info
}

/** Псевдоним → реальная модель: явный выбор в настройках или автоподбор по каталогу */
export function resolveModelId(id: string): string | null {
  if (!isAlias(id)) return id
  const chosen = useSettings.getState().aliases[id as ModelAlias]
  if (chosen) return chosen
  const { models, unavailable } = useCatalog.getState()
  return pickAliasModel(id as ModelAlias, usableModels(models, unavailable), useSettings.getState().freeOnly)
}

export function useResolvedModel(id: string): { id: string | null; info?: ModelInfo } {
  const aliases = useSettings((s) => s.aliases)
  const models = useCatalog((s) => s.models)
  const unavailable = useCatalog((s) => s.unavailable)
  const freeOnly = useSettings((s) => s.freeOnly)
  if (!isAlias(id)) return { id, info: findIn(models, id) }
  const real = aliases[id as ModelAlias] || pickAliasModel(id as ModelAlias, usableModels(models, unavailable), freeOnly)
  return { id: real, info: real ? findIn(models, real) : undefined }
}
