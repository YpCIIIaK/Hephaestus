'use client'

import { ArrowUp, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/overlay'
import { describeTarget } from '@/lib/client/chat-runner'
import { participantColor } from '@/lib/colors'
import { targetKey, type ChatTarget } from '@/lib/engine/chat'
import { cn } from '@/lib/utils'
import { StopButton } from './turn-view'

/**
 * Режим «разные задачи»: у каждого участника своё поле. Можно запустить всех
 * сразу или отправить задачу одному участнику.
 */
export function MultiTaskComposer({
  targets,
  running,
  onSend,
  onStop,
}: {
  targets: ChatTarget[]
  running: boolean
  onSend: (tasks: Record<string, string>) => void
  onStop: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const filled = targets.filter((t) => drafts[targetKey(t)]?.trim())

  const send = (keys: string[]) => {
    const tasks = Object.fromEntries(keys.map((k) => [k, drafts[k]?.trim() ?? '']).filter(([, v]) => v))
    if (!Object.keys(tasks).length || running) return
    onSend(tasks)
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !(k in tasks))))
  }

  return (
    <div className="space-y-2">
      <div className={cn('grid gap-2', targets.length === 2 ? 'md:grid-cols-2' : targets.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : targets.length >= 3 ? 'md:grid-cols-3' : '')}>
        {targets.map((t, i) => {
          const key = targetKey(t)
          const info = describeTarget(t)
          return (
            <div key={key} className="flex flex-col rounded-2xl border border-border bg-surface shadow-soft focus-within:border-accent/60">
              <div className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium">
                <span className="size-2 shrink-0 rounded-full" style={{ background: participantColor(i) }} />
                {info.emoji && <span>{info.emoji}</span>}
                <span className="truncate">{info.name}</span>
              </div>
              <textarea
                value={drafts[key] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    send([key])
                  }
                }}
                rows={3}
                placeholder={`Задача для ${info.name}…`}
                aria-label={`Задача для ${info.name}`}
                className="min-h-[72px] w-full resize-y bg-transparent px-3 py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-faint"
              />
              <div className="flex justify-end px-2 pb-2">
                <Tip content="Отправить только этому участнику · Ctrl+Enter">
                  <Button size="icon-sm" variant="ghost" disabled={running || !drafts[key]?.trim()} onClick={() => send([key])} aria-label={`Отправить только ${info.name}`}>
                    <ArrowUp />
                  </Button>
                </Tip>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted">{filled.length ? `Заполнено задач: ${filled.length} из ${targets.length}` : 'Напишите задачу хотя бы одному участнику'}</span>
        {running ? (
          <StopButton onClick={onStop} />
        ) : (
          <Button variant="primary" disabled={!filled.length} onClick={() => send(targets.map(targetKey))}>
            <Play className="fill-current" /> Запустить все{filled.length > 1 ? ` (${filled.length})` : ''}
          </Button>
        )}
      </div>
    </div>
  )
}
