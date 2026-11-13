import { describe, expect, it } from 'vitest'
import { splitMarkdown } from '@/components/markdown'

const table = (rows: number) => ['| Severity | Issue |', '|---|---|', ...Array.from({ length: rows }, (_, i) => `| critical | находка ${i} |`)].join('\n')

describe('splitMarkdown', () => {
  it('короткий текст — одна часть', () => {
    expect(splitMarkdown('# Заголовок\n\nТекст')).toEqual(['# Заголовок\n\nТекст'])
  })

  it('большая таблица делится по строкам, у каждой части — заголовок', () => {
    const chunks = splitMarkdown(`# Отчёт\n\n${table(300)}`)
    expect(chunks.length).toBeGreaterThan(1)
    const all = chunks.join('\n\n')
    for (let i = 0; i < 300; i++) expect(all).toContain(`находка ${i} |`)
    const tables = all.split('| Severity | Issue |').length - 1
    expect(tables).toBe(Math.ceil(300 / 40))
    for (const c of chunks.slice(1)) expect(c.startsWith('| Severity | Issue |\n|---|---|')).toBe(true)
  })

  it('не режет блок кода с пустыми строками', () => {
    const code = '```ts\nconst a = 1\n\nconst b = 2\n```'
    const text = Array.from({ length: 40 }, (_, i) => `Абзац ${i} ${'x'.repeat(200)}`).join('\n\n') + `\n\n${code}`
    const chunks = splitMarkdown(text)
    expect(chunks.some((c) => c.includes(code))).toBe(true)
  })
})
