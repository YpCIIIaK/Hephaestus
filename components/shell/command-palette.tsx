'use client'

import { Command } from 'cmdk'
import { Dialog as D } from 'radix-ui'
import { MessageSquarePlus, Moon, Plus, Swords, Telescope, Workflow } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useChats } from '@/lib/stores/chats'
import { usePipelines } from '@/lib/stores/pipelines'
import { formatRelative } from '@/lib/utils'
import { NAV, SETTINGS_NAV } from './nav'

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'л')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { open, setOpen }
}

const itemCls =
  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted'
const groupCls = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const chats = useChats((s) => s.conversations)
  const pipelines = usePipelines((s) => s.pipelines)

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <D.Title className="sr-only">Командная палитра</D.Title>
          <D.Description className="sr-only">Переход по разделам и быстрые действия</D.Description>
          <Command label="Командная палитра" className="flex flex-col">
            <Command.Input placeholder="Куда перейти или что сделать…" className="h-12 border-b border-border bg-transparent px-4 text-[15px] outline-none placeholder:text-faint" />
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">Ничего не найдено</Command.Empty>
              <Command.Group heading="Действия" className={groupCls}>
                <Command.Item className={itemCls} onSelect={() => go('/chat?new=1')}>
                  <MessageSquarePlus /> Новый чат
                </Command.Item>
                <Command.Item className={itemCls} onSelect={() => go('/forge?new=1')}>
                  <Workflow /> Новый пайплайн
                </Command.Item>
                <Command.Item className={itemCls} onSelect={() => go('/debates?new=1')}>
                  <Swords /> Новые дебаты
                </Command.Item>
                <Command.Item className={itemCls} onSelect={() => go('/scenarios?new=1')}>
                  <Telescope /> Новый сценарный анализ
                </Command.Item>
                <Command.Item
                  className={itemCls}
                  onSelect={() => {
                    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
                    onOpenChange(false)
                  }}
                >
                  <Moon /> Сменить тему
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Разделы" className={groupCls}>
                {[...NAV, SETTINGS_NAV].map((n) => (
                  <Command.Item key={n.href} value={`${n.label} ${n.hint}`} className={itemCls} onSelect={() => go(n.href)}>
                    <n.icon /> {n.label}
                    <span className="ml-auto text-xs text-faint">{n.hint}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {chats.length > 0 && (
                <Command.Group heading="Недавние чаты" className={groupCls}>
                  {chats
                    .slice()
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .slice(0, 8)
                    .map((c) => (
                      <Command.Item key={c.id} value={`чат ${c.title} ${c.id}`} className={itemCls} onSelect={() => go(`/chat?c=${c.id}`)}>
                        <MessageSquarePlus /> <span className="truncate">{c.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-faint">{formatRelative(c.updatedAt)}</span>
                      </Command.Item>
                    ))}
                </Command.Group>
              )}
              {pipelines.length > 0 && (
                <Command.Group heading="Пайплайны" className={groupCls}>
                  {pipelines.slice(0, 8).map((p) => (
                    <Command.Item key={p.id} value={`пайплайн ${p.name} ${p.id}`} className={itemCls} onSelect={() => go(`/forge/${p.id}`)}>
                      <Plus /> <span>{p.emoji}</span> <span className="truncate">{p.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
