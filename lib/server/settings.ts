import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DATA_DIR, WORKSPACE_DIR } from './paths'
import { readJson, writeJson } from './json-file'

// Серверные настройки: ключи и адреса, которые не должны попадать в браузер.
// Значения из UI сохраняются в data/settings.json и перекрывают .env.

export interface ServerSettings {
  openrouterKey?: string
  ollamaUrl?: string
  customUrl?: string
  customKey?: string
  /** Абсолютный путь к рабочей папке моделей */
  workspaceDir?: string
  /** Терминал: off — выключен, full — любые команды в рабочей папке */
  terminal?: TerminalMode
  /** Лимит времени на одну команду, секунды */
  commandTimeoutSec?: number
}

export type TerminalMode = 'off' | 'full'

export const DEFAULT_COMMAND_TIMEOUT_SEC = 120
export const MAX_COMMAND_TIMEOUT_SEC = 1800

const FILE = path.join(DATA_DIR, 'settings.json')

export async function loadServerSettings(): Promise<ServerSettings> {
  return readJson<ServerSettings>(FILE, {})
}

export async function saveServerSettings(patch: ServerSettings): Promise<ServerSettings> {
  if (patch.workspaceDir) patch = { ...patch, workspaceDir: await validateWorkspaceDir(patch.workspaceDir) }
  const current = await loadServerSettings()
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v === '') delete next[k]
    else next[k] = typeof v === 'string' ? v.trim() : v
  }
  await writeJson(FILE, next)
  return next as ServerSettings
}

/** Рабочая папка должна существовать и не быть корнем диска или домашней папкой целиком */
export async function validateWorkspaceDir(input: string): Promise<string> {
  const raw = input.trim().replace(/^~(?=$|[\\/])/, os.homedir())
  if (!path.isAbsolute(raw)) throw new Error('Укажите абсолютный путь к папке, например /home/user/projects/app или C:\\Projects\\app')
  const abs = path.resolve(raw)
  const st = await fs.stat(/* turbopackIgnore: true */ abs).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`Папка не найдена: ${abs}`)
  if (path.parse(abs).root === abs) throw new Error('Корень диска нельзя сделать рабочей папкой — выберите отдельную папку проекта')
  if (abs === path.resolve(os.homedir())) throw new Error('Домашнюю папку целиком нельзя сделать рабочей — выберите отдельную папку проекта')
  return abs
}

export async function getWorkspaceDir(): Promise<string> {
  const s = await loadServerSettings()
  return s.workspaceDir ? path.resolve(s.workspaceDir) : WORKSPACE_DIR
}

export async function getTerminalSettings(): Promise<{ mode: TerminalMode; timeoutSec: number }> {
  const s = await loadServerSettings()
  const envMode = process.env.HEPHAESTUS_TERMINAL === 'full' ? 'full' : 'off'
  const timeout = Number(s.commandTimeoutSec ?? process.env.HEPHAESTUS_COMMAND_TIMEOUT ?? DEFAULT_COMMAND_TIMEOUT_SEC)
  return {
    mode: s.terminal ?? envMode,
    timeoutSec: Math.min(MAX_COMMAND_TIMEOUT_SEC, Math.max(5, Number.isFinite(timeout) ? timeout : DEFAULT_COMMAND_TIMEOUT_SEC)),
  }
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
