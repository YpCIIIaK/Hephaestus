import type { ModelInfo } from '../types'
import { CUSTOM_PREFIX, OLLAMA_PREFIX } from '../models'
import { getCustomEndpoint, getOllamaUrl, getOpenRouterKey } from './settings'

// Каталог моделей: OpenRouter + локальные модели Ollama + свой OpenAI-совместимый сервер.

interface OpenRouterModel {
  id: string
  name: string
  description?: string
  context_length?: number
  created?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
}

let openrouterCache: { at: number; models: ModelInfo[] } | null = null
const TTL = 30 * 60_000

async function fetchOpenRouter(refresh: boolean): Promise<ModelInfo[]> {
  if (!refresh && openrouterCache && Date.now() - openrouterCache.at < TTL) return openrouterCache.models
  const { key } = await getOpenRouterKey()
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`OpenRouter: ${res.status}`)
  const data = (await res.json()) as { data: OpenRouterModel[] }
  // Варианты :batch дублируют модели с отложенной обработкой — в интерактивной работе не нужны
  const models: ModelInfo[] = data.data.filter((m) => !m.id.endsWith(':batch')).map((m) => {
    const prompt = Number(m.pricing?.prompt ?? NaN)
    const completion = Number(m.pricing?.completion ?? NaN)
    return {
      id: m.id,
      name: m.name,
      provider: 'openrouter',
      vendor: m.id.split('/')[0],
      description: m.description,
      contextLength: m.context_length,
      created: m.created,
      // Цена −1 у openrouter/auto означает «зависит от выбранной модели»
      pricing: Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0 ? { prompt, completion } : undefined,
      supportsTools: m.supported_parameters?.includes('tools'),
      supportsReasoning: m.supported_parameters?.includes('reasoning'),
    }
  })
  openrouterCache = { at: Date.now(), models }
  return models
}

export async function fetchOllamaModels(): Promise<ModelInfo[]> {
  const base = await getOllamaUrl()
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) })
  if (!res.ok) throw new Error(`Ollama: ${res.status}`)
  const data = (await res.json()) as { models?: { name: string; details?: { parameter_size?: string; family?: string } }[] }
  return (data.models ?? []).map((m) => ({
    id: `${OLLAMA_PREFIX}${m.name}`,
    name: m.name,
    provider: 'ollama' as const,
    vendor: 'ollama',
    description: [m.details?.family, m.details?.parameter_size].filter(Boolean).join(' · ') || 'Локальная модель',
    pricing: { prompt: 0, completion: 0 },
    supportsTools: true,
  }))
}

async function fetchCustomModels(): Promise<ModelInfo[]> {
  const ep = await getCustomEndpoint()
  if (!ep) return []
  const res = await fetch(`${ep.url}/models`, {
    headers: ep.key ? { Authorization: `Bearer ${ep.key}` } : {},
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(`Свой сервер: ${res.status}`)
  const data = (await res.json()) as { data?: { id: string }[] }
  return (data.data ?? []).map((m) => ({
    id: `${CUSTOM_PREFIX}${m.id}`,
    name: m.id,
    provider: 'custom' as const,
    vendor: 'custom',
    description: 'Модель со своего сервера',
    supportsTools: true,
  }))
}

export interface CatalogResult {
  models: ModelInfo[]
  errors: string[]
}

export async function getCatalog(refresh = false): Promise<CatalogResult> {
  const errors: string[] = []
  const settle = async (p: Promise<ModelInfo[]>, label: string) => {
    try {
      return await p
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
      return []
    }
  }
  const [remote, local, custom] = await Promise.all([
    settle(fetchOpenRouter(refresh), 'OpenRouter'),
    settle(fetchOllamaModels(), 'Ollama'),
    settle(fetchCustomModels(), 'Свой сервер'),
  ])
  // Ollama, который просто не запущен, — нормальная ситуация, не ошибка
  const filtered = errors.filter((e) => !e.startsWith('Ollama'))
  return { models: [...local, ...custom, ...remote], errors: filtered }
}

export async function findModel(id: string): Promise<ModelInfo | undefined> {
  if (openrouterCache) return openrouterCache.models.find((m) => m.id === id)
  try {
    return (await fetchOpenRouter(false)).find((m) => m.id === id)
  } catch {
    return undefined
  }
}
