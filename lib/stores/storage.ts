import { createJSONStorage, type StateStorage } from 'zustand/middleware'

// Данные приложения хранятся в IndexedDB: у localStorage всего ~5 МБ,
// а история чатов и запусков пайплайнов быстро вырастает больше.

const DB = 'hephaestus'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

const memory = new Map<string, string>()
const pending = new Map<string, string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

// Потоковые ответы меняют состояние десятки раз в секунду. Писать весь
// снимок в IndexedDB на каждое изменение дорого, поэтому записи
// откладываются и склеиваются; при закрытии вкладки — сбрасываются сразу.
async function flushPending() {
  flushTimer = null
  const batch = Array.from(pending.entries())
  pending.clear()
  for (const [name, value] of batch) {
    try {
      await tx('readwrite', (s) => s.put(value, name))
    } catch {
      // приватный режим или переполнение — данные останутся в памяти
    }
  }
}

if (typeof window !== 'undefined') {
  const flushNow = () => {
    if (pending.size) void flushPending()
  }
  window.addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNow())
}

const idbStorage: StateStorage = {
  async getItem(name) {
    if (memory.has(name)) return memory.get(name)!
    if (typeof indexedDB === 'undefined') return null
    try {
      return ((await tx('readonly', (s) => s.get(name))) as string | undefined) ?? null
    } catch {
      return null
    }
  },
  async setItem(name, value) {
    memory.set(name, value)
    if (typeof indexedDB === 'undefined') return
    pending.set(name, value)
    flushTimer ??= setTimeout(flushPending, 400)
  },
  async removeItem(name) {
    memory.delete(name)
    pending.delete(name)
    if (typeof indexedDB === 'undefined') return
    try {
      await tx('readwrite', (s) => s.delete(name))
    } catch {
      // нечего удалять
    }
  },
}

export const persistStorage = createJSONStorage(() => idbStorage)

export async function readAllPersisted(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const key of STORE_KEYS) {
    const raw = await idbStorage.getItem(key)
    if (typeof raw === 'string') out[key] = JSON.parse(raw)
  }
  return out
}

export async function writeAllPersisted(data: Record<string, unknown>) {
  for (const key of STORE_KEYS) if (key in data) await idbStorage.setItem(key, JSON.stringify(data[key]))
  await flushPending()
}

export async function clearAllPersisted() {
  for (const key of STORE_KEYS) await idbStorage.removeItem(key)
  memory.clear()
}

export const STORE_KEYS = [
  'heph-settings',
  'heph-catalog',
  'heph-chats',
  'heph-pipelines',
  'heph-debates',
  'heph-scenarios',
  'heph-agents',
  'heph-usage',
] as const
