'use client'

import { useEffect, useState } from 'react'
import { useAgents } from './agents'
import { useCatalog } from './catalog'
import { useChats } from './chats'
import { useDebates } from './debates'
import { usePipelines } from './pipelines'
import { useScenarios } from './scenarios'
import { useSettings } from './settings'
import { useUsage } from './usage'

const stores = [useSettings, useCatalog, useChats, usePipelines, useDebates, useScenarios, useAgents, useUsage]

/** true, когда все хранилища прочитаны из IndexedDB */
export function useHydrated(): boolean {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && stores.every((s) => s.persist.hasHydrated()))
  useEffect(() => {
    if (ready) return
    const check = () => {
      if (stores.every((s) => s.persist.hasHydrated())) setReady(true)
    }
    const unsubs = stores.map((s) => s.persist.onFinishHydration(check))
    check()
    return () => unsubs.forEach((u) => u())
  }, [ready])
  return ready
}

export async function rehydrateAll() {
  await Promise.all(stores.map((s) => s.persist.rehydrate()))
}
