'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelAlias, ToolsetId } from '../types'
import { persistStorage } from './storage'

export interface Settings {
  aliases: Record<ModelAlias, string>
  favorites: string[]
  limits: { dailyUsd: number; monthlyUsd: number }
  /** Только бесплатные модели: автовыбор ролей берёт модели с нулевой ценой, платные запросы блокируются */
  freeOnly: boolean
  /** Модель решений (OpenRouter Decisions API) для маршрутизаторов и проверок; платная, включается явно */
  decider: { enabled: boolean; model: string }
  /** Подписка в приоритете: модель OpenRouter, у которой есть такая же по подписке, запускается через подписку */
  subscriptionFirst: boolean
  /** Подписка не сработала (лимит, вход, версия CLI) — повторить через OpenRouter с учётом лимитов расходов */
  subscriptionFallback: boolean
  /** Модели служебных задач; пусто — как написано в подсказке у поля */
  services: { title: string; compaction: string; router: string; validator: string }
  chat: {
    targets: { kind: 'model' | 'agent' | 'pipeline'; id: string }[]
    tools: ToolsetId[]
    maxContextTokens: number
    temperature: number
    maxTokens: number
    autoTitle: boolean
    autoJudge: boolean
    judgeModel: string
    showReasoning: boolean
  }
  sendOnEnter: boolean
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void
  setChat: (patch: Partial<Settings['chat']>) => void
  setAlias: (alias: ModelAlias, id: string) => void
  toggleFavorite: (id: string) => void
}

export const DEFAULT_SETTINGS: Settings = {
  aliases: { '@smart': '', '@default': '', '@fast': '' },
  favorites: [],
  limits: { dailyUsd: 5, monthlyUsd: 50 },
  freeOnly: false,
  decider: { enabled: false, model: 'perplexity/pplx-decider-v1.2' },
  subscriptionFirst: true,
  subscriptionFallback: true,
  services: { title: '@fast', compaction: '', router: '@fast', validator: '@smart' },
  chat: {
    targets: [{ kind: 'model', id: '@default' }],
    tools: [],
    maxContextTokens: 24_000,
    temperature: 0.7,
    maxTokens: 4096,
    autoTitle: true,
    autoJudge: false,
    judgeModel: '@smart',
    showReasoning: true,
  },
  sendOnEnter: true,
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      setChat: (patch) => set((s) => ({ chat: { ...s.chat, ...patch } })),
      setAlias: (alias, id) => set((s) => ({ aliases: { ...s.aliases, [alias]: id } })),
      toggleFavorite: (id) => set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id] })),
    }),
    {
      name: 'heph-settings',
      storage: persistStorage,
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>
        return { ...current, ...p, chat: { ...current.chat, ...p.chat }, limits: { ...current.limits, ...p.limits }, aliases: { ...current.aliases, ...p.aliases }, decider: { ...current.decider, ...p.decider }, services: { ...current.services, ...p.services } }
      },
    },
  ),
)
