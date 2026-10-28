import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-ws-'))
process.env.HEPHAESTUS_WORKSPACE = dir

const ws = await import('@/lib/server/workspace')
const { runTool } = await import('@/lib/server/tools')
const { parseDdgLite, htmlToText, assertPublicUrl } = await import('@/lib/server/web')
const { parseSkill, serializeSkill, slugify } = await import('@/lib/server/skills')

describe('workspace', () => {
  beforeAll(async () => {
    await fs.writeFile(path.join(os.tmpdir(), 'heph-secret.txt'), 'secret')
  })

  it('не выпускает за пределы песочницы', async () => {
    await expect(ws.resolveWorkspacePath('../heph-secret.txt')).rejects.toThrow(/за пределы/)
    await expect(ws.resolveWorkspacePath('/etc/passwd')).resolves.toMatchObject({ rel: 'etc/passwd' })
    await fs.symlink(os.tmpdir(), path.join(dir, 'escape'))
    await expect(ws.readWorkspaceFile('escape/heph-secret.txt')).rejects.toThrow(/за пределы/)
  })

  it('пишет, правит, читает и удаляет файлы', async () => {
    await ws.writeWorkspaceFile('a/b.txt', 'one\ntwo\nthree')
    await ws.editWorkspaceFile('a/b.txt', 'two', 'TWO')
    expect((await ws.readWorkspaceFile('a/b.txt')).content).toBe('one\nTWO\nthree')
    expect((await ws.readWorkspaceFile('a/b.txt', { startLine: 2, endLine: 2 })).content).toBe('TWO')
    await expect(ws.editWorkspaceFile('a/b.txt', 'нет такого', 'x')).rejects.toThrow(/не найден/)
    expect(ws.flattenTree(await ws.listTree())).toContain('a/b.txt')
    await ws.deleteWorkspacePath('a')
    await expect(ws.readWorkspaceFile('a/b.txt')).rejects.toThrow(/не найден/)
    await expect(ws.deleteWorkspacePath('.')).rejects.toThrow(/корень/)
  })

  it('инструменты возвращают ошибки текстом, а не падают', async () => {
    expect(await runTool('read_file', { path: '../x' })).toMatchObject({ ok: false })
    expect(await runTool('read_file', '{bad json')).toMatchObject({ ok: false })
    expect(await runTool('nope', {})).toMatchObject({ ok: false })
    expect((await runTool('write_file', { path: 'n.md', content: 'hi' })).ok).toBe(true)
    expect((await runTool('list_files', {})).output).toContain('n.md')
  })
})

describe('веб', () => {
  it('разбирает выдачу DuckDuckGo Lite и раскрывает редиректы', () => {
    const html = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=x" class='result-link'>Example &amp; Co</a></td></tr>
      <tr><td class='result-snippet'>Some <b>snippet</b></td></tr></table>`
    expect(parseDdgLite(html, 5)).toEqual([{ title: 'Example & Co', url: 'https://example.com/page', snippet: 'Some snippet' }])
  })
  it('превращает HTML в текст', () => {
    const r = htmlToText('<title>T</title><script>x()</script><h2>Заголовок</h2><p>Текст&nbsp;тут</p><ul><li>a</li></ul>')
    expect(r.title).toBe('T')
    expect(r.text).toContain('## Заголовок')
    expect(r.text).toContain('Текст тут')
    expect(r.text).not.toContain('x()')
  })
  it('не пускает в локальную сеть', () => {
    for (const u of ['http://localhost:3000/api', 'http://127.0.0.1', 'http://192.168.1.1', 'http://10.0.0.1', 'file:///etc/passwd', 'http://[::1]/']) {
      expect(() => assertPublicUrl(u), u).toThrow()
    }
    expect(assertPublicUrl('https://example.com').hostname).toBe('example.com')
  })
})

describe('навыки', () => {
  it('разбирают и сохраняют шапку', () => {
    const s = parseSkill('x', serializeSkill({ name: 'Ревью: код', description: 'Проверка "кода"', category: 'dev', content: 'Тело' }))
    expect(s).toMatchObject({ name: 'Ревью: код', description: 'Проверка "кода"', category: 'dev', content: 'Тело' })
    expect(slugify('Анализ данных!')).toBe('analiz-dannyh')
  })
})
