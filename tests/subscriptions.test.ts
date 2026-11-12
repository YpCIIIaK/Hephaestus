import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { LLMEvent } from '@/lib/types'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-subs-'))
process.env.HEPHAESTUS_WORKSPACE = dir
process.env.OPENROUTER_API_KEY = 'sk-or-test'
process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak'
delete process.env.HEPHAESTUS_MOCK_LLM

const { saveServerSettings } = await import('@/lib/server/settings')
const subs = await import('@/lib/server/subscriptions')
const { runLLM } = await import('@/lib/server/llm')

afterAll(() => fs.rm(dir, { recursive: true, force: true }))

/** Поддельный CLI: пишет аргументы, stdin и окружение в файл и печатает заготовленные строки */
async function fakeCli(name: string, lines: object[], exitCode = 0): Promise<string> {
  const file = path.join(dir, name)
  const log = path.join(dir, `${name}.log`)
  const script = `#!/usr/bin/env node
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  if (process.argv[2] === '--version') { console.log('9.9.9 (fake)'); return }
  const a = process.argv.slice(2); const f = a.indexOf('--append-system-prompt-file')
  const system = f >= 0 ? require('fs').readFileSync(a[f + 1], 'utf8') : null
  require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: a, system, input, cwd: process.cwd(), anthropic: process.env.ANTHROPIC_API_KEY ?? null, openrouter: process.env.OPENROUTER_API_KEY ?? null }))
  for (const l of ${JSON.stringify(lines.map((l) => JSON.stringify(l)))}) console.log(l)
  process.exit(${exitCode})
})
`
  await fs.writeFile(file, script, { mode: 0o755 })
  return file
}

const readLog = async (name: string) => JSON.parse(await fs.readFile(path.join(dir, `${name}.log`), 'utf8'))

async function collect(req: Parameters<typeof runLLM>[0]): Promise<LLMEvent[]> {
  const out: LLMEvent[] = []
  for await (const e of runLLM(req)) out.push(e)
  return out
}

describe('подписки: разбор потоков', () => {
  it('история диалога превращается в один запрос, системные сообщения — отдельно', () => {
    const r = subs.promptFromMessages([
      { role: 'system', content: 'Ты ревьюер.' },
      { role: 'user', content: 'Привет' },
      { role: 'assistant', content: 'Здравствуйте' },
      { role: 'user', content: 'Проверь код' },
    ])
    expect(r.system).toBe('Ты ревьюер.')
    expect(r.prompt).toContain('[Пользователь]\nПривет')
    expect(r.prompt).toContain('[Ассистент]\nЗдравствуйте')
    expect(r.prompt.endsWith('Текущий запрос пользователя:\n\nПроверь код')).toBe(true)
    expect(subs.promptFromMessages([{ role: 'user', content: 'Один' }]).prompt).toBe('Один')
  })

  it('наборы инструментов → инструменты Claude Code; терминал только если включён', () => {
    expect(subs.claudeToolList(['files_read', 'terminal'], false)).toEqual(['Read', 'Glob', 'Grep', 'LS'])
    expect(subs.claudeToolList(['terminal', 'web'], true)).toEqual(['Bash', 'WebSearch', 'WebFetch'])
    const args = subs.claudeArgs('fable', '/tmp/sys.md', [], [])
    expect(args).toEqual(expect.arrayContaining(['-p', '--model', 'fable', '--append-system-prompt-file', '/tmp/sys.md', '--tools', '', '--permission-mode', 'dontAsk']))
    expect(args).not.toContain('--bare') // --bare отключает вход по подписке
    expect(subs.codexArgs('default', 'read-only')).toEqual(['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-'])
  })

  it('окружение CLI без API-ключей — расход идёт с подписки', () => {
    const env = subs.subscriptionEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', OPENROUTER_API_KEY: 'y', HOME: '/h' } as unknown as NodeJS.ProcessEnv)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.OPENROUTER_API_KEY).toBeUndefined()
    expect(env.HOME).toBe('/h') // там лежит вход в подписку
  })
})

describe('подписки: запуск через CLI', () => {
  it('Claude Code: текст кусочками, инструменты, расход без денег', async () => {
    const bin = await fakeCli('claude', [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'export const a = 1' }] } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Всё ' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'хорошо' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Всё хорошо' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Всё хорошо', total_cost_usd: 0.5, usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } },
    ])
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true, bin } } })
    const events = await collect({ model: 'claude-code/fable', messages: [{ role: 'system', content: 'Будь краток' }, { role: 'user', content: 'Проверь' }], tools: ['files_read'] })
    expect(events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('')).toBe('Всё хорошо')
    expect(events).toContainEqual({ t: 'tool_call', id: 't1', name: 'Read', args: '{"file_path":"a.ts"}' })
    expect(events).toContainEqual(expect.objectContaining({ t: 'tool_result', id: 't1', ok: true, preview: 'export const a = 1' }))
    expect(events).toContainEqual({ t: 'usage', usage: { promptTokens: 100, completionTokens: 5, cost: 0 }, model: 'claude-code/fable' })
    expect(events.at(-1)).toEqual({ t: 'done', finish: 'stop' })
    const log = await readLog('claude')
    expect(log.input).toBe('Проверь')
    expect(log.args).toEqual(expect.arrayContaining(['--model', 'fable', '--tools', 'Read,Glob,Grep,LS']))
    expect(log.system).toContain('Будь краток')
    await expect(fs.stat(log.args[log.args.indexOf('--append-system-prompt-file') + 1])).rejects.toThrow() // временный файл удалён
    expect(await fs.realpath(log.cwd)).toBe(await fs.realpath(dir)) // с файлами — в рабочей папке
    expect(log.anthropic).toBeNull()
    expect(log.openrouter).toBeNull()
  })

  it('модель OpenRouter можно перенаправить на подписку', async () => {
    await saveServerSettings({ subscriptionRoutes: { 'anthropic/claude-fable-5.2': 'claude-code/fable' } })
    const events = await collect({ model: 'anthropic/claude-fable-5.2', messages: [{ role: 'user', content: 'Привет' }] })
    expect(events[0]).toEqual({ t: 'notice', v: 'Запрос идёт через подписку: claude-code/fable' })
    expect(events.some((e) => e.t === 'text')).toBe(true)
    const log = await readLog('claude')
    expect(log.cwd).not.toBe(dir) // без инструментов — пустая папка, а не проект
    await saveServerSettings({ subscriptionRoutes: {} })
  })

  it('Codex: команды и ответ, ошибка входа с подсказкой', async () => {
    const bin = await fakeCli('codex', [
      { type: 'thread.started', thread_id: 'x' },
      { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'npm test', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'npm test', aggregated_output: '3 passed', exit_code: 0, status: 'completed' } },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Тесты проходят' } },
      { type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 7 } },
    ])
    await saveServerSettings({ subscriptions: { codex: { enabled: true, bin } } })
    const events = await collect({ model: 'codex/default', messages: [{ role: 'system', content: 'Правила' }, { role: 'user', content: 'Запусти тесты' }], tools: ['terminal'] })
    expect(events).toContainEqual({ t: 'tool_call', id: 'i1', name: 'run_command', args: '{"command":"npm test"}' })
    expect(events).toContainEqual(expect.objectContaining({ t: 'tool_result', id: 'i1', ok: true, preview: '3 passed' }))
    expect(events).toContainEqual({ t: 'text', v: 'Тесты проходят' })
    const log = await readLog('codex')
    expect(log.args).toContain('read-only') // терминал выключен — только чтение
    expect(log.args).not.toContain('-m')
    expect(log.input).toContain('<instructions>\nПравила')

    const failing = await fakeCli('codex', [{ type: 'turn.failed', error: { message: '401 Unauthorized' } }], 1)
    await saveServerSettings({ subscriptions: { codex: { enabled: true, bin: failing } } })
    const bad = await collect({ model: 'codex/default', messages: [{ role: 'user', content: 'x' }] })
    const err = bad.find((e) => e.t === 'error') as { message: string }
    expect(err.message).toContain('codex login')
  })

  it('имя модели с символами оболочки отклоняется', async () => {
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true, bin: path.join(dir, 'claude') } } })
    const events = await collect({ model: 'claude-code/x & calc', messages: [{ role: 'user', content: 'x' }] })
    expect(events[0]).toMatchObject({ t: 'error', status: 400 })
  })

  it('выключенная подписка и отсутствующий CLI — понятные ошибки', async () => {
    await saveServerSettings({ subscriptions: { codex: { enabled: false } } })
    expect((await collect({ model: 'codex/default', messages: [{ role: 'user', content: 'x' }] }))[0]).toMatchObject({ t: 'error' })
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true, bin: path.join(dir, 'нет-такого') } } })
    const events = await collect({ model: 'claude-code/opus', messages: [{ role: 'user', content: 'x' }] })
    expect((events.find((e) => e.t === 'error') as { message: string }).message).toContain('не найден')
    expect(await subs.cliVersion(path.join(dir, 'нет-такого'))).toMatchObject({ version: null, error: 'не установлен' })
    expect((await subs.cliVersion(path.join(dir, 'codex'))).version).toBe('9.9.9 (fake)')
  })
})
