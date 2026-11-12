import type { ServerStatus } from '../types'
import { fetchOllamaModels } from './catalog'
import { hasRipgrep } from './code-search'
import { searchStatus } from './search'
import { getCustomEndpoint, getOllamaUrl, getOpenRouterKey, getTerminalSettings, getWorkspaceDir, loadServerSettings, maskKey } from './settings'

export async function getServerStatus(): Promise<ServerStatus> {
  const [{ key, source }, ollamaUrl, custom, workspace, terminal, saved] = await Promise.all([
    getOpenRouterKey(),
    getOllamaUrl(),
    getCustomEndpoint(),
    getWorkspaceDir(),
    getTerminalSettings(),
    loadServerSettings(),
  ])
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
    search: searchStatus(),
    workspace,
    workspaceCustom: !!saved.workspaceDir,
    terminal: { ...terminal, shell: process.platform === 'win32' ? 'cmd.exe' : 'bash' },
    ripgrep: hasRipgrep(),
  }
}
