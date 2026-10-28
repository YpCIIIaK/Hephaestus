'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatReply, ChatTurn, Conversation, JudgeResult } from '../engine/chat'
import { persistStorage } from './storage'

interface ChatsStore {
  conversations: Conversation[]
  create: (c: Conversation) => void
  patch: (id: string, patch: Partial<Conversation>) => void
  remove: (id: string) => void
  addTurn: (id: string, turn: ChatTurn) => void
  patchTurn: (id: string, turnId: string, patch: Partial<ChatTurn>) => void
  patchReply: (id: string, turnId: string, key: string, patch: Partial<ChatReply>) => void
  setJudge: (id: string, turnId: string, judge: JudgeResult | undefined) => void
  truncateFrom: (id: string, turnId: string) => void
}

const touch = (c: Conversation): Conversation => ({ ...c, updatedAt: Date.now() })

function mapConv(list: Conversation[], id: string, fn: (c: Conversation) => Conversation) {
  return list.map((c) => (c.id === id ? fn(c) : c))
}

function mapTurn(c: Conversation, turnId: string, fn: (t: ChatTurn) => ChatTurn): Conversation {
  return { ...c, turns: c.turns.map((t) => (t.id === turnId ? fn(t) : t)) }
}

export const useChats = create<ChatsStore>()(
  persist(
    (set) => ({
      conversations: [],
      create: (c) => set((s) => ({ conversations: [c, ...s.conversations] })),
      patch: (id, patch) => set((s) => ({ conversations: mapConv(s.conversations, id, (c) => ({ ...c, ...patch })) })),
      remove: (id) => set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),
      addTurn: (id, turn) => set((s) => ({ conversations: mapConv(s.conversations, id, (c) => touch({ ...c, turns: [...c.turns, turn] })) })),
      patchTurn: (id, turnId, patch) => set((s) => ({ conversations: mapConv(s.conversations, id, (c) => mapTurn(c, turnId, (t) => ({ ...t, ...patch }))) })),
      patchReply: (id, turnId, key, patch) =>
        set((s) => ({
          conversations: mapConv(s.conversations, id, (c) =>
            mapTurn(c, turnId, (t) => ({ ...t, replies: { ...t.replies, [key]: { ...(t.replies[key] ?? { status: 'streaming', text: '', startedAt: Date.now() }), ...patch } } })),
          ),
        })),
      setJudge: (id, turnId, judge) => set((s) => ({ conversations: mapConv(s.conversations, id, (c) => mapTurn(c, turnId, (t) => ({ ...t, judge }))) })),
      truncateFrom: (id, turnId) =>
        set((s) => ({
          conversations: mapConv(s.conversations, id, (c) => {
            const i = c.turns.findIndex((t) => t.id === turnId)
            return i === -1 ? c : touch({ ...c, turns: c.turns.slice(0, i) })
          }),
        })),
    }),
    {
      name: 'heph-chats',
      storage: persistStorage,
      // Ответы, которые шли во время закрытия вкладки, помечаем как прерванные
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const fixed = state.conversations.map((c) => ({
          ...c,
          turns: c.turns.map((t) => ({
            ...t,
            judge: t.judge?.status === 'streaming' ? { ...t.judge, status: 'error' as const, error: 'Прервано' } : t.judge,
            replies: Object.fromEntries(Object.entries(t.replies).map(([k, r]) => [k, r.status === 'streaming' ? { ...r, status: 'stopped' as const } : r])),
          })),
        }))
        useChats.setState({ conversations: fixed })
      },
    },
  ),
)
