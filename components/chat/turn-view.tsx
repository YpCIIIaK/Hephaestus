'use client'

import { AlertTriangle, Brain, Check, ChevronDown, Maximize2, Minimize2, Crown, FileText, GitCompareArrows, Gavel, Pencil, RotateCcw, Square, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { memo, useState } from 'react'
import { CopyButton, Markdown } from '@/components/markdown'
import { ToolTraceList } from '@/components/tool-chips'
import { Button } from '@/components/ui/button'
import { Badge, Spinner } from '@/components/ui/misc'
import { Tip } from '@/components/ui/overlay'
import { UsageLine } from '@/components/usage-line'
import { toast } from 'sonner'
import { applySandboxChanges, canJudge, describeTarget, discardSandbox, judgeTurn, regenerate, sandboxPatch } from '@/lib/client/chat-runner'
import { participantColor } from '@/lib/colors'
import { targetKey, type ChatJudge, type ChatReply, type ChatTarget, type ChatTurn, type JudgeResult, type ReplySandbox } from '@/lib/engine/chat'
import { useChats } from '@/lib/stores/chats'
import { useSettings } from '@/lib/stores/settings'
import { cn } from '@/lib/utils'

function DiffView({ patch }: { patch: string }) {
  return (
    <pre className="max-h-[480px] overflow-auto border-t border-border bg-surface-2/40 px-3 py-2 font-mono text-[11.5px] leading-relaxed">
      {patch.split('\n').map((l, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre',
            l.startsWith('+++') || l.startsWith('---') ? 'font-semibold text-fg' : l.startsWith('+') ? 'bg-success/10 text-success' : l.startsWith('-') ? 'bg-danger/10 text-danger' : l.startsWith('@@') ? 'text-accent' : 'text-muted',
          )}
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

/** Изменения участника в его копии проекта: diff, «Применить», «Удалить копию» */
function SandboxPanel({ sandbox, convId, turnId, replyKey, streaming }: { sandbox: ReplySandbox; convId: string; turnId: string; replyKey: string; streaming: boolean }) {
  const [patch, setPatch] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const adds = sandbox.files.reduce((n, f) => n + f.additions, 0)
  const dels = sandbox.files.reduce((n, f) => n + f.deletions, 0)
  const pending = sandbox.files.filter((f) => !sandbox.applied?.includes(f.path))
  const toggle = async () => {
    if (patch != null) return setPatch(null)
    try {
      const d = await sandboxPatch(sandbox.id)
      setPatch(d.patch + (d.truncated ? '\n…[diff слишком большой и обрезан]' : ''))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }
  const apply = async () => {
    setBusy(true)
    try {
      const r = await applySandboxChanges(convId, turnId, replyKey)
      if (r.conflicts.length) toast.warning(`Применено ${r.applied.length}, пропущено ${r.conflicts.length}: эти файлы в проекте изменились после создания копии`)
      else toast.success(`Изменения перенесены в проект: ${r.applied.length} файл(ов)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (sandbox.removed) return <div className="text-xs text-faint">Копия проекта удалена</div>
  if (streaming) return <div className="flex items-center gap-2 text-xs text-muted"><GitCompareArrows className="size-3.5" /> Работает в своей копии проекта</div>
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs">
        <GitCompareArrows className="size-3.5 text-accent" />
        {sandbox.error ? (
          <span className="text-danger">{sandbox.error}</span>
        ) : sandbox.files.length ? (
          <span>
            Изменения в копии: <b>{sandbox.files.length}</b> файл(ов) <span className="text-success">+{adds}</span> <span className="text-danger">−{dels}</span>
          </span>
        ) : (
          <span className="text-muted">В копии нет изменений</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {!!sandbox.files.length && (
            <Button size="sm" variant="ghost" onClick={toggle}>
              {patch != null ? 'Скрыть diff' : 'Показать diff'}
            </Button>
          )}
          {!!pending.length && (
            <Button size="sm" variant="primary" disabled={busy} onClick={apply}>
              {busy ? <Spinner /> : <Check />} Применить к проекту
            </Button>
          )}
          <Tip content="Удалить копию — следующий ход начнёт новую копию с текущего проекта">
            <Button size="icon-sm" variant="ghost" onClick={() => discardSandbox(convId, turnId, replyKey)} aria-label="Удалить копию">
              <Trash2 />
            </Button>
          </Tip>
        </span>
      </div>
      {!!sandbox.files.length && (
        <div className="border-t border-border px-3 py-1.5 font-mono text-[11px] text-muted">
          {sandbox.files.map((f) => (
            <div key={f.path} className="flex gap-2">
              <span className={cn('w-3', f.status === 'added' ? 'text-success' : f.status === 'deleted' ? 'text-danger' : 'text-gold')}>{f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}</span>
              <span className="min-w-0 flex-1 truncate">{f.path}</span>
              {sandbox.applied?.includes(f.path) ? <span className="text-success">применено</span> : sandbox.conflicts?.includes(f.path) ? <span className="text-danger">конфликт</span> : <span>+{f.additions} −{f.deletions}</span>}
            </div>
          ))}
        </div>
      )}
      {patch != null && <DiffView patch={patch} />}
    </div>
  )
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border bg-surface-2/60">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted hover:text-fg">
        <Brain className="size-3.5" />
        {streaming ? 'Размышляет…' : 'Ход рассуждений'}
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-xs leading-relaxed text-muted">{text}</div>}
    </div>
  )
}

const ReplyCard = memo(function ReplyCard({
  convId,
  turnId,
  target,
  reply,
  color,
  best,
  card,
  task,
  focused,
  onFocus,
}: {
  convId: string
  turnId: string
  target: ChatTarget
  reply: ChatReply
  color: string
  best: boolean
  card: boolean
  /** Отдельная задача участника (режим «разные задачи») */
  task?: string
  focused?: boolean
  /** Развернуть ответ участника на всю ширину или вернуть все */
  onFocus?: () => void
}) {
  const info = describeTarget(target)
  const showReasoning = useSettings((s) => s.chat.showReasoning)
  const patchReply = useChats((s) => s.patchReply)
  const key = targetKey(target)
  const streaming = reply.status === 'streaming'
  return (
    <div className={cn('group/reply flex min-w-0 flex-col', card && 'rounded-2xl border border-border bg-surface shadow-soft', best && card && 'ring-2 ring-gold/50')}>
      {card && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          {info.emoji && <span>{info.emoji}</span>}
          <span className="truncate text-[13px] font-semibold" title={info.subtitle}>
            {info.name}
          </span>
          {best && (
            <Badge tone="warning" className="ml-1">
              <Crown /> лучший
            </Badge>
          )}
          <span className="ml-auto">{streaming && <Spinner className="size-3.5 text-accent" />}</span>
          {onFocus && (
            <Tip content={focused ? 'Показать всех участников' : 'Развернуть — только этот участник'}>
              <button onClick={onFocus} className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" aria-label={focused ? 'Показать всех' : 'Развернуть'}>
                {focused ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </Tip>
          )}
        </div>
      )}
      <div className={cn('flex flex-col gap-3', card ? 'px-4 py-3' : 'py-1')}>
        {!card && (
          <div className="flex items-center gap-2 text-[13px]">
            <span className="size-2 rounded-full" style={{ background: color }} />
            {info.emoji && <span>{info.emoji}</span>}
            <span className="font-semibold">{info.name}</span>
            {streaming && <Spinner className="size-3.5 text-accent" />}
          </div>
        )}
        {reply.progress && streaming && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${(reply.progress.done / Math.max(1, reply.progress.total)) * 100}%` }} />
            </div>
            {reply.progress.done}/{reply.progress.total}
            {reply.progress.current && <span className="truncate">· {reply.progress.current}</span>}
          </div>
        )}
        {task && card && <div className="line-clamp-3 rounded-lg bg-surface-2/70 px-2.5 py-1.5 text-xs text-muted" title={task}><b className="text-fg">Задача:</b> {task}</div>}
        {showReasoning && reply.reasoning && <Reasoning text={reply.reasoning} streaming={streaming && !reply.text} />}
        {!!reply.received?.length && <details className="rounded-lg border border-border p-2 text-xs"><summary className="cursor-pointer font-medium">Видел ответы других участников · {reply.received.length}</summary><div className="mt-2 space-y-2">{reply.received.map((item, i) => <div key={i}><b>{item.name}</b><div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-muted">{item.text}</div></div>)}</div></details>}
        {!!reply.tools?.length && <ToolTraceList tools={reply.tools} />}
        {!!reply.notices?.length && <details className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning">
          <summary className="cursor-pointer">События провайдера · {reply.notices.length}</summary>
          <div className="mt-2 space-y-1">{reply.notices.map((n, i) => <div key={i}>{n}</div>)}</div>
        </details>}
        {reply.text ? (
          <Markdown text={reply.text} streaming={streaming} />
        ) : streaming ? (
          <div className="flex items-center gap-2 py-1 text-sm text-faint">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            {reply.tools?.length ? 'Работает с инструментами' : 'Думает'}
          </div>
        ) : null}
        {reply.status === 'error' && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-[13px] text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{reply.error}</span>
          </div>
        )}
        {reply.sandbox && <SandboxPanel sandbox={reply.sandbox} convId={convId} turnId={turnId} replyKey={key} streaming={streaming} />}
        {reply.status === 'stopped' && <div className="text-xs text-faint">Остановлено</div>}
      </div>
      {!streaming && (
        <div className={cn('flex flex-wrap items-center gap-x-1 gap-y-1', card ? 'mt-auto border-t border-border px-2.5 py-1.5' : 'pb-1')}>
          {reply.text && <CopyButton text={reply.text} />}
          <Tip content="Сгенерировать заново">
            <button onClick={() => regenerate(convId, turnId, key)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Повторить">
              <RotateCcw className="size-3.5" />
            </button>
          </Tip>
          <button onClick={() => patchReply(convId, turnId, key, { rating: reply.rating === 1 ? undefined : 1 })} className={cn('rounded-md p-1.5 hover:bg-surface-2', reply.rating === 1 ? 'text-success' : 'text-muted hover:text-fg')} aria-label="Хороший ответ">
            <ThumbsUp className="size-3.5" />
          </button>
          <button onClick={() => patchReply(convId, turnId, key, { rating: reply.rating === -1 ? undefined : -1 })} className={cn('rounded-md p-1.5 hover:bg-surface-2', reply.rating === -1 ? 'text-danger' : 'text-muted hover:text-fg')} aria-label="Плохой ответ">
            <ThumbsDown className="size-3.5" />
          </button>
          {reply.model && <span className="max-w-48 truncate text-[10px] text-faint" title={reply.model}>Ответила: {reply.model}</span>}
          <UsageLine usage={reply.usage} latencyMs={reply.latencyMs} className="ml-auto pr-1.5" />
        </div>
      )}
    </div>
  )
})

function JudgeCard({ judge, targets, convId, turnId }: { judge: JudgeResult; targets: ChatTarget[]; convId: string; turnId: string }) {
  const nameOf = (key: string) => {
    const t = targets.find((x) => targetKey(x) === key)
    return t ? describeTarget(t).name : key
  }
  const colorOf = (key: string) => participantColor(Math.max(0, targets.findIndex((x) => targetKey(x) === key)))
  return (
    <div className="overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-b from-gold/[0.06] to-transparent">
      <div className="flex items-center gap-2 border-b border-gold/20 px-4 py-2.5">
        <Gavel className="size-4 text-gold" />
        <span className="text-[13px] font-semibold">{judge.custom ? 'Вывод судьи' : 'Вердикт судьи'}</span>
        {judge.custom && <Badge className="ml-1">по вашей инструкции</Badge>}
        {judge.status === 'streaming' && <Spinner className="size-3.5 text-gold" />}
        <span className="ml-auto flex items-center gap-1">
          {judge.status !== 'streaming' && (
            <Tip content="Пересудить">
              <button onClick={() => judgeTurn(convId, turnId)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Пересудить">
                <RotateCcw className="size-3.5" />
              </button>
            </Tip>
          )}
          {judge.synthesis && <CopyButton text={judge.synthesis} />}
        </span>
      </div>
      <div className="space-y-4 px-4 py-3">
        {judge.error && <div className="text-sm text-danger">{judge.error}</div>}
        {judge.ranking.length > 0 && (
          <div className="space-y-2">
            {judge.ranking.map((r, i) => (
              <div key={r.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5">
                <span className="w-5 text-center font-mono text-xs text-faint">{i + 1}</span>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(r.key) }} />
                  <span className="truncate text-[13px] font-medium">{nameOf(r.key)}</span>
                  {r.key === judge.bestKey && <Crown className="size-3.5 shrink-0 text-gold" />}
                  <div className="ml-2 hidden h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3 sm:block">
                    <div className="h-full rounded-full" style={{ width: `${r.score * 10}%`, background: colorOf(r.key) }} />
                  </div>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums">{r.score.toFixed(1).replace(/\.0$/, '')}</span>
                {(r.strengths || r.weaknesses) && (
                  <div className="col-start-2 col-end-4 text-xs leading-relaxed text-muted">
                    {r.strengths && <span><span className="text-success">+</span> {r.strengths} </span>}
                    {r.weaknesses && <span><span className="text-danger">−</span> {r.weaknesses}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {judge.synthesis && (
          <div className="border-t border-gold/15 pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gold">{judge.custom ? 'Вывод' : 'Итоговый ответ'}</div>
            <Markdown text={judge.synthesis} streaming={judge.status === 'streaming'} />
          </div>
        )}
      </div>
    </div>
  )
}

export function TurnView({
  convId,
  turn,
  targets,
  layout,
  isLast,
  running,
  onEdit,
  focus,
  onFocus,
  judgeConfig,
}: {
  convId: string
  turn: ChatTurn
  targets: ChatTarget[]
  layout: 'columns' | 'stack'
  isLast: boolean
  running: boolean
  onEdit: () => void
  /** Развёрнутый участник: показываются только его ответы */
  focus?: string | null
  onFocus?: (key: string | null) => void
  /** Судья диалога: его инструкция меняет, что делает кнопка вызова */
  judgeConfig?: ChatJudge
}) {
  // Показываем ответы и тех участников, которых позже убрали из диалога
  const keys = Object.keys(turn.replies)
  const allTargets: ChatTarget[] = [...targets.filter((t) => keys.includes(targetKey(t))), ...keys.filter((k) => !targets.some((t) => targetKey(t) === k)).map((k) => ({ kind: k.split(':')[0] as ChatTarget['kind'], id: k.slice(k.indexOf(':') + 1) }))]
  const multi = allTargets.length > 1
  const shown = focus && keys.includes(focus) ? allTargets.filter((t) => targetKey(t) === focus) : allTargets
  const nameOf = (key: string) => describeTarget(allTargets.find((t) => targetKey(t) === key) ?? { kind: 'model', id: key }).name
  const anyStreaming = Object.values(turn.replies).some((r) => r.status === 'streaming')

  return (
    <div className="space-y-4">
      <div className="group/user flex justify-end">
        <div className="max-w-[min(42rem,90%)] space-y-2">
          {turn.attachments && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {turn.attachments.map((a) => (
                <span key={a.name} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-muted">
                  <FileText className="size-3.5" /> {a.name}
                </span>
              ))}
            </div>
          )}
          {turn.tasks ? (
            <div className="space-y-1.5 rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-[14px] leading-relaxed">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Разные задачи · {Object.keys(turn.tasks).length}</div>
              {Object.entries(turn.tasks).map(([k, task]) => (
                <div key={k} className="whitespace-pre-wrap break-words">
                  <b>{nameOf(k)}:</b> {task}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">{turn.user}</div>
          )}
          {isLast && !running && (
            <div className="flex justify-end opacity-0 transition-opacity group-hover/user:opacity-100">
              <button onClick={onEdit} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg">
                <Pencil className="size-3" /> Изменить
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          multi && layout === 'columns' ? 'grid gap-3' : 'flex flex-col gap-3',
          multi && layout === 'columns' && (shown.length === 2 ? 'md:grid-cols-2' : shown.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : shown.length >= 3 ? 'md:grid-cols-2 xl:grid-cols-3' : ''),
        )}
      >
        {shown.map((t) => {
          const key = targetKey(t)
          const reply = turn.replies[key]
          if (!reply) return null
          const idx = targets.findIndex((x) => targetKey(x) === key)
          return (
            <ReplyCard
              key={key}
              convId={convId}
              turnId={turn.id}
              target={t}
              reply={reply}
              color={participantColor(idx === -1 ? 7 : idx)}
              best={turn.judge?.bestKey === key}
              card={multi}
              task={turn.tasks?.[key]}
              focused={focus === key}
              onFocus={multi && onFocus ? () => onFocus(focus === key ? null : key) : undefined}
            />
          )
        })}
      </div>

      {turn.judge ? (
        <JudgeCard judge={turn.judge} targets={allTargets} convId={convId} turnId={turn.id} />
      ) : (
        canJudge(turn, judgeConfig) &&
        (multi || !!judgeConfig?.instructions.trim()) &&
        !anyStreaming && (
          <div className="flex justify-center">
            <Button size="sm" variant="outline" onClick={() => judgeTurn(convId, turn.id)}>
              <Gavel className="text-gold" /> {judgeConfig?.instructions.trim() ? 'Вывод судьи по вашей инструкции' : 'Сравнить ответы и собрать лучший'}
            </Button>
          </div>
        )
      )}
    </div>
  )
}

export function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="icon" onClick={onClick} aria-label="Остановить" className="size-9 rounded-xl">
      <Square className="size-3.5 fill-current" />
    </Button>
  )
}
