'use client'

import { judgeDebate, runDebate, type DebateConfig } from '../engine/debate'
import { useDebates, type DebateSession } from '../stores/debates'
import { uid } from '../utils'
import { callLLM } from './llm'

// Запуск дебатов: сообщения и вердикт пишутся в хранилище,
// пауза между раундами ждёт решения пользователя.

const controllers = new Map<string, AbortController>()
const waiters = new Map<string, (v: string | null | 'stop') => void>()

export function isDebateRunning(id: string) {
  return controllers.has(id)
}

export function resumeDebate(id: string, userMessage: string | null) {
  waiters.get(id)?.(userMessage)
}

export function finishDebateEarly(id: string) {
  waiters.get(id)?.('stop')
}

export function stopDebate(id: string) {
  controllers.get(id)?.abort()
  waiters.get(id)?.('stop')
}

export function createDebate(config: DebateConfig): DebateSession {
  const s: DebateSession = { id: uid('deb'), config, messages: [], status: 'idle', round: 0, createdAt: Date.now() }
  useDebates.getState().upsert(s)
  return s
}

async function judge(id: string, signal: AbortSignal) {
  const store = useDebates.getState()
  const s = store.sessions.find((x) => x.id === id)
  if (!s?.config.judge.enabled) return
  store.patch(id, { status: 'judging' })
  await judgeDebate(s.config, s.messages, callLLM, { onVerdict: (v, raw) => useDebates.getState().patch(id, { verdict: v, verdictRaw: raw }) }, signal)
}

export async function startDebate(id: string) {
  const store = useDebates.getState()
  const session = store.sessions.find((s) => s.id === id)
  if (!session || controllers.has(id)) return
  const ac = new AbortController()
  controllers.set(id, ac)
  const fromRound = session.messages.length ? session.round + 1 : 1
  store.patch(id, { status: 'running', error: undefined })
  let finishedEarly = false
  try {
    const result = await runDebate(
      { ...session.config, judge: { ...session.config.judge, enabled: false } },
      session.messages,
      fromRound,
      callLLM,
      {
        onMessage: (m) => useDebates.getState().addMessage(id, m),
        onUpdate: (msgId, patch) => useDebates.getState().patchMessage(id, msgId, patch),
        onRound: (round) => useDebates.getState().patch(id, { round }),
        betweenRounds: session.config.pauseBetweenRounds
          ? async () => {
              useDebates.getState().patch(id, { status: 'paused' })
              const reply = await new Promise<string | null | 'stop'>((resolve) => waiters.set(id, resolve))
              waiters.delete(id)
              if (reply === 'stop') finishedEarly = !ac.signal.aborted
              else useDebates.getState().patch(id, { status: 'running' })
              return reply
            }
          : undefined,
        onVerdict: () => {},
      },
      ac.signal,
    )
    if (ac.signal.aborted) {
      useDebates.getState().patch(id, { status: 'stopped' })
      return
    }
    if (result === 'finished' || finishedEarly) await judge(id, ac.signal)
    useDebates.getState().patch(id, { status: ac.signal.aborted ? 'stopped' : 'done' })
  } catch (e) {
    useDebates.getState().patch(id, { status: ac.signal.aborted ? 'stopped' : 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    controllers.delete(id)
    waiters.delete(id)
  }
}

export async function rejudge(id: string) {
  if (controllers.has(id)) return
  const ac = new AbortController()
  controllers.set(id, ac)
  try {
    const s = useDebates.getState().sessions.find((x) => x.id === id)
    if (!s) return
    useDebates.getState().patch(id, { status: 'judging', config: { ...s.config, judge: { ...s.config.judge, enabled: true } } })
    await judge(id, ac.signal)
    useDebates.getState().patch(id, { status: 'done' })
  } finally {
    controllers.delete(id)
  }
}
