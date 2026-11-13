import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { splitEffort, upstreamModelId, withEffort } from '@/lib/models'
import type { LLMEvent, ModelInfo } from '@/lib/types'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-effort-'))
process.env.HEPHAESTUS_WORKSPACE = dir
process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM

const { saveServerSettings } = await import('@/lib/server/settings')
const subs = await import('@/lib/server/subscriptions')
const { parseLimitLine, recordLimits, getSubscriptionLimits } = await import('@/lib/server/sub-limits')
const { runLLM } = await import('@/lib/server/llm')

afterAll(() => fs.rm(dir, { recursive: true, force: true }))
afterEach(() => vi.unstubAllGlobals())

describe('усилие рассуждений', () => {
  it('суффикс @уровень отделяется от id модели', () => {
    expect(splitEffort('claude-code/opus@max')).toEqual({ base: 'claude-code/opus', effort: 'max' })
    expect(splitEffort('openai/gpt-6.1-sol')).toEqual({ base: 'openai/gpt-6.1-sol' })
    expect(splitEffort('x/y@weird')).toEqual({ base: 'x/y@weird' })
    expect(upstreamModelId('codex/gpt-6.1-sol@xhigh')).toBe('gpt-6.1-sol')
    expect(withEffort('a/b', 'low')).toBe('a/b@low')
  })

  it('уходит в CLI: --effort у Claude Code, model_reasoning_effort у Codex', () => {
    expect(subs.claudeArgs('claude-opus-5-5', null, [], [], 'max')).toEqual(expect.arrayContaining(['--model', 'claude-opus-5-5', '--effort', 'max']))
    expect(subs.codexArgs('gpt-6.1-sol', 'read-only', 'ultra')).toEqual(expect.arrayContaining(['-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="ultra"']))
  })

  it('у OpenRouter — reasoning.effort, а в модель уходит id без суффикса', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/chat/completions')) bodies.push(JSON.parse(init!.body as string))
        if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [] }))
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ок' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })}\n\ndata: [DONE]\n\n`)
      }),
    )
    for await (const _ of runLLM({ model: 'anthropic/claude-opus-5.5@max', messages: [{ role: 'user', content: 'x' }] })) void _
    expect(bodies[0].model).toBe('anthropic/claude-opus-5.5')
    expect(bodies[0].reasoning).toEqual({ effort: 'xhigh' })
  })

  it('перенаправление на подписку сохраняет усилие', async () => {
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true } }, subscriptionRoutes: { 'anthropic/claude-opus-5.5': 'claude-code/claude-opus-5-5' } })
    expect(await subs.routeModel('anthropic/claude-opus-5.5@high')).toBe('claude-code/claude-opus-5-5@high')
    expect(await subs.routeModel('anthropic/claude-opus-5.5')).toBe('claude-code/claude-opus-5-5')
  })
})

describe('модели подписок', () => {
  it('Claude: все свежие модели Anthropic из каталога, алиасы и добавленные вручную', async () => {
    const now = Date.now() / 1000
    const or = (id: string, created: number): ModelInfo => ({ id, name: `Anthropic: ${id.split('/')[1]}`, provider: 'openrouter', vendor: 'anthropic', created })
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true, models: 'claude-secret-1' }, codex: { enabled: false } } })
    const list = await subs.subscriptionModels([or('anthropic/claude-opus-5.5', now), or('anthropic/claude-fable-5.2', now), or('anthropic/claude-2', now - 3 * 365 * 86400), or('anthropic/claude-opus-5.5:batch', now)])
    const ids = list.map((m) => m.id)
    expect(ids.slice(0, 2).sort()).toEqual(['claude-code/claude-fable-5-2', 'claude-code/claude-opus-5-5'])
    expect(ids).toContain('claude-code/opus')
    expect(ids).toContain('claude-code/claude-secret-1')
    expect(ids).not.toContain('claude-code/claude-2') // старые в подписке недоступны
    expect(list[0].efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('Codex: каталог и уровни усилия берутся из самого CLI', async () => {
    const bin = path.join(dir, 'codex')
    const catalog = { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }, { effort: 'ultra' }] }, { slug: 'hidden-x', visibility: 'hide' }] }
    await fs.writeFile(bin, `#!/usr/bin/env node\nif (process.argv.slice(2).join(' ') === 'debug models') console.log(${JSON.stringify(JSON.stringify(catalog))})\n`, { mode: 0o755 })
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: false }, codex: { enabled: true, bin } } })
    const list = await subs.subscriptionModels([])
    expect(list.map((m) => m.id)).toEqual(['codex/gpt-6.1-sol'])
    expect(list[0].name).toContain('GPT-6.1-Sol')
    expect(list[0].efforts).toEqual(['low', 'max', 'ultra'])
  })
})

describe('лимиты подписок', () => {
  it('Claude Code: событие rate_limit_event', () => {
    const w = parseLimitLine('claude-code', JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_900_000_000, rateLimitType: 'seven_day', utilization: 0.83 } }), 1)
    expect(w).toEqual([{ key: 'seven_day', label: 'неделя', usedPercent: 83, resetsAt: 1_900_000_000_000, status: 'warning', updatedAt: 1 }])
    expect(parseLimitLine('claude-code', '{"type":"assistant"}')).toBeNull()
  })

  it('Codex: rate_limits primary/secondary', () => {
    const w = parseLimitLine('codex', JSON.stringify({ type: 'token_count', info: { rate_limits: { primary: { used_percent: 42, window_minutes: 300, resets_in_seconds: 600 }, secondary: { used_percent: 100, window_minutes: 10080 } } } }), 1000)
    expect(w).toEqual([
      { key: 'primary', label: '5 ч', usedPercent: 42, resetsAt: 601_000, status: 'ok', updatedAt: 1000 },
      { key: 'secondary', label: 'неделя', usedPercent: 100, resetsAt: undefined, status: 'exhausted', updatedAt: 1000 },
    ])
  })

  it('запоминаются и обновляются по окнам; запрос через подписку их записывает', async () => {
    await recordLimits('codex', [{ key: 'primary', label: '5 ч', usedPercent: 10, status: 'ok', updatedAt: 1 }])
    await recordLimits('codex', [{ key: 'primary', label: '5 ч', usedPercent: 20, status: 'ok', updatedAt: 2 }])
    expect((await getSubscriptionLimits()).find((l) => l.id === 'codex')!.windows).toHaveLength(1)

    const bin = path.join(dir, 'claude')
    const lines = [
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1_900_000_000 } },
      { type: 'result', subtype: 'success', is_error: false, result: 'ок', usage: { input_tokens: 1, output_tokens: 1 } },
    ]
    await fs.writeFile(bin, `#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>{for (const l of ${JSON.stringify(lines.map((l) => JSON.stringify(l)))}) console.log(l)})\n`, { mode: 0o755 })
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true, bin } } })
    const events: LLMEvent[] = []
    for await (const e of runLLM({ model: 'claude-code/opus@low', messages: [{ role: 'user', content: 'x' }] })) events.push(e)
    expect(events.at(-1)).toEqual({ t: 'done', finish: 'stop' })
    await new Promise((r) => setTimeout(r, 50))
    const claude = (await getSubscriptionLimits()).find((l) => l.id === 'claude-code')!
    expect(claude.windows[0]).toMatchObject({ key: 'five_hour', usedPercent: 50 })
  })
})

describe('длина ответа до 1 000 000', () => {
  it('запрос больше потолка модели урезается до её max_completion_tokens', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'big/model', name: 'Big', context_length: 1_000_000, top_provider: { max_completion_tokens: 128_000 } }] }))
        if (String(url).includes('/chat/completions')) bodies.push(JSON.parse(init!.body as string))
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ок' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })}\n\ndata: [DONE]\n\n`)
      }),
    )
    const { getCatalog } = await import('@/lib/server/catalog')
    await getCatalog(true)
    for await (const _ of runLLM({ model: 'big/model', maxTokens: 1_000_000, messages: [{ role: 'user', content: 'x' }] })) void _
    for await (const _ of runLLM({ model: 'unknown/model', maxTokens: 1_000_000, messages: [{ role: 'user', content: 'x' }] })) void _
    expect(bodies[0].max_tokens).toBe(128_000)
    expect(bodies[1].max_tokens).toBe(1_000_000) // потолок неизвестен — как просили
  })
})
