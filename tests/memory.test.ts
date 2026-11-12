import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { buildChatMessages, compactionPlan, toolSummary, type ChatTurn, type Conversation } from '@/lib/engine/chat'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-mem-'))
process.env.HEPHAESTUS_WORKSPACE = dir
process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM

const { projectContext, remember } = await import('@/lib/server/memory')
const { runLLM } = await import('@/lib/server/llm')

afterAll(() => fs.rm(dir, { recursive: true, force: true }))
afterEach(() => vi.unstubAllGlobals())

const KEY = 'model:a'
function turn(i: number, size = 10, tools?: ChatTurn['replies'][string]['tools']): ChatTurn {
  return {
    id: `t${i}`,
    user: `вопрос ${i} ${'слово '.repeat(size)}`,
    createdAt: i,
    replies: { [KEY]: { status: 'done', text: `ответ ${i} ${'текст '.repeat(size)}`, startedAt: i, tools } },
  }
}
const conv = (turns: ChatTurn[], extra: Partial<Conversation> = {}) => ({ turns, ...extra })
const texts = (msgs: { content: string | null }[]) => msgs.map((m) => m.content ?? '').join('\n')

describe('контекст диалога', () => {
  it('в историю попадает сводка действий с инструментами', () => {
    const tools = [
      { id: '1', name: 'read_file', args: '{"path":"src/app.ts"}', ok: true },
      { id: '2', name: 'run_command', args: '{"command":"npm test"}', ok: false },
    ]
    expect(toolSummary(tools)).toBe('[Мои действия: read_file src/app.ts; run_command npm test (ошибка)]')
    const { messages } = buildChatMessages(conv([turn(0, 1, tools), turn(1, 1)]), KEY, 1, '', 10_000)
    expect(messages[1].content).toContain('[Мои действия: read_file src/app.ts; run_command npm test (ошибка)]')
  })

  it('после очистки контекста модели не видят ранние ходы', () => {
    const c = conv([turn(0), turn(1), turn(2), turn(3)], { contextFrom: 2 })
    const all = texts(buildChatMessages(c, KEY, 3, 'система', 10_000).messages)
    expect(all).not.toContain('вопрос 0')
    expect(all).not.toContain('вопрос 1')
    expect(all).toContain('вопрос 2')
    expect(all).toContain('вопрос 3')
  })

  it('сжатая часть заменяется резюме, свежие ходы остаются дословно', () => {
    const c = conv([turn(0), turn(1), turn(2), turn(3)], { memory: { [KEY]: { uptoTurn: 2, text: 'РЕЗЮМЕ: решили писать на Go', at: 1 } } })
    const { messages } = buildChatMessages(c, KEY, 3, 'система', 10_000)
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0].content).toContain('РЕЗЮМЕ: решили писать на Go')
    expect(texts(messages)).not.toContain('вопрос 1')
    expect(texts(messages)).toContain('вопрос 2')
  })

  it('резюме до очистки контекста не используется', () => {
    const c = conv([turn(0), turn(1), turn(2)], { contextFrom: 2, memory: { [KEY]: { uptoTurn: 1, text: 'СТАРОЕ', at: 1 } } })
    expect(texts(buildChatMessages(c, KEY, 2, '', 10_000).messages)).not.toContain('СТАРОЕ')
  })

  it('сжатие нужно только при переполнении и не трогает последние ходы', () => {
    const small = conv([turn(0), turn(1), turn(2)])
    expect(compactionPlan(small, KEY, 3, 10_000)).toBeNull()

    const big = conv(Array.from({ length: 6 }, (_, i) => turn(i, 400)))
    const plan = compactionPlan(big, KEY, 6, 2000)!
    expect(plan.from).toBe(0)
    expect(plan.to).toBe(4) // ходы 4 и 5 остаются дословно
    expect(plan.text).toContain('вопрос 3')
    expect(plan.text).not.toContain('вопрос 4')

    // ручное сжатие (/compact) захватывает всё
    expect(compactionPlan(small, KEY, 3, Infinity, true)).toMatchObject({ to: 3 })
  })
})

describe('память проекта', () => {
  it('подключается только когда модель работает с проектом', async () => {
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '# Правила\n\nТесты: pnpm test. Не трогать legacy/.\n')
    expect(await projectContext(['web'])).toBe('')
    const ctx = await projectContext(['files_read', 'code'])
    expect(ctx).toContain(`рабочей папке ${dir}`)
    expect(ctx).toContain('Память проекта — файл AGENTS.md')
    expect(ctx).toContain('Тесты: pnpm test. Не трогать legacy/.')
    expect(ctx).toContain('Терминал: недоступен')
  })

  it('remember дописывает заметки в раздел «Заметки» и не дублирует их', async () => {
    expect(await remember('Сборка: pnpm build, перед коммитом pnpm check')).toBe('Запомнено в AGENTS.md')
    expect(await remember('Сборка: pnpm build, перед коммитом pnpm check')).toBe('Уже есть в AGENTS.md')
    await remember('API отвечает только localhost')
    const text = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8')
    expect(text.startsWith('# Правила\n\nТесты: pnpm test.')).toBe(true)
    expect(text.match(/## Заметки/g)).toHaveLength(1)
    expect(text).toMatch(/- Сборка: pnpm build, перед коммитом pnpm check _\(\d{4}-\d{2}-\d{2}\)_\n- API отвечает только localhost/)
  })

  it('без файла памяти remember создаёт HEPHAESTUS.md', async () => {
    await fs.rm(path.join(dir, 'AGENTS.md'))
    expect(await remember('Язык проекта — TypeScript')).toBe('Запомнено в HEPHAESTUS.md')
    expect(await fs.readFile(path.join(dir, 'HEPHAESTUS.md'), 'utf8')).toContain('## Заметки\n\n- Язык проекта — TypeScript')
  })

  it('шлюз добавляет память проекта в системное сообщение', async () => {
    const bodies: { messages: { role: string; content: string }[] }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/chat/completions')) bodies.push(JSON.parse(init!.body as string))
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ок' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })}\n\ndata: [DONE]\n\n`)
      }),
    )
    for await (const _ of runLLM({ model: 'x/y:free', messages: [{ role: 'system', content: 'Ты ревьюер.' }, { role: 'user', content: 'Проверь' }], tools: ['files_read'] })) void _
    const sys = bodies[0].messages[0]
    expect(sys.role).toBe('system')
    expect(sys.content.startsWith('Ты ревьюер.')).toBe(true)
    expect(sys.content).toContain('Язык проекта — TypeScript')
  })
})
