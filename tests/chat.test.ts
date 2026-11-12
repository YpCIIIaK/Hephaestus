import { describe, expect, it } from 'vitest'
import { buildChatMessages, buildJudgeMessages, buildTitleMessages, keyLineage, parseJudge, parseTitle, replaceTarget, resizeTargets, type Conversation } from '@/lib/engine/chat'

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

describe('название диалога', () => {
  it('чистит ответ модели', () => {
    expect(parseTitle('«Отличия TCP и UDP».')).toBe('Отличия TCP и UDP')
    expect(parseTitle('Название: **Сравнение протоколов**\n')).toBe('Сравнение протоколов')
  })
  it('отбрасывает ответ на вопрос вместо названия', () => {
    // так ответила poolside/laguna-xs-2.1:free при лимите 30 токенов
    expect(parseTitle('1. Надёжность: TCP гарантирует доставку и порядок пакетов, UDP')).toBeNull()
    expect(parseTitle('- TCP устанавливает соединение')).toBeNull()
    expect(parseTitle('TCP гарантирует доставку и порядок пакетов, а UDP работает без соединения и быстрее')).toBeNull()
    expect(parseTitle('')).toBeNull()
  })
  it('подаёт сообщение как данные, а не как вопрос', () => {
    const msgs = buildTitleMessages('Чем TCP отличается от UDP?')
    expect(msgs[1].content).toContain('не отвечай')
    expect(msgs[1].content).toContain('Чем TCP отличается от UDP?')
  })
})

describe('судья', () => {
  it('не должен выдумывать результаты тестов, которых не было', () => {
    // на настоящих моделях судья написал «npm test — 3 passed», хотя никто не запускал тесты после правок
    const sys = buildJudgeMessages('Проверь проект', [{ key: 'a', name: 'A', text: 'x' }])[0].content!
    expect(sys).toContain('Не утверждай результатов запусков')
    expect(sys).toContain('<изменения в файлах>')
  })
})

describe('участники чата', () => {
  const turn = (i: number, replies: Record<string, string>, tasks?: Record<string, string>) => ({
    id: `t${i}`,
    user: tasks ? Object.values(tasks)[0] : `вопрос ${i}`,
    tasks,
    createdAt: i,
    replies: Object.fromEntries(Object.entries(replies).map(([k, text]) => [k, { status: 'done' as const, text, startedAt: i }])),
  })
  const conv = (over: Partial<Conversation>): Conversation => ({ id: 'c', title: '', createdAt: 0, updatedAt: 0, targets: [], systemPrompt: '', tools: [], turns: [], ...over })
  const texts = (c: Conversation, key: string, upto: number) => buildChatMessages(c, key, upto, '', 100_000).messages.map((m) => m.content).join('\n')

  it('сменённая модель продолжает историю предыдущей, а не начинает с нуля', () => {
    const c = conv({
      targets: [{ kind: 'model', id: 'a/one' }],
      memory: { 'model:a/one': { uptoTurn: 0, text: 'резюме', at: 1 } },
      turns: [turn(0, { 'model:a/one': 'ответ первой модели' }), turn(1, {})],
    })
    const patch = replaceTarget(c, { kind: 'model', id: 'a/one' }, { kind: 'model', id: 'b/two' })!
    expect(patch.targets).toEqual([{ kind: 'model', id: 'b/two' }])
    expect(patch.memory).toEqual({ 'model:b/two': { uptoTurn: 0, text: 'резюме', at: 1 } })
    const next = { ...c, ...patch }
    expect(texts(next, 'model:b/two', 1)).toContain('ответ первой модели')
    // и дальше по цепочке: третья модель видит историю обеих
    const third = { ...next, ...replaceTarget(next, { kind: 'model', id: 'b/two' }, { kind: 'model', id: 'c/three' })! }
    expect(keyLineage(third, 'model:c/three')).toEqual(['model:c/three', 'model:b/two', 'model:a/one'])
    // вернуться к первой модели можно — без зацикливания цепочки
    const back = { ...third, ...replaceTarget(third, { kind: 'model', id: 'c/three' }, { kind: 'model', id: 'a/one' })! }
    expect(keyLineage(back, 'model:a/one')).toEqual(['model:a/one'])
    // уже участвующую модель второй раз не добавить
    expect(replaceTarget(conv({ targets: [{ kind: 'model', id: 'x' }, { kind: 'model', id: 'y' }] }), { kind: 'model', id: 'x' }, { kind: 'model', id: 'y' })).toBeNull()
  })

  it('число моделей: добавляет недостающие без дублей одной и той же модели и убирает лишние', () => {
    const resolve = (id: string) => ({ '@smart': 'n/ultra', '@default': 'n/super', '@fast': 'n/super' })[id] ?? id
    const one = [{ kind: 'model' as const, id: '@smart' }]
    expect(resizeTargets(one, 3, ['@smart', '@default', '@fast', 'g/gemma'], resolve).map((t) => t.id)).toEqual(['@smart', '@default', 'g/gemma'])
    expect(resizeTargets([...one, { kind: 'agent', id: 'coder' }, { kind: 'model', id: 'x' }], 1, [], resolve)).toEqual(one)
    expect(resizeTargets(one, 0, [])).toEqual(one)
  })

  it('разные задачи: каждый участник видит в истории свою задачу', () => {
    const c = conv({
      targets: [{ kind: 'model', id: 'a' }, { kind: 'model', id: 'b' }],
      turns: [turn(0, { 'model:a': 'стих готов', 'model:b': 'код готов' }, { 'model:a': 'напиши стих', 'model:b': 'напиши код' }), turn(1, {}, { 'model:a': 'короче', 'model:b': 'добавь тесты' })],
    })
    expect(texts(c, 'model:a', 1)).toBe('напиши стих\nстих готов\nкороче')
    expect(texts(c, 'model:b', 1)).toBe('напиши код\nкод готов\nдобавь тесты')
  })
})

describe('судья диалога с инструкцией', async () => {
  const { canJudge } = await import('@/lib/client/chat-runner')
  const replies = [
    { key: 'model:a', name: 'A', text: 'PostgreSQL', task: 'Выбери БД для магазина' },
    { key: 'model:b', name: 'B', text: 'MongoDB', task: 'Выбери БД для логов' },
  ]

  it('инструкция пользователя главная, оценки по желанию, задачи участников видны', () => {
    const [sys, user] = buildJudgeMessages('вопрос', replies, { instructions: 'Реши голосованием большинства', ranking: false })
    expect(sys.content).toContain('<инструкция пользователя>\nРеши голосованием большинства\n</инструкция пользователя>')
    expect(sys.content).toContain('Только вывод по инструкции, без оценок')
    expect(sys.content).not.toContain('"ranking"')
    expect(sys.content).toContain('Не утверждай результатов запусков')
    expect(user.content).toContain('## Ответ 1 — A\nЗадача участника: Выбери БД для магазина\nPostgreSQL')
    const withScores = buildJudgeMessages('вопрос', replies, { instructions: 'Общий вывод' })[0].content!
    expect(withScores).toContain('"ranking"')
    expect(withScores).toContain('«## Вывод»')
  })

  it('без оценок весь ответ — вывод, даже если в нём есть фигурные скобки', () => {
    const text = '## Вывод\nБольшинство за PostgreSQL. Пример конфига: {"answer": 2, "best": 1}'
    expect(parseJudge(text, ['model:a', 'model:b'], false)).toEqual({ ranking: [], bestKey: undefined, synthesis: 'Большинство за PostgreSQL. Пример конфига: {"answer": 2, "best": 1}' })
    const scored = parseJudge('```json\n{"ranking":[{"answer":2,"score":8}],"best":2}\n```\n## Вывод\nИтог', ['model:a', 'model:b'])
    expect(scored).toMatchObject({ bestKey: 'model:b', synthesis: 'Итог' })
  })

  it('стандартному судье нужно два ответа на один вопрос, судье с инструкцией — хотя бы один', () => {
    const done = (keys: string[], tasks?: Record<string, string>) => ({ id: 't', user: 'q', tasks, createdAt: 0, replies: Object.fromEntries(keys.map((k) => [k, { status: 'done' as const, text: 'x', startedAt: 0 }])) })
    const custom = { enabled: true, model: '', instructions: 'Сделай вывод', ranking: false }
    expect(canJudge(done(['a']), undefined)).toBe(false)
    expect(canJudge(done(['a', 'b']), undefined)).toBe(true)
    expect(canJudge(done(['a', 'b'], { a: '1', b: '2' }), undefined)).toBe(false)
    expect(canJudge(done(['a']), custom)).toBe(true)
    expect(canJudge(done(['a', 'b'], { a: '1', b: '2' }), custom)).toBe(true)
    expect(canJudge(done([]), custom)).toBe(false)
  })
})
