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
    /^anthropic\/claude-(sonnet|opus)-[\d.]+$/,
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

export function pickAliasModel(alias: ModelAlias, catalog: ModelInfo[]): string | null {
  const remote = catalog.filter((m) => m.provider === 'openrouter')
  for (const re of ALIAS_PATTERNS[alias]) {
    const matches = remote.filter((m) => re.test(m.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    if (matches[0]) return matches[0].id
  }
  const local = catalog.find((m) => m.provider !== 'openrouter')
  if (local) return local.id
  return remote[0]?.id ?? null
}
