import path from 'node:path'
import type { ServerStatus } from '../types'
import { fetchOllamaModels } from './catalog'
import { WORKSPACE_DIR } from './paths'
import { getCustomEndpoint, getOllamaUrl, getOpenRouterKey, maskKey } from './settings'

export async function getServerStatus(): Promise<ServerStatus> {
  const [{ key, source }, ollamaUrl, custom] = await Promise.all([getOpenRouterKey(), getOllamaUrl(), getCustomEndpoint()])
  let reachable = false
  let models = 0
  try {
    models = (await fetchOllamaModels()).length
    reachable = true
  } catch {
    reachable = false
  }
  return {
    openrouter: { configured: !!key, source, masked: key ? maskKey(key) : undefined },
    ollama: { url: ollamaUrl, reachable, models },
    custom: { url: custom?.url ?? null, configured: !!custom },
    searxng: !!process.env.SEARXNG_URL,
    workspace: path.relative(process.cwd(), WORKSPACE_DIR) || '.',
  }
}
