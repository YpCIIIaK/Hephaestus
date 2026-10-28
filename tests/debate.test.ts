import { describe, expect, it } from 'vitest'
import { buildParticipantMessages, parseVerdict, runDebate, speakerOrder, type DebateConfig, type DebateMessage } from '@/lib/engine/debate'
import { fakeLLM, lastUser, system } from './helpers'

const cfg = (over: Partial<DebateConfig> = {}): DebateConfig => ({
  topic: 'Нужен ли офис?',
  mode: 'debate',
  rounds: 2,
  participants: [
    { id: 'p1', name: 'Анна', model: 'm1', persona: 'за офис', color: 'a' },
    { id: 'p2', name: 'Борис', model: 'm2', persona: 'за удалёнку', color: 'b' },
  ],
  judge: { enabled: true, model: 'judge' },
  memory: 'full',
  maxWords: 100,
  temperature: 0.7,
  pauseBetweenRounds: false,
  ...over,
})

describe('дебаты', () => {
  it('участники видят реплики друг друга, судья выносит вердикт', async () => {
    const msgs: DebateMessage[] = []
    let verdict: unknown = null
    const { llm, calls } = fakeLLM((req) =>
      req.model === 'judge'
        ? JSON.stringify({ summary: 's', consensus: 'c', disagreements: ['d'], scores: [{ participantId: 'p2', score: 9, comment: 'x' }, { participantId: 'Анна', score: 6, comment: 'y' }], recommendation: 'r' })
        : `реплика ${req.model}`,
    )
    const result = await runDebate(cfg(), [], 1, llm, {
      onMessage: (m) => msgs.push(m),
      onUpdate: (id, patch) => Object.assign(msgs.find((m) => m.id === id)!, patch),
      onRound: () => {},
      onVerdict: (v) => (verdict = v),
    })
    expect(result).toBe('finished')
    expect(msgs.map((m) => m.speaker)).toEqual(['p1', 'p2', 'p1', 'p2'])
    expect(lastUser(calls[1])).toContain('реплика m1')
    expect(lastUser(calls[2])).toContain('Анна (ты)')
    expect(system(calls[0])).toContain('Тебя зовут Анна')
    expect(verdict).toMatchObject({ winnerId: 'p2', scores: [{ participantId: 'p2' }, { participantId: 'p1' }] })
  })

  it('режим «автор и критики»: автор пишет первым и дорабатывает последним', () => {
    const c = cfg({ mode: 'critique', participants: [...cfg().participants, { id: 'p3', name: 'Вера', model: 'm3', persona: '', color: 'c' }] })
    expect(speakerOrder(c, 1).map((p) => p.id)).toEqual(['p1'])
    expect(speakerOrder(c, 2).map((p) => p.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('пользователь может вмешаться между раундами или остановить', async () => {
    const msgs: DebateMessage[] = []
    const { llm, calls } = fakeLLM(() => 'ok')
    await runDebate(cfg({ judge: { enabled: false, model: '' } }), [], 1, llm, {
      onMessage: (m) => msgs.push(m),
      onUpdate: () => {},
      onRound: () => {},
      betweenRounds: async () => 'А что с безопасностью?',
      onVerdict: () => {},
    })
    expect(msgs.find((m) => m.speaker === 'user')?.content).toBe('А что с безопасностью?')
    expect(lastUser(calls[2])).toContain('А что с безопасностью?')

    const stopped = await runDebate(cfg(), [], 1, fakeLLM(() => 'ok').llm, {
      onMessage: () => {},
      onUpdate: () => {},
      onRound: () => {},
      betweenRounds: async () => 'stop',
      onVerdict: () => {},
    })
    expect(stopped).toBe('stopped')
  })

  it('память «последний раунд» скрывает старые реплики соперников', () => {
    const t: DebateMessage[] = [
      { id: '1', round: 1, speaker: 'p2', content: 'старое', status: 'done', startedAt: 0 },
      { id: '2', round: 2, speaker: 'p2', content: 'свежее', status: 'done', startedAt: 0 },
    ]
    const user = buildParticipantMessages(cfg({ memory: 'recent', rounds: 3 }), cfg().participants[0], t, 3)[1].content!
    expect(user).toContain('свежее')
    expect(user).not.toContain('старое')
  })

  it('parseVerdict терпит мусор вокруг JSON', () => {
    expect(parseVerdict('Вот: ```json\n{"summary":"x","scores":[]}\n```', cfg())?.summary).toBe('x')
    expect(parseVerdict('нет json', cfg())).toBeNull()
  })
})
