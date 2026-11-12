import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LLMEvent } from '@/lib/types'

// Копии проекта для параллельных правок
const project = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-proj-'))
process.env.HEPHAESTUS_WORKSPACE = project
process.env.HEPHAESTUS_TERMINAL = 'full'
process.env.OPENROUTER_API_KEY = 'sk-or-test'
delete process.env.HEPHAESTUS_MOCK_LLM

const { applySandbox, createSandbox, diffSandbox, removeSandbox, sandboxTree } = await import('@/lib/server/sandboxes')
const { runInWorkspace } = await import('@/lib/server/workspace-scope')
const { runTool } = await import('@/lib/server/tools')
const { runLLM } = await import('@/lib/server/llm')
const { saveServerSettings } = await import('@/lib/server/settings')

const write = async (root: string, rel: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true })
  await fs.writeFile(path.join(root, rel), content)
}
const read = (root: string, rel: string) => fs.readFile(path.join(root, rel), 'utf8')
const exists = (p: string) => fs.stat(p).then(() => true, () => false)

beforeAll(async () => {
  await write(project, 'src/math.js', 'export const add = (a, b) => a + b\n')
  await write(project, 'src/old.js', 'export const legacy = 1\n')
  await write(project, '.gitignore', 'dist/\n*.log\n')
  await write(project, 'node_modules/dep/index.js', 'module.exports = 42\n')
  execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: project })
  // незакоммиченная правка должна попасть в копию
  await write(project, 'src/math.js', 'export const add = (a, b) => a + b\nexport const sub = (a, b) => a - b\n')
})
afterAll(() => fs.rm(project, { recursive: true, force: true }))
afterEach(() => vi.unstubAllGlobals())

describe('копии проекта', () => {
  let id: string
  let tree: string

  it('копируют рабочее дерево с незакоммиченными правками, зависимости подключают ссылкой', async () => {
    const r = await createSandbox('Умная')
    id = r.id
    tree = await sandboxTree(id)
    expect(await read(tree, 'src/math.js')).toContain('sub')
    expect((await fs.lstat(path.join(tree, 'node_modules'))).isSymbolicLink()).toBe(true)
    expect(await read(tree, 'node_modules/dep/index.js')).toBe('module.exports = 42\n')
    expect(await exists(path.join(tree, '.git'))).toBe(false)
  })

  it('инструменты модели в копии меняют копию, а не проект', async () => {
    const scope = { root: tree, sandbox: true }
    await runInWorkspace(scope, async () => {
      expect((await runTool('edit_file', { path: 'src/math.js', old_text: 'a - b', new_text: 'a - b - 0' })).ok).toBe(true)
      await runTool('write_file', { path: 'src/new.js', content: 'export const n = 1\n' })
      await runTool('delete_file', { path: 'src/old.js' })
      // сборка в копии: артефакты в игнорируемой папке не считаются правками
      const r = await runTool('run_command', { command: 'mkdir -p dist && echo built > dist/out.js && pwd' })
      expect(r.output).toContain(tree)
    })
    expect(await read(project, 'src/math.js')).not.toContain('a - b - 0')
    expect(await exists(path.join(project, 'src/new.js'))).toBe(false)
    expect(await exists(path.join(project, 'src/old.js'))).toBe(true)
  })

  it('diff показывает добавленные, изменённые и удалённые файлы', async () => {
    const d = await diffSandbox(id)
    expect(d.files).toEqual([
      { path: 'src/math.js', status: 'modified', additions: 1, deletions: 1 },
      { path: 'src/new.js', status: 'added', additions: 1, deletions: 0 },
      { path: 'src/old.js', status: 'deleted', additions: 0, deletions: 1 },
    ])
    expect(d.patch).toContain('-export const sub = (a, b) => a - b')
    expect(d.patch).toContain('+export const sub = (a, b) => a - b - 0')
    expect(d.patch).not.toContain('dist/out.js')
  })

  it('применение переносит правки, а изменённые в проекте файлы не трогает', async () => {
    // пользователь тем временем сам поправил math.js в проекте
    await write(project, 'src/math.js', 'export const add = (a, b) => a + b // мои правки\n')
    const r = await applySandbox(id)
    expect(r.applied.sort()).toEqual(['src/new.js', 'src/old.js'])
    expect(r.conflicts).toEqual(['src/math.js'])
    expect(await read(project, 'src/new.js')).toBe('export const n = 1\n')
    expect(await exists(path.join(project, 'src/old.js'))).toBe(false)
    expect(await read(project, 'src/math.js')).toContain('мои правки')
    // применённое больше не показывается как изменение
    expect((await diffSandbox(id)).files.map((f) => f.path)).toEqual(['src/math.js'])
    await removeSandbox(id)
    await expect(sandboxTree(id)).rejects.toThrow(/не найдена/)
  })

  it('шлюз выполняет инструменты модели в её копии', async () => {
    const { id: sb } = await createSandbox('Основная')
    const answers = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"from-model.txt","content":"привет"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [{ delta: { content: 'Готово' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } },
    ]
    const bodies: { messages: { role: string; content: string }[] }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(init!.body as string))
        return new Response(`data: ${JSON.stringify(answers.shift())}\n\ndata: [DONE]\n\n`)
      }),
    )
    const events: LLMEvent[] = []
    for await (const e of runLLM({ model: 'x/y:free', messages: [{ role: 'user', content: 'Создай файл' }], tools: ['files_write'], sandbox: sb })) events.push(e)
    expect(events.find((e) => e.t === 'tool_result')).toMatchObject({ ok: true })
    expect(await read(await sandboxTree(sb), 'from-model.txt')).toBe('привет')
    expect(await exists(path.join(project, 'from-model.txt'))).toBe(false)
    expect(bodies[0].messages[0].content).toContain('отдельная копия проекта')
    await removeSandbox(sb)
  })

  it('работают и в проекте без git', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-plain-'))
    try {
      await write(plain, 'a.txt', 'one\n')
      await write(plain, 'build/out.txt', 'artifact\n')
      await saveServerSettings({ workspaceDir: plain })
      const { id: sb } = await createSandbox('x')
      const t = await sandboxTree(sb)
      expect(await exists(path.join(t, 'build/out.txt'))).toBe(false)
      await write(t, 'a.txt', 'two\n')
      expect((await diffSandbox(sb)).files).toEqual([{ path: 'a.txt', status: 'modified', additions: 1, deletions: 1 }])
      expect(await applySandbox(sb)).toEqual({ applied: ['a.txt'], conflicts: [] })
      expect(await read(plain, 'a.txt')).toBe('two\n')
      await removeSandbox(sb)
    } finally {
      await saveServerSettings({ workspaceDir: '' })
      await fs.rm(plain, { recursive: true, force: true })
    }
  })

  it('id копии проверяется — путь не подставить', async () => {
    await expect(sandboxTree('../../etc')).rejects.toThrow(/Некорректный id/)
  })
})
