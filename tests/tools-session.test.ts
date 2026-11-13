import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-tools-'))
const toolsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-shared-'))
process.env.HEPHAESTUS_WORKSPACE = dir
process.env.HEPHAESTUS_TOOLS = toolsDir
process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM

const { resolveWorkspacePath, deleteWorkspacePath, writeWorkspaceFile, readWorkspaceFile } = await import('@/lib/server/workspace')
const { commandEnv, toolsEnv } = await import('@/lib/server/terminal')
const { parseRepoUrl } = await import('@/lib/server/git')
const { searchCode, findFiles } = await import('@/lib/server/code-search')
const { projectContext } = await import('@/lib/server/memory')
const { appendSessionNote, copySession, readSession, sessionContext } = await import('@/lib/server/sessions')
const { runLLM } = await import('@/lib/server/llm')

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(toolsDir, { recursive: true, force: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('общая папка инструментов @tools', () => {
  it('пути @tools/… ведут в общую папку, а не в проект', async () => {
    const r = await resolveWorkspacePath('@tools/repos/x/README.md')
    expect(r.abs).toBe(path.join(toolsDir, 'repos/x/README.md'))
    expect(r.rel).toBe('@tools/repos/x/README.md')
    await expect(resolveWorkspacePath('@tools/../etc/passwd')).rejects.toThrow()
  })

  it('файлы в @tools читаются и ищутся, корень удалить нельзя', async () => {
    await writeWorkspaceFile('@tools/repos/janitor/README.md', '# janitor\nscan_repo --report\n')
    expect((await readWorkspaceFile('@tools/repos/janitor/README.md')).content).toContain('scan_repo')
    const hits = await searchCode('scan_repo', { path: '@tools', engine: 'node' })
    expect(hits[0]?.path).toBe('@tools/repos/janitor/README.md')
    expect(await findFiles('*.md', '@tools')).toContain('@tools/repos/janitor/README.md')
    await expect(deleteWorkspacePath('@tools')).rejects.toThrow()
    await expect(deleteWorkspacePath('')).rejects.toThrow()
  })

  it('bin и venv общей папки — в PATH команд, npm -g ставит туда же', () => {
    const env = toolsEnv('/t', '/usr/bin')
    expect(env.PATH.split(path.delimiter).slice(0, 2)).toEqual([path.join('/t', 'bin'), path.join('/t', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin')])
    expect(env.PATH.endsWith('/usr/bin')).toBe(true)
    expect(env.NPM_CONFIG_PREFIX).toBe('/t')
    expect(env.HEPHAESTUS_TOOLS).toBe('/t')
  })

  it('git-настройки из окружения не ломают git в командах', () => {
    const env = commandEnv({ PATH: '/bin', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.x.insteadOf', GIT_CONFIG_VALUE_0: 'y', OPENROUTER_API_KEY: 's' })
    expect(Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG') || k.includes('OPENROUTER'))).toEqual([])
    expect(env.PATH).toBe('/bin')
  })

  it('модель знает, что может клонировать и запускать инструменты', async () => {
    const { saveServerSettings } = await import('@/lib/server/settings')
    await saveServerSettings({ terminal: 'full' })
    const text = await projectContext(['files_read', 'terminal'])
    expect(text).toContain('git_clone')
    expect(text).toContain('@tools/repos')
    expect(text).toContain('janitor') // уже установленное перечислено
    await saveServerSettings({ terminal: 'off' })
  })
})

describe('команда для блока Кузницы', () => {
  it('raw — только вывод, ошибка с кодом выхода; в копии проекта видны файлы копии', async () => {
    const { saveServerSettings } = await import('@/lib/server/settings')
    const { runTool } = await import('@/lib/server/tools')
    const { createSandbox, removeSandbox } = await import('@/lib/server/sandboxes')
    const { POST } = await import('@/app/api/tools/route')
    await saveServerSettings({ terminal: 'full' })
    await fs.writeFile(path.join(dir, 'marker.txt'), 'оригинал')
    expect(await runTool('run_command', { command: 'cat marker.txt', raw: true })).toEqual({ ok: true, output: 'оригинал' })
    const bad = await runTool('run_command', { command: 'echo упало; exit 3', raw: true })
    expect(bad).toEqual({ ok: false, output: 'упало\n[код выхода 3]' })

    const { id } = await createSandbox('тест')
    const call = (body: object) => POST(new Request('http://localhost/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    expect(await (await call({ name: 'run_command', args: { command: 'echo -n копия > marker.txt', raw: true }, sandbox: id })).json()).toMatchObject({ ok: true })
    expect(await fs.readFile(path.join(dir, 'marker.txt'), 'utf8')).toBe('оригинал') // оригинал не тронут
    expect(await (await call({ name: 'run_command', args: { command: 'cat marker.txt', raw: true }, sandbox: id })).json()).toEqual({ ok: true, output: 'копия' })
    // Папка проекта пайплайна: подпапка работает как рабочая, выйти за пределы нельзя
    await fs.mkdir(path.join(dir, 'repos/app'), { recursive: true })
    await fs.writeFile(path.join(dir, 'repos/app/marker.txt'), 'подпапка')
    expect(await (await call({ name: 'run_command', args: { command: 'cat marker.txt', raw: true }, root: 'repos/app' })).json()).toEqual({ ok: true, output: 'подпапка' })
    expect(await (await call({ name: 'read_file', args: { path: '../../marker.txt' }, root: 'repos/app' })).json()).toMatchObject({ ok: false })
    expect(await (await call({ name: 'run_command', args: { command: 'pwd', raw: true }, root: '../..' })).json()).toMatchObject({ ok: false, output: expect.stringContaining('за пределы') })
    await removeSandbox(id)
    await saveServerSettings({ terminal: 'off' })
  })
})

describe('heph-deps-audit', () => {
  it('ставится в общую папку инструментов и находит менеджер пакетов', async () => {
    const { saveServerSettings } = await import('@/lib/server/settings')
    const { runTool } = await import('@/lib/server/tools')
    await saveServerSettings({ terminal: 'full' })
    await fs.mkdir(path.join(dir, 'nolock'), { recursive: true })
    await fs.writeFile(path.join(dir, 'nolock/package.json'), '{"name":"x"}')
    const r = await runTool('run_command', { command: 'heph-deps-audit', cwd: 'nolock', raw: true })
    expect(r.output).toContain('без lock-файла')
    expect(await fs.readdir(path.join(toolsDir, 'bin'))).toEqual(expect.arrayContaining(['heph-deps-audit', 'heph-deps-audit.mjs']))
    await saveServerSettings({ terminal: 'off' })
  })
})

describe('папка проекта в запросе модели', () => {
  it('инструменты модели работают в подпапке, как в рабочей папке', async () => {
    await fs.mkdir(path.join(dir, 'repos/svc'), { recursive: true })
    await fs.writeFile(path.join(dir, 'repos/svc/app.js'), 'const secret = 1')
    let call = 0
    const results: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string)
        const tool = body.messages.find((m: { role: string }) => m.role === 'tool')
        if (tool) results.push(tool.content)
        const delta = call++ === 0 ? { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"app.js"}' } }] } : { content: 'готово' }
        return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })}\n\ndata: [DONE]\n\n`)
      }),
    )
    const sys: string[] = []
    for await (const e of runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'прочитай' }], tools: ['files_read'], root: 'repos/svc' })) if (e.t === 'error') sys.push(e.message)
    expect(sys).toEqual([])
    expect(results[0]).toContain('const secret = 1')
  })
})

describe('ссылки на репозитории', () => {
  it('принимает https и ssh, ссылку на файл сводит к репозиторию', () => {
    expect(parseRepoUrl('https://github.com/YpCIIIaK/repo-janitor')).toEqual({ url: 'https://github.com/YpCIIIaK/repo-janitor', name: 'repo-janitor' })
    expect(parseRepoUrl('https://github.com/YpCIIIaK/repo-janitor/blob/main/benchmark/ROUTINE.md')).toEqual({ url: 'https://github.com/YpCIIIaK/repo-janitor', name: 'repo-janitor' })
    expect(parseRepoUrl('git@github.com:owner/tool.git').name).toBe('tool')
  })
  it('отклоняет локальные пути и опасные транспорты', () => {
    for (const bad of ['ext::sh -c touch% /tmp/x', 'file:///etc', '/home/user/repo', '--upload-pack=x', 'http://example.com/a/b']) expect(() => parseRepoUrl(bad)).toThrow()
  })
})

describe('память сессии', () => {
  it('заметки копятся, повтор не дублируется, перенос дописывает в другую сессию', async () => {
    expect(await appendSessionNote('chat_a', 'src/core.ts:42 — точка входа', 'Модель А')).toBe('Записано в память сессии')
    expect(await appendSessionNote('chat_a', 'src/core.ts:42 — точка входа')).toBe('Уже есть в памяти сессии')
    expect(await readSession('chat_a')).toMatch(/### .* · Модель А\nsrc\/core.ts:42/)
    await expect(appendSessionNote('../x', 'a')).rejects.toThrow()
    await copySession('chat_a', 'chat_b', 'Пользователь: сделай ядро')
    const b = await readSession('chat_b')
    expect(b).toContain('Перенесено из другого диалога')
    expect(b).toContain('src/core.ts:42')
    expect(b).toContain('сделай ядро')
    expect(await sessionContext('chat_b', false)).toContain('<session_memory>')
    expect(await sessionContext('chat_empty', false)).toBe('')
  })

  it('модель записывает заметку инструментом и видит память в следующем запросе', async () => {
    const bodies: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] }[] = []
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes('/chat/completions')) return new Response('{}')
        bodies.push(JSON.parse(init!.body as string))
        const delta =
          call++ === 0
            ? { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'session_note', arguments: JSON.stringify({ note: 'Ядро: lib/engine, 12 модулей' }) } }] }
            : { content: 'готово' }
        return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })}\n\ndata: [DONE]\n\n`)
      }),
    )
    const req = { model: 'x/y:free', messages: [{ role: 'user' as const, content: 'Изучи ядро' }], tools: ['files_read' as const], session: 'chat_live', sessionAuthor: 'Тест' }
    for await (const _ of runLLM(req)) void _
    expect(bodies[0].tools?.some((t) => t.function.name === 'session_note')).toBe(true)
    expect(await readSession('chat_live')).toContain('Ядро: lib/engine, 12 модулей')
    for await (const _ of runLLM(req)) void _
    expect(bodies[2].messages[0].content).toContain('Ядро: lib/engine, 12 модулей')
  })
})
