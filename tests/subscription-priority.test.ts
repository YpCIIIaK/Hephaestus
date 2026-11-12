import { afterEach, describe, expect, it, vi } from 'vitest'
import { nearestEffort, openrouterTwin, pickAliasModel, subscriptionTwin } from '@/lib/models'
import type { ModelInfo } from '@/lib/types'

const or = (id: string, created = 1, efforts: ModelInfo['efforts'] = ['low', 'medium', 'high', 'xhigh']): ModelInfo => ({ id, name: id, provider: 'openrouter', vendor: id.split('/')[0], created, efforts, pricing: { prompt: 1e-6, completion: 1e-6 } })
const sub = (id: string, created?: number): ModelInfo => ({ id, name: id, provider: id.startsWith('codex/') ? 'codex' : 'claude-code', vendor: 'x', created, efforts: id.startsWith('codex/') ? ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] : ['low', 'medium', 'high', 'xhigh', 'max'] })
const CATALOG = [
  or('anthropic/claude-opus-4.8', 5),
  or('anthropic/claude-opus-5.5', 9),
  or('anthropic/claude-sonnet-5.5', 8),
  or('openai/gpt-6.1-sol', 7),
  or('openai/gpt-6.1-sol-pro', 7),
  or('google/gemini-3.8-flash', 6, undefined),
  sub('claude-code/claude-opus-4-8', 5),
  sub('claude-code/claude-opus-5-5', 9),
  sub('claude-code/claude-sonnet-5-5', 8),
  sub('codex/gpt-6.1-sol'),
]

describe('подписка в приоритете: соответствие моделей', () => {
  it('модель OpenRouter → та же по подписке, с усилием', () => {
    expect(subscriptionTwin('anthropic/claude-opus-4.8', CATALOG)).toBe('claude-code/claude-opus-4-8')
    expect(subscriptionTwin('anthropic/claude-opus-5.5@high', CATALOG)).toBe('claude-code/claude-opus-5-5@high')
    expect(subscriptionTwin('openai/gpt-6.1-sol@xhigh', CATALOG)).toBe('codex/gpt-6.1-sol@xhigh')
    expect(subscriptionTwin('openai/gpt-6.1-sol-pro', CATALOG)).toBeNull() // в подписке такой нет
    expect(subscriptionTwin('google/gemini-3.8-flash', CATALOG)).toBeNull()
  })

  it('обратно: подписка → OpenRouter для запасного пути; max у OpenRouter → xhigh', () => {
    expect(openrouterTwin('claude-code/claude-opus-4-8@max', CATALOG)).toBe('anthropic/claude-opus-4.8@xhigh')
    expect(openrouterTwin('codex/gpt-6.1-sol', CATALOG)).toBe('openai/gpt-6.1-sol')
    expect(openrouterTwin('claude-code/opus', CATALOG)).toBeNull()
    expect(nearestEffort('ultra', ['low', 'high', 'max'])).toBe('max')
    expect(nearestEffort('minimal', ['low', 'high'])).toBe('low')
  })

  it('автовыбор ролей: «Умная» и «Основная» по подписке, «Быстрая» — нет', () => {
    expect(pickAliasModel('@smart', CATALOG, false, true)).toBe('claude-code/claude-opus-5-5')
    expect(pickAliasModel('@default', CATALOG, false, true)).toBe('claude-code/claude-sonnet-5-5')
    expect(pickAliasModel('@fast', CATALOG, false, true)).not.toMatch(/^(claude-code|codex)\//)
    expect(pickAliasModel('@smart', CATALOG, false, false)).toBe('anthropic/claude-sonnet-5.5')
  })
})

describe('подписка в приоритете: запуск и запасной путь', () => {
  afterEach(() => vi.unstubAllGlobals())

  async function setup(replies: Record<string, string>) {
    const { useCatalog } = await import('@/lib/stores/catalog')
    const { useSettings } = await import('@/lib/stores/settings')
    useCatalog.setState({ models: CATALOG })
    useSettings.setState({ subscriptionFirst: true, subscriptionFallback: true, freeOnly: false, limits: { dailyUsd: 0, monthlyUsd: 0 } })
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url !== '/api/llm') return Response.json({})
        const model = JSON.parse(init!.body as string).model as string
        sent.push(model)
        return new Response(replies[model] ?? '')
      }),
    )
    const { callLLM } = await import('@/lib/client/llm')
    return { callLLM, sent, useSettings }
  }
  const ok = (text: string) => `${JSON.stringify({ t: 'text', v: text })}\n${JSON.stringify({ t: 'done', finish: 'stop' })}\n`
  const fail = (message: string) => `${JSON.stringify({ t: 'error', message })}\n`

  it('модель OpenRouter идёт через подписку', async () => {
    const { callLLM, sent } = await setup({ 'claude-code/claude-opus-4-8@high': ok('через подписку') })
    const notices: string[] = []
    const r = await callLLM({ model: 'anthropic/claude-opus-4.8@high', messages: [{ role: 'user', content: 'x' }] }, { onEvent: (e) => e.t === 'notice' && notices.push(e.v) })
    expect(sent).toEqual(['claude-code/claude-opus-4-8@high'])
    expect(r.text).toBe('через подписку')
    expect(notices[0]).toContain('Через подписку')
  })

  it('подписка упёрлась в лимит — повтор через OpenRouter; выключено — ошибка подписки', async () => {
    const { callLLM, sent, useSettings } = await setup({ 'claude-code/claude-opus-4-8': fail('5-hour usage limit reached'), 'anthropic/claude-opus-4.8': ok('через OpenRouter') })
    const r = await callLLM({ model: 'anthropic/claude-opus-4.8', messages: [{ role: 'user', content: 'x' }] })
    expect(sent).toEqual(['claude-code/claude-opus-4-8', 'anthropic/claude-opus-4.8'])
    expect(r.text).toBe('через OpenRouter')

    useSettings.setState({ subscriptionFallback: false })
    sent.length = 0
    const r2 = await callLLM({ model: 'claude-code/claude-opus-4-8', messages: [{ role: 'user', content: 'x' }] })
    expect(sent).toEqual(['claude-code/claude-opus-4-8'])
    expect(r2.error).toContain('usage limit')
  })

  it('запасной путь не обходит режим «только бесплатные»', async () => {
    const { callLLM, sent, useSettings } = await setup({ 'claude-code/claude-opus-4-8': fail('not logged in') })
    useSettings.setState({ freeOnly: true })
    const r = await callLLM({ model: 'claude-code/claude-opus-4-8', messages: [{ role: 'user', content: 'x' }] })
    expect(sent.filter((m) => m.startsWith('anthropic/'))).toEqual([])
    expect(r.error).toContain('Запасной путь через OpenRouter')
    useSettings.setState({ freeOnly: false })
  })
})
