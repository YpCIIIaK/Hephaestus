import { describe, expect, it } from 'vitest'
import { buildChatMessages, parseJudge, type Conversation } from '@/lib/engine/chat'

const conv = (n: number): Conversation => ({
  id: 'c',
  title: '',
  createdAt: 0,
  updatedAt: 0,
  targets: [],
  systemPrompt: '',
  tools: [],
  turns: Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    user: `вопрос ${i} ${'слово '.repeat(200)}`,
    createdAt: 0,
    replies: { 'model:a': { status: 'done', text: `ответ a${i}`, startedAt: 0 }, 'model:b': { status: 'error', text: '', startedAt: 0 } },
  })),
})

describe('история чата', () => {
  it('у каждого участника своя история', () => {
    const c = conv(3)
    const a = buildChatMessages(c, 'model:a', 2, 'sys', 100_000).messages
    expect(a.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
    const b = buildChatMessages(c, 'model:b', 2, '', 100_000).messages
    expect(b.map((m) => m.role)).toEqual(['user']) // у b не было успешных ответов
  })

  it('обрезает старые ходы по бюджету токенов', () => {
    const c = conv(10)
    const { messages, droppedTurns } = buildChatMessages(c, 'model:a', 9, 'sys', 1500)
    expect(droppedTurns).toBeGreaterThan(0)
    expect(messages[0].content).toContain('опущены')
    expect(messages.at(-1)!.content).toContain('вопрос 9')
  })

  it('разбирает ответ судьи', () => {
    const r = parseJudge('```json\n{"ranking":[{"answer":2,"score":9},{"answer":1,"score":5}],"best":2}\n```\n\n## Итоговый ответ\nЛучший', ['model:a', 'model:b'])
    expect(r.bestKey).toBe('model:b')
    expect(r.ranking[0].key).toBe('model:b')
    expect(r.synthesis).toBe('Лучший')
  })
})
