import path from 'node:path'
import { DATA_DIR } from './paths'
import { readJson, writeJson } from './json-file'

// Серверные настройки: ключи и адреса, которые не должны попадать в браузер.
// Значения из UI сохраняются в data/settings.json и перекрывают .env.

export interface ServerSettings {
  openrouterKey?: string
  ollamaUrl?: string
  customUrl?: string
  customKey?: string
}

const FILE = path.join(DATA_DIR, 'settings.json')

export async function loadServerSettings(): Promise<ServerSettings> {
  return readJson<ServerSettings>(FILE, {})
}

export async function saveServerSettings(patch: ServerSettings): Promise<ServerSettings> {
  const current = await loadServerSettings()
  const next: ServerSettings = { ...current }
  for (const [k, v] of Object.entries(patch) as [keyof ServerSettings, string | undefined][]) {
    if (v === undefined) continue
    if (v === '') delete next[k]
    else next[k] = v.trim()
  }
  await writeJson(FILE, next)
  return next
}

export async function getOpenRouterKey(): Promise<{ key: string | null; source: 'settings' | 'env' | null }> {
  const s = await loadServerSettings()
  if (s.openrouterKey) return { key: s.openrouterKey, source: 'settings' }
  if (process.env.OPENROUTER_API_KEY) return { key: process.env.OPENROUTER_API_KEY, source: 'env' }
  return { key: null, source: null }
}

export async function getOllamaUrl(): Promise<string> {
  const s = await loadServerSettings()
  return (s.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
}

export async function getCustomEndpoint(): Promise<{ url: string; key?: string } | null> {
  const s = await loadServerSettings()
  const url = s.customUrl || process.env.CUSTOM_OPENAI_BASE_URL
  if (!url) return null
  return { url: url.replace(/\/+$/, ''), key: s.customKey || process.env.CUSTOM_OPENAI_API_KEY }
}

export function maskKey(key: string): string {
  return key.length <= 10 ? '••••' : `${key.slice(0, 6)}…${key.slice(-4)}`
}
