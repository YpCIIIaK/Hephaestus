import type { ModelAlias, ModelInfo, ProviderId, Usage } from './types'

export const OLLAMA_PREFIX = 'ollama/'
export const CUSTOM_PREFIX = 'custom/'

export function providerOf(modelId: string): ProviderId {
  if (modelId.startsWith(OLLAMA_PREFIX)) return 'ollama'
  if (modelId.startsWith(CUSTOM_PREFIX)) return 'custom'
  return 'openrouter'
}

/** ID модели без префикса провайдера: так его ждёт API */
export function upstreamModelId(modelId: string): string {
  const p = providerOf(modelId)
  if (p === 'ollama') return modelId.slice(OLLAMA_PREFIX.length)
  if (p === 'custom') return modelId.slice(CUSTOM_PREFIX.length)
  return modelId
}

export function vendorOf(modelId: string): string {
  const p = providerOf(modelId)
  if (p !== 'openrouter') return p
  return modelId.split('/')[0] || 'other'
}

export const VENDOR_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'meta-llama': 'Meta',
  mistralai: 'Mistral',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  'x-ai': 'xAI',
  moonshotai: 'Moonshot',
  'z-ai': 'Zhipu',
  cohere: 'Cohere',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA',
  perplexity: 'Perplexity',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  custom: 'Свой сервер',
}

export function vendorLabel(vendor: string): string {
  return VENDOR_LABELS[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1)
}

/** Короткое имя модели: «Anthropic: Claude Sonnet 4» → «Claude Sonnet 4» */
export function shortModelName(model: Pick<ModelInfo, 'id' | 'name'> | undefined, fallbackId?: string): string {
  if (model?.name) return model.name.replace(/^[^:]{1,30}:\s*/, '')
  const id = fallbackId ?? model?.id ?? ''
  return upstreamModelId(id).split('/').pop() ?? id
}

export function isAlias(id: string): id is ModelAlias {
  return id === '@smart' || id === '@default' || id === '@fast'
}

export const ALIAS_LABELS: Record<ModelAlias, { title: string; hint: string }> = {
  '@smart': { title: 'Умная', hint: 'Сложные рассуждения, синтез, судейство' },
  '@default': { title: 'Основная', hint: 'Обычная работа агентов и чата' },
  '@fast': { title: 'Быстрая', hint: 'Классификация, сжатие, заголовки' },
}

/** Стоимость по прайсу каталога, если провайдер её не вернул */
export function computeCost(model: ModelInfo | undefined, promptTokens: number, completionTokens: number): number | null {
  if (!model) return null
  if (model.provider === 'ollama') return 0
  if (!model.pricing) return null
  return promptTokens * model.pricing.prompt + completionTokens * model.pricing.completion
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cost: a.cost == null && b.cost == null ? null : (a.cost ?? 0) + (b.cost ?? 0),
  }
}

export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, cost: 0 }

// ─── Автовыбор моделей для псевдонимов ──────────────────────────────────
// Каталог OpenRouter меняется каждый месяц, поэтому вместо зашитых ID
// ищем самую свежую модель подходящего семейства.

const ALIAS_PATTERNS: Record<ModelAlias, RegExp[]> = {
  '@smart': [
    /^anthropic\/claude-sonnet-[\d.]+$/,
    /^anthropic\/claude-[\d.]+-sonnet$/,
    /^openai\/gpt-[\d.]+$/,
    /^google\/gemini-[\d.]+-pro$/,
  ],
  '@default': [
    /^google\/gemini-[\d.]+-flash$/,
    /^openai\/gpt-[\d.]+-mini$/,
    /^anthropic\/claude-(haiku)-[\d.]+$/,
    /^deepseek\/deepseek-(chat|v[\d.]+)$/,
  ],
  '@fast': [
    /^google\/gemini-[\d.]+-flash-lite$/,
    /^openai\/gpt-[\d.]+-nano$/,
    /^google\/gemini-[\d.]+-flash$/,
    /^openai\/gpt-[\d.o]+-mini$/,
  ],
}

// Бесплатные модели OpenRouter (суффикс :free) — для режима «только бесплатные».
// Порядок важен: сначала крупные модели с инструментами, затем быстрые.
const FREE_ALIAS_PATTERNS: Record<ModelAlias, RegExp[]> = {
  '@smart': [/^nvidia\/nemotron-[\d.]+-ultra[^:]*:free$/, /^google\/gemma-[\d.]+-31b[^:]*:free$/],
  '@default': [/^nvidia\/nemotron-[\d.]+-super[^:]*:free$/, /^google\/gemma-[\d.]+-31b[^:]*:free$/],
  '@fast': [/^poolside\/laguna-xs[^:]*:free$/, /^google\/gemma-[\d.]+-26b[^:]*:free$/],
}

/** Модель ничего не стоит: локальная или с нулевой ценой у OpenRouter */
export function isFreeModel(m: ModelInfo | undefined): boolean {
  if (!m) return false
  if (m.provider !== 'openrouter') return true
  return !!m.pricing && m.pricing.prompt === 0 && m.pricing.completion === 0
}

export function pickAliasModel(alias: ModelAlias, catalog: ModelInfo[], freeOnly = false): string | null {
  const remote = catalog.filter((m) => m.provider === 'openrouter' && (!freeOnly || isFreeModel(m)))
  const newest = (list: ModelInfo[]) => [...list].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]
  for (const re of (freeOnly ? FREE_ALIAS_PATTERNS : ALIAS_PATTERNS)[alias]) {
    const match = newest(remote.filter((m) => re.test(m.id)))
    if (match) return match.id
  }
  const local = catalog.find((m) => m.provider !== 'openrouter')
  if (local) return local.id
  if (freeOnly) return newest(remote.filter((m) => m.supportsTools))?.id ?? remote[0]?.id ?? null
  return remote[0]?.id ?? null
}
