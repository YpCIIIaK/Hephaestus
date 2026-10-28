'use client'

import { MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Confirm, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlay'
import { useChatRuntime } from '@/lib/client/chat-runner'
import { useChats } from '@/lib/stores/chats'
import { cn, formatRelative } from '@/lib/utils'

function groupLabel(t: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const today = d.getTime()
  if (t >= today) return 'Сегодня'
  if (t >= today - 86_400_000) return 'Вчера'
  if (t >= today - 7 * 86_400_000) return 'Эта неделя'
  if (t >= today - 30 * 86_400_000) return 'Этот месяц'
  return 'Раньше'
}

export function ConversationList({ activeId, onSelect, onNew }: { activeId: string | null; onSelect: (id: string) => void; onNew: () => void }) {
  const conversations = useChats((s) => s.conversations)
  const patch = useChats((s) => s.patch)
  const remove = useChats((s) => s.remove)
  const running = useChatRuntime((s) => s.running)
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = conversations
      .filter((c) => !query || c.title.toLowerCase().includes(query) || c.turns.some((t) => t.user.toLowerCase().includes(query)))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
    const out: [string, typeof list][] = []
    for (const c of list) {
      const g = c.pinned ? 'Закреплённые' : groupLabel(c.updatedAt)
      const last = out[out.length - 1]
      if (last && last[0] === g) last[1].push(c)
      else out.push([g, [c]])
    }
    return out
  }, [conversations, q])

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <Button variant="primary" className="w-full" onClick={onNew}>
          <MessageSquarePlus /> Новый чат
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по чатам" className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-[13px] outline-none placeholder:text-faint focus:border-accent/50" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-muted">{q ? 'Ничего не найдено' : 'Здесь появятся ваши диалоги'}</div>}
        {groups.map(([label, list]) => (
          <div key={label} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</div>
            {list.map((c) => (
              <div key={c.id} className={cn('group relative flex items-center rounded-lg', c.id === activeId ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
                {renaming === c.id ? (
                  <input
                    autoFocus
                    defaultValue={c.title}
                    onBlur={(e) => {
                      patch(c.id, { title: e.target.value.trim() || c.title })
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    className="m-1 h-7 w-full rounded-md border border-accent/50 bg-surface px-2 text-[13px] outline-none"
                  />
                ) : (
                  <button onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                    {(running[c.id] ?? 0) > 0 && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
                    <span className={cn('truncate text-[13px]', c.id === activeId ? 'font-medium text-fg' : 'text-muted group-hover:text-fg')}>{c.title}</span>
                  </button>
                )}
                {renaming !== c.id && (
                  <Menu>
                    <MenuTrigger asChild>
                      <button className="mr-1 rounded-md p-1 text-faint opacity-0 hover:bg-surface-3 hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Действия">
                        <MoreHorizontal className="size-4" />
                      </button>
                    </MenuTrigger>
                    <MenuContent>
                      <div className="px-2.5 py-1 text-[11px] text-faint">{formatRelative(c.updatedAt)} · {c.turns.length} сообщ.</div>
                      <MenuItem onSelect={() => setRenaming(c.id)}>
                        <Pencil /> Переименовать
                      </MenuItem>
                      <MenuItem onSelect={() => patch(c.id, { pinned: !c.pinned })}>
                        {c.pinned ? <PinOff /> : <Pin />} {c.pinned ? 'Открепить' : 'Закрепить'}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem danger onSelect={() => setDeleting(c.id)}>
                        <Trash2 /> Удалить
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Удалить диалог?"
        description="Диалог и все ответы будут удалены без возможности восстановления."
        onConfirm={() => {
          if (deleting) remove(deleting)
          if (deleting === activeId) onNew()
        }}
      />
    </div>
  )
}
