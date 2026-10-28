'use client'

import { Crown, Gavel, MoreHorizontal, PanelLeft, Play, Plus, RotateCcw, Send, Square, Swords, Trash2, Trophy, UserRound, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, Textarea } from '@/components/ui/field'
import { Badge, Segmented, Spinner } from '@/components/ui/misc'
import { Confirm, Menu, MenuContent, MenuItem, MenuTrigger, Sheet, Slider, Switch } from '@/components/ui/overlay'
import { UsageLine } from '@/components/usage-line'
import { createDebate, finishDebateEarly, rejudge, resumeDebate, startDebate, stopDebate } from '@/lib/client/debate-runner'
import { participantColor } from '@/lib/colors'
import { DEBATE_MODES, speakerOrder, type DebateConfig, type DebateMode, type DebateParticipant } from '@/lib/engine/debate'
import { addUsage, ZERO_USAGE } from '@/lib/models'
import { useDebates, type DebateSession } from '@/lib/stores/debates'
import { cn, formatRelative, plural, uid } from '@/lib/utils'

const PERSONAS: { name: string; persona: string }[] = [
  { name: 'Оптимист', persona: 'Видишь возможности и аргументируешь «за». Опираешься на успешные примеры.' },
  { name: 'Скептик', persona: 'Сомневаешься и ищешь риски, требуешь доказательств, приводишь неудачные примеры.' },
  { name: 'Прагматик', persona: 'Думаешь о цене, сроках и реализуемости. Предлагаешь компромиссы.' },
  { name: 'Учёный', persona: 'Опираешься на данные и исследования, разделяешь корреляцию и причинность.' },
  { name: 'Предприниматель', persona: 'Смотришь через призму рынка, клиентов и денег.' },
  { name: 'Этик', persona: 'Оцениваешь последствия для людей, справедливость и долгосрочные эффекты.' },
  { name: 'Инженер', persona: 'Разбираешь техническую сторону: архитектура, ограничения, надёжность.' },
  { name: 'Историк', persona: 'Ищешь исторические параллели и уроки прошлого.' },
]

const MODELS_CYCLE = ['@smart', '@default', '@fast']

function defaultConfig(): DebateConfig {
  return {
    topic: '',
    mode: 'debate',
    rounds: 3,
    participants: PERSONAS.slice(0, 2).map((p, i) => ({ id: uid('p'), name: p.name, persona: p.persona, model: MODELS_CYCLE[i], color: participantColor(i) })),
    judge: { enabled: true, model: '@smart' },
    memory: 'full',
    maxWords: 180,
    temperature: 0.8,
    pauseBetweenRounds: false,
  }
}

const TOPICS = ['Стоит ли стартапу переходить на микросервисы с первого дня?', 'Заменит ли ИИ программистов в ближайшие 10 лет?', 'Удалёнка или офис: что лучше для продуктовой команды?', 'Нужно ли регулировать открытые ИИ-модели?']

function Setup({ initial, onStart }: { initial?: DebateConfig; onStart: (c: DebateConfig) => void }) {
  const [c, setC] = useState<DebateConfig>(() => (initial ? structuredClone({ ...initial, participants: initial.participants.map((p) => ({ ...p, id: uid('p') })) }) : defaultConfig()))
  const set = (patch: Partial<DebateConfig>) => setC((x) => ({ ...x, ...patch }))
  const setP = (i: number, patch: Partial<DebateParticipant>) => set({ participants: c.participants.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const calls = Array.from({ length: c.rounds }, (_, i) => speakerOrder(c, i + 1).length).reduce((a, b) => a + b, 0) + (c.judge.enabled ? 1 : 0)
  const valid = c.topic.trim() && c.participants.length >= (c.mode === 'critique' ? 2 : 2) && c.participants.every((p) => p.name.trim() && p.model)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Новые дебаты</h2>
        <p className="mt-1 text-sm text-muted">Модели обсуждают тему по очереди, видят аргументы друг друга, а судья в конце подводит итог и ставит оценки.</p>
      </div>
      <FieldRow label="Тема или вопрос">
        <Textarea rows={3} value={c.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="О чём спорим?" autoFocus />
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((t) => (
            <button key={t} onClick={() => set({ topic: t })} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-fg">
              {t}
            </button>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Формат">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(Object.entries(DEBATE_MODES) as [DebateMode, (typeof DEBATE_MODES)[DebateMode]][]).map(([id, m]) => (
            <button key={id} onClick={() => set({ mode: id })} className={cn('rounded-xl border p-3 text-left transition-colors', c.mode === id ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong')}>
              <div className="text-lg">{m.emoji}</div>
              <div className="mt-1 text-[13px] font-semibold">{m.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted">{m.hint}</div>
            </button>
          ))}
        </div>
      </FieldRow>

      <FieldRow label={`Участники · ${c.participants.length}`} hint={c.mode === 'critique' ? 'Первый участник — автор, остальные — критики' : undefined}>
        <div className="space-y-2">
          {c.participants.map((p, i) => (
            <div key={p.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: participantColor(i) }}>
                  {p.name.charAt(0) || '?'}
                </span>
                <Input value={p.name} onChange={(e) => setP(i, { name: e.target.value })} className="h-8 w-36 flex-none" placeholder="Имя" />
                <div className="min-w-48 flex-1">
                  <ModelPicker size="sm" value={p.model} onChange={(model) => setP(i, { model })} />
                </div>
                {c.mode === 'critique' && <Badge tone={i === 0 ? 'accent' : 'neutral'}>{i === 0 ? 'автор' : 'критик'}</Badge>}
                <Button size="icon-sm" variant="ghost" disabled={c.participants.length <= 2} onClick={() => set({ participants: c.participants.filter((_, j) => j !== i) })} aria-label="Убрать участника">
                  <X />
                </Button>
              </div>
              <Input value={p.persona} onChange={(e) => setP(i, { persona: e.target.value })} className="mt-2 h-8 text-[13px]" placeholder="Роль, позиция или характер участника" />
            </div>
          ))}
          {c.participants.length < 6 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">Добавить:</span>
              {PERSONAS.filter((p) => !c.participants.some((x) => x.name === p.name)).map((p) => (
                <button
                  key={p.name}
                  onClick={() => set({ participants: [...c.participants, { id: uid('p'), name: p.name, persona: p.persona, model: MODELS_CYCLE[c.participants.length % 3], color: participantColor(c.participants.length) }] })}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                >
                  <Plus className="size-3" /> {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </FieldRow>

      <div className="grid gap-5 rounded-2xl border border-border bg-surface/50 p-4 md:grid-cols-2">
        <FieldRow label={`Раундов · ${c.rounds}`}>
          <Slider min={1} max={6} step={1} value={[c.rounds]} onValueChange={([v]) => set({ rounds: v })} />
        </FieldRow>
        <FieldRow label={`Длина реплики · до ${c.maxWords} слов`}>
          <Slider min={60} max={500} step={20} value={[c.maxWords]} onValueChange={([v]) => set({ maxWords: v })} />
        </FieldRow>
        <FieldRow label="Что видят участники">
          <Segmented
            value={c.memory}
            onChange={(memory) => set({ memory })}
            options={[
              { value: 'full', label: 'Всю историю' },
              { value: 'recent', label: 'Последний раунд' },
            ]}
          />
        </FieldRow>
        <FieldRow label={`Креативность · ${c.temperature.toFixed(1)}`}>
          <Slider min={0} max={1.5} step={0.1} value={[c.temperature]} onValueChange={([v]) => set({ temperature: v })} />
        </FieldRow>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            Пауза после каждого раунда
            <span className="block text-xs text-muted">Можно вмешаться с вопросом или репликой</span>
          </span>
          <Switch checked={c.pauseBetweenRounds} onCheckedChange={(v) => set({ pauseBetweenRounds: v })} />
        </label>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1.5">
              <Gavel className="size-4 text-gold" /> Судья в конце
            </span>
            <Switch checked={c.judge.enabled} onCheckedChange={(v) => set({ judge: { ...c.judge, enabled: v } })} />
          </label>
          {c.judge.enabled && <ModelPicker size="sm" value={c.judge.model} onChange={(model) => set({ judge: { ...c.judge, model } })} />}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted">
          {calls} {plural(calls, ['вызов', 'вызова', 'вызовов'])} моделей
        </span>
        <Button variant="primary" size="lg" disabled={!valid} onClick={() => onStart(c)}>
          <Play className="fill-current" /> Начать дебаты
        </Button>
      </div>
    </div>
  )
}

function Verdict({ s }: { s: DebateSession }) {
  const v = s.verdict
  const byId = new Map(s.config.participants.map((p, i) => [p.id, { p, color: participantColor(i) }]))
  if (s.status === 'judging')
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-4 text-sm">
        <Spinner className="text-gold" /> Судья изучает стенограмму…
      </div>
    )
  if (!v) {
    if (!s.verdictRaw) return null
    return (
      <div className="rounded-2xl border border-gold/30 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Gavel className="size-4 text-gold" /> Ответ судьи (не удалось разобрать)
        </div>
        <Markdown text={s.verdictRaw} />
      </div>
    )
  }
  const winner = v.winnerId ? byId.get(v.winnerId) : undefined
  return (
    <div className="overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-b from-gold/[0.07] to-transparent">
      <div className="flex flex-wrap items-center gap-3 border-b border-gold/20 px-5 py-4">
        <Trophy className="size-6 text-gold" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gold">Вердикт судьи</div>
          {winner && <div className="text-lg font-semibold">Лучшие аргументы — {winner.p.name}</div>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => rejudge(s.id)}>
          <RotateCcw /> Пересудить
        </Button>
      </div>
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3">
          {v.scores
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((sc) => {
              const info = byId.get(sc.participantId)
              return (
                <div key={sc.participantId}>
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="size-2.5 rounded-full" style={{ background: info?.color }} />
                    <span className="font-medium">{info?.p.name ?? sc.participantId}</span>
                    {sc.participantId === v.winnerId && <Crown className="size-3.5 text-gold" />}
                    <span className="ml-auto font-mono font-semibold tabular-nums">{sc.score}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full" style={{ width: `${sc.score * 10}%`, background: info?.color }} />
                  </div>
                  {sc.comment && <div className="mt-1 text-xs text-muted">{sc.comment}</div>}
                </div>
              )
            })}
        </div>
        <div className="space-y-4 text-[14px] leading-relaxed">
          {v.summary && <p>{v.summary}</p>}
          {v.consensus && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-success">Согласие</div>
              <p className="text-muted">{v.consensus}</p>
            </div>
          )}
          {v.disagreements.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-danger">Разногласия</div>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {v.disagreements.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {v.recommendation && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Вывод</div>
              {v.recommendation}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Session({ s, onRepeat }: { s: DebateSession; onRepeat: () => void }) {
  const [reply, setReply] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(s.config.participants.map((p, i) => [p.id, { p, color: participantColor(i) }])), [s.config.participants])
  const totalUsage = useMemo(() => s.messages.reduce((u, m) => (m.usage ? addUsage(u, m.usage) : u), { ...ZERO_USAGE }), [s.messages])
  const rounds = useMemo(() => {
    const out = new Map<number, typeof s.messages>()
    for (const m of s.messages) out.set(m.round, [...(out.get(m.round) ?? []), m])
    return Array.from(out.entries())
  }, [s.messages])
  const active = s.status === 'running' || s.status === 'judging' || s.status === 'paused'
  const len = s.messages.reduce((a, m) => a + m.content.length, 0)

  useEffect(() => {
    const el = scroller.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight
  }, [len, s.status])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <Badge tone="accent">
          {DEBATE_MODES[s.config.mode].emoji} {DEBATE_MODES[s.config.mode].title}
        </Badge>
        <span className="text-xs text-muted">
          раунд {Math.max(1, s.round)} из {s.config.rounds}
        </span>
        <div className="flex -space-x-1.5">
          {s.config.participants.map((p, i) => (
            <span key={p.id} title={p.name} className="flex size-6 items-center justify-center rounded-full border-2 border-bg text-[10px] font-bold text-white" style={{ background: participantColor(i) }}>
              {p.name.charAt(0)}
            </span>
          ))}
        </div>
        <UsageLine usage={totalUsage} className="hidden sm:flex" />
        <div className="ml-auto flex gap-2">
          {active ? (
            <Button size="sm" variant="danger" onClick={() => stopDebate(s.id)}>
              <Square className="fill-current" /> Стоп
            </Button>
          ) : (
            <>
              {(s.status === 'stopped' || s.status === 'error') && s.round < s.config.rounds && (
                <Button size="sm" onClick={() => startDebate(s.id)}>
                  <Play /> Продолжить
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onRepeat}>
                <RotateCcw /> Повторить
              </Button>
            </>
          )}
        </div>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
          <div className="rounded-2xl border border-border bg-surface px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Тема</div>
            <div className="mt-1 text-[16px] font-medium leading-snug">{s.config.topic}</div>
          </div>
          {rounds.map(([round, msgs]) => (
            <div key={round} className="space-y-4">
              <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                <span className="h-px flex-1 bg-border" /> Раунд {round} <span className="h-px flex-1 bg-border" />
              </div>
              {msgs.map((m) => {
                if (m.speaker === 'user')
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-[14px]">
                        <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted">
                          <UserRound className="size-3" /> Вы
                        </div>
                        {m.content}
                      </div>
                    </div>
                  )
                const info = byId.get(m.speaker)
                return (
                  <div key={m.id} className="flex gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: info?.color }}>
                      {info?.p.name.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[13px] font-semibold" style={{ color: info?.color }}>
                          {info?.p.name}
                        </span>
                        {info && <span className="truncate text-[11px] text-faint">{info.p.persona.slice(0, 60)}</span>}
                      </div>
                      <div className="mt-1 rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3">
                        {m.content ? <Markdown text={m.content} streaming={m.status === 'streaming'} className="text-[14px]" /> : m.status === 'streaming' ? <Spinner className="text-accent" /> : null}
                        {m.status === 'error' && <div className="mt-1 text-[13px] text-danger">{m.error}</div>}
                      </div>
                      {m.status === 'done' && <UsageLine usage={m.usage} latencyMs={m.endedAt ? m.endedAt - m.startedAt : undefined} className="mt-1 pl-1" />}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          {s.status === 'paused' && (
            <div className="rounded-2xl border border-accent/40 bg-accent-soft p-4">
              <div className="text-[13px] font-semibold">Раунд {s.round} завершён</div>
              <p className="mt-0.5 text-xs text-muted">Задайте участникам вопрос, подбросьте новый факт — или продолжайте без вмешательства.</p>
              <div className="mt-3 flex gap-2">
                <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ваша реплика (необязательно)" onKeyDown={(e) => e.key === 'Enter' && (resumeDebate(s.id, reply), setReply(''))} />
                <Button
                  variant="primary"
                  onClick={() => {
                    resumeDebate(s.id, reply)
                    setReply('')
                  }}
                >
                  {reply.trim() ? <Send /> : <Play />} {reply.trim() ? 'Отправить' : 'Дальше'}
                </Button>
              </div>
              <button onClick={() => finishDebateEarly(s.id)} className="mt-2 text-xs text-muted hover:text-fg">
                Завершить и перейти к вердикту →
              </button>
            </div>
          )}
          {s.error && <div className="rounded-xl border border-danger/30 bg-danger/8 p-3 text-sm text-danger">{s.error}</div>}
          <Verdict s={s} />
        </div>
      </div>
    </div>
  )
}

export function DebatesView() {
  const sessions = useDebates((s) => s.sessions)
  const remove = useDebates((s) => s.remove)
  const params = useSearchParams()
  const router = useRouter()
  const id = params.get('d')
  const current = sessions.find((s) => s.id === id)
  const [setupFrom, setSetupFrom] = useState<DebateConfig | undefined>()
  const [listOpen, setListOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const start = (c: DebateConfig) => {
    const s = createDebate(c)
    router.push(`/debates?d=${s.id}`)
    void startDebate(s.id)
  }

  const list = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => {
            setSetupFrom(undefined)
            router.push('/debates')
            setListOpen(false)
          }}
        >
          <Swords /> Новые дебаты
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-muted">Здесь будет история дебатов</div>}
        {sessions.map((s) => (
          <div key={s.id} className={cn('group flex items-center rounded-lg', s.id === id ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
            <button
              onClick={() => {
                router.push(`/debates?d=${s.id}`)
                setListOpen(false)
              }}
              className="min-w-0 flex-1 px-2.5 py-2 text-left"
            >
              <div className="flex items-center gap-1.5">
                {(s.status === 'running' || s.status === 'judging') && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
                <span className="truncate text-[13px]">{s.config.topic}</span>
              </div>
              <div className="text-[11px] text-faint">
                {DEBATE_MODES[s.config.mode].emoji} {s.config.participants.length} участ. · {formatRelative(s.createdAt)}
              </div>
            </button>
            <Menu>
              <MenuTrigger asChild>
                <button className="mr-1 rounded-md p-1 text-faint opacity-0 hover:bg-surface-3 group-hover:opacity-100" aria-label="Действия">
                  <MoreHorizontal className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem danger onSelect={() => setDeleting(s.id)}>
                  <Trash2 /> Удалить
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface/40 lg:block">{list}</aside>
      <Sheet open={listOpen} onOpenChange={setListOpen} title="Дебаты">
        {list}
      </Sheet>
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center border-b border-border px-3 py-1.5 lg:hidden">
          <button onClick={() => setListOpen(true)} className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
            <PanelLeft className="size-4" /> История дебатов
          </button>
        </div>
        {current ? (
          <Session
            key={current.id}
            s={current}
            onRepeat={() => {
              setSetupFrom(current.config)
              router.push('/debates')
            }}
          />
        ) : (
          <div className="forge-glow min-h-0 flex-1 overflow-y-auto">
            <Setup key={setupFrom ? 'repeat' : 'new'} initial={setupFrom} onStart={start} />
          </div>
        )}
      </section>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Удалить дебаты?"
        onConfirm={() => {
          if (deleting) {
            stopDebate(deleting)
            remove(deleting)
            if (deleting === id) router.push('/debates')
          }
        }}
      />
    </div>
  )
}
