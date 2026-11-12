import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// Рабочая папка моделей: файлы, поиск по коду и терминал
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-bench-'))
process.env.HEPHAESTUS_WORKSPACE = dir
process.env.OPENROUTER_API_KEY = 'sk-or-секрет'

const { runTool, buildTools } = await import('@/lib/server/tools')
const { validateWorkspaceDir } = await import('@/lib/server/settings')
const { codebaseSearch, codeTokenize, matchGlob, searchCode, hasRipgrep, resetCodeIndex } = await import('@/lib/server/code-search')
const { checkCommand, commandEnv } = await import('@/lib/server/terminal')
const { isAllowedHost } = await import('@/lib/host-check')

const write = async (rel: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
  await fs.writeFile(path.join(dir, rel), content)
}
const tool = (name: string, args: Record<string, unknown>) => runTool(name, args)

afterAll(() => fs.rm(dir, { recursive: true, force: true }))

describe('рабочая папка', () => {
  it('принимает только существующую отдельную папку', async () => {
    await expect(validateWorkspaceDir('projects/app')).rejects.toThrow(/абсолютный путь/)
    await expect(validateWorkspaceDir(path.join(dir, 'нет-такой'))).rejects.toThrow(/не найдена/)
    await expect(validateWorkspaceDir(path.parse(dir).root)).rejects.toThrow(/Корень диска/)
    await expect(validateWorkspaceDir(os.homedir())).rejects.toThrow(/Домашнюю папку/)
    expect(await validateWorkspaceDir(`${dir}/./`)).toBe(dir)
  })

  it('читает с номерами строк и правит фрагмент, даже если модель скопировала номера', async () => {
    await write('src/app.ts', 'const a = 1\nconst b = 2\nexport { a, b }\n')
    const read = await tool('read_file', { path: 'src/app.ts' })
    expect(read.output).toContain('1│ const a = 1')
    expect(read.output).toContain('2│ const b = 2')
    // модель вставила в old_text строки вместе с номерами
    const edit = await tool('edit_file', { path: 'src/app.ts', old_text: '2│ const b = 2', new_text: '2│ const b = 3' })
    expect(edit).toEqual({ ok: true, output: 'Изменён src/app.ts' })
    expect(await fs.readFile(path.join(dir, 'src/app.ts'), 'utf8')).toBe('const a = 1\nconst b = 3\nexport { a, b }\n')
  })

  it('неоднозначную замену отклоняет, а с replace_all меняет все вхождения', async () => {
    await write('dup.txt', 'x\nx\n')
    expect((await tool('edit_file', { path: 'dup.txt', old_text: 'x', new_text: 'y' })).output).toMatch(/встречается 2 раз/)
    expect((await tool('edit_file', { path: 'dup.txt', old_text: 'x', new_text: 'y', replace_all: true })).output).toMatch(/замен: 2/)
    expect(await fs.readFile(path.join(dir, 'dup.txt'), 'utf8')).toBe('y\ny\n')
  })

  it('параллельные правки одного файла разными моделями не теряются', async () => {
    await write('shared.ts', Array.from({ length: 20 }, (_, i) => `<line ${i}>`).join('\n'))
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => tool('edit_file', { path: 'shared.ts', old_text: `<line ${i}>`, new_text: `<edited ${i}>` })))
    expect(results.filter((r) => !r.ok)).toEqual([])
    const text = await fs.readFile(path.join(dir, 'shared.ts'), 'utf8')
    expect(text.split('\n')).toEqual(Array.from({ length: 20 }, (_, i) => `<edited ${i}>`))
  })

  it('перемещает файлы и не выпускает за пределы папки', async () => {
    await write('old/name.md', '# hi')
    expect((await tool('move_file', { from: 'old/name.md', to: 'docs/new.md' })).output).toBe('Перемещено: old/name.md → docs/new.md')
    expect((await tool('move_file', { from: 'docs/new.md', to: '../escape.md' })).output).toMatch(/за пределы/)
    expect((await tool('list_files', { path: 'docs' })).output).toBe('docs/new.md')
  })

  it('принимает абсолютные пути внутри рабочей папки, а «/путь» считает от корня проекта', async () => {
    await write('abs/one.txt', 'один')
    expect((await tool('read_file', { path: path.join(dir, 'abs/one.txt') })).output).toContain('1│ один')
    expect((await tool('read_file', { path: '/abs/one.txt' })).output).toContain('1│ один')
    expect((await tool('list_files', { path: dir, depth: 1 })).output).toContain('abs/')
  })

  it('list_files с глубиной показывает подпапки, не раскрывая их', async () => {
    await write('deep/a/b/c.txt', 'c')
    const out = (await tool('list_files', { depth: 1 })).output
    expect(out).toContain('deep/')
    expect(out).not.toContain('deep/a/b/c.txt')
  })
})

describe('поиск по коду', () => {
  beforeEach(() => resetCodeIndex())

  it('маски файлов в стиле gitignore', () => {
    expect(matchGlob('*.ts', 'src/a/b.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'src/a/b.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'src/b.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'lib/b.ts')).toBe(false)
    expect(matchGlob('*.{ts,tsx}', 'x.tsx')).toBe(true)
    expect(matchGlob('*.test.?s', 'a.test.js')).toBe(true)
  })

  it('идентификаторы разбираются на слова', () => {
    expect(codeTokenize('getUserById')).toEqual(expect.arrayContaining(['get', 'user', 'id', 'getuserbyid']))
    expect(codeTokenize('MAX_RETRY_COUNT')).toEqual(expect.arrayContaining(['max', 'retry', 'count']))
  })

  const engines: ('node' | 'rg')[] = hasRipgrep() ? ['node', 'rg'] : ['node']
  it.each(engines)('search_code (%s): регулярные выражения, маски, регистр, node_modules пропускается', async (engine) => {
    await write('src/auth/session.ts', 'export function getUserById(id: string) {\n  return db.users.find(id)\n}\n')
    await write('src/auth/session.test.ts', "import { getUserById } from './session'\n")
    await write('node_modules/lib/index.js', 'function getUserById() {}\n')
    const all = await searchCode('getUserById\\(', { engine })
    expect(all.map((h) => `${h.path}:${h.line}`)).toEqual(['src/auth/session.ts:1'])
    const ts = await searchCode('getuserbyid', { engine, ignoreCase: true, glob: '*.test.ts', literal: true })
    expect(ts.map((h) => h.path)).toEqual(['src/auth/session.test.ts'])
    await expect(searchCode('(unclosed', { engine })).rejects.toThrow()
  })

  it('codebase_search находит код по описанию и замечает изменения файлов', async () => {
    await write('src/payments/refund.ts', 'export async function refundOrder(orderId: string) {\n  const payment = await loadPayment(orderId)\n  return gateway.refund(payment)\n}\n')
    await write('src/ui/button.tsx', 'export function Button() { return <button /> }\n')
    const hits = await codebaseSearch('refund order payment', 3)
    expect(hits[0].path).toBe('src/payments/refund.ts')
    expect(hits[0].startLine).toBe(1)

    await write('src/ui/button.tsx', 'export function RefundButton() { return <button onClick={refundOrder} /> }\n')
    const again = await codebaseSearch('RefundButton', 3)
    expect(again[0].path).toBe('src/ui/button.tsx')
  })
})

describe('терминал', () => {
  it('выключен по умолчанию и не предлагается моделям', async () => {
    delete process.env.HEPHAESTUS_TERMINAL
    const names = (await buildTools(['terminal', 'code'])).map((t) => t.function.name)
    expect(names).not.toContain('run_command')
    expect(names).toContain('search_code')
    expect((await tool('run_command', { command: 'echo hi' })).output).toMatch(/Терминал выключен/)
  })

  describe('с полным доступом', () => {
    beforeEach(() => {
      process.env.HEPHAESTUS_TERMINAL = 'full'
    })

    it('выполняет команду в рабочей папке и возвращает код выхода', async () => {
      await write('sub/marker.txt', 'ok')
      const r = await tool('run_command', { command: 'cat marker.txt && echo " done" && exit 3', cwd: 'sub' })
      expect(r.ok).toBe(false)
      expect(r.output).toContain('ok done')
      expect(r.output).toContain('код выхода 3')
      expect((await tool('run_command', { command: 'pwd' })).output).toContain(dir)
    })

    it('не передаёт ключи и токены в команды', async () => {
      const r = await tool('run_command', { command: 'echo "[$OPENROUTER_API_KEY]"' })
      expect(r.output).toContain('[]')
      expect(commandEnv({ PATH: '/bin', GH_TOKEN: 't', MY_SECRET: 's', HOME: '/h' })).toMatchObject({ PATH: '/bin', HOME: '/h' })
      expect(commandEnv({ GH_TOKEN: 't', MY_SECRET: 's' })).not.toHaveProperty('GH_TOKEN')
    })

    it('прерывает зависшую команду по таймауту вместе с дочерними процессами', async () => {
      const started = Date.now()
      const r = await tool('run_command', { command: 'sleep 30 & sleep 30', timeout_sec: 1 })
      expect(r.output).toMatch(/таймауту/)
      expect(Date.now() - started).toBeLessThan(8000)
    })

    it('длинный вывод обрезает с середины, сохраняя конец', async () => {
      const r = await tool('run_command', { command: 'seq 1 20000; echo ИТОГ: ошибка в тесте' })
      expect(r.output).toContain('пропущено')
      expect(r.output).toContain('ИТОГ: ошибка в тесте')
      expect(r.output.length).toBeLessThan(17_000)
    })

    it('отклоняет явно катастрофические команды', () => {
      expect(() => checkCommand('rm -rf /')).toThrow(/корня/)
      expect(() => checkCommand('sudo rm -rf ~')).toThrow()
      expect(() => checkCommand('mkfs.ext4 /dev/sda1')).toThrow(/форматирование/)
      expect(() => checkCommand('rm -rf ./build && npm test')).not.toThrow()
    })

    it('фоновый процесс: запуск, новый вывод, остановка', async () => {
      const body = (out: string) => out.slice(out.indexOf('\n\n') + 2)
      const start = await tool('start_process', { command: 'echo "$((40+2))"; sleep 3; echo "$((6*7+1))"; sleep 30' })
      const id = start.output.match(/\[(p\d+)\]/)![1]
      expect(body(start.output)).toBe('42')
      expect(start.output).toContain('работает')
      await new Promise((r) => setTimeout(r, 2000))
      // следующий вызов возвращает только новый вывод
      const more = await tool('process_output', { id })
      expect(body(more.output)).toBe('43')
      expect((await tool('stop_process', { id })).output).toBe(`Процесс ${id} остановлен`)
    }, 15_000)
  })
})

describe('защита API', () => {
  it('отвечает только на запросы к localhost', () => {
    expect(isAllowedHost('localhost:3000')).toBe(true)
    expect(isAllowedHost('127.0.0.1:3000')).toBe(true)
    expect(isAllowedHost('[::1]:3000')).toBe(true)
    expect(isAllowedHost('app.localhost')).toBe(true)
    // DNS rebinding: чужой домен указывает на 127.0.0.1
    expect(isAllowedHost('evil.example.com:3000')).toBe(false)
    expect(isAllowedHost('127.0.0.1.evil.com')).toBe(false)
    expect(isAllowedHost(null)).toBe(false)
    expect(isAllowedHost('nas.lan:3000', 'nas.lan, pc.lan')).toBe(true)
  })
})
