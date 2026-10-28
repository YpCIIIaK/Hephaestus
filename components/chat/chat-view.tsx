'use client'

import { Columns3, Download, Gavel, MoreHorizontal, PanelLeft, Rows3, ScrollText, Trash2, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/misc'
import { Confirm, Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Sheet, Tip } from '@/components/ui/overlay'
import { Textarea } from '@/components/ui/field'
import { conversationToMarkdown, describeTarget, newConversation, sendMessage, stopConversation, useChatRuntime } from '@/lib/client/chat-runner'
import { participantColor } from '@/lib/colors'
import { targetKey, type ChatTarget, type Conversation } from '@/lib/engine/chat'
import { useChats } from '@/lib/stores/chats'
import { useSettings } from '@/lib/stores/settings'
import { cn, downloadFile } from '@/lib/utils'
import { Composer, type ComposerHandle } from './composer'
import { ConversationList } from './conversation-list'
import { EmptyChat } from './empty-chat'
import { TargetPicker } from './target-picker'
import { TurnView } from './turn-view'

function TargetChip({ target, index, onRemove, removable }: { target: ChatTarget; index: number; onRemove: () => void; removable: boolean }) {
  const info = describeTarget(target)
  return (
    <span className="inline-flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface pl-2 pr-1 text-xs font-medium" title={info.subtitle}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: participantColor(index) }} />
      {info.emoji && <span>{info.emoji}</span>}
      <span className="truncate">{info.name}</span>
      {removable && (
        <button onClick={onRemove} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg" aria-label={`Убрать ${info.name}`}>
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

export function ChatView() {
  const params = useSearchParams()
  const router = useRouter()
  const conversations = useChats((s) => s.conversations)
  const createConv = useChats((s) => s.create)
  const patchConv = useChats((s) => s.patch)
  const removeConv = useChats((s) => s.remove)
  const truncateFrom = useChats((s) => s.truncateFrom)
  const defaults = useSettings((s) => s.chat)
  const setChatDefaults = useSettings((s) => s.setChat)
  const runningCount = useChatRuntime((s) => s.running)
  const composer = useRef<ComposerHandle>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [listOpen, setListOpen] = useState(false)
  const [layout, setLayout] = useState<'columns' | 'stack'>('columns')
  const [systemOpen, setSystemOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Черновик: диалог ещё не создан, но участники и инструменты уже выбраны
  const [draft, setDraft] = useState<Conversation>(() => newConversation())

  const activeId = params.get('c')
  const conv = conversations.find((c) => c.id === activeId) ?? null
  const view = conv ?? draft
  const running = conv ? (runningCount[conv.id] ?? 0) > 0 : false

  useEffect(() => {
    if (params.get('new')) {
      setDraft(newConversation())
      router.replace('/chat')
    }
  }, [params, router])

  useEffect(() => {
    if (activeId && !conv && conversations.length >= 0) router.replace('/chat')
  }, [activeId, conv, conversations.length, router])

  const update = useCallback(
    (patch: Partial<Conversation>) => {
      if (conv) patchConv(conv.id, patch)
      else setDraft((d) => ({ ...d, ...patch }))
      if (patch.targets) setChatDefaults({ targets: patch.targets })
      if (patch.tools) setChatDefaults({ tools: patch.tools })
    },
    [conv, patchConv, setChatDefaults],
  )

  const toggleTarget = (t: ChatTarget) => {
    const key = targetKey(t)
    const exists = view.targets.some((x) => targetKey(x) === key)
    if (exists && view.targets.length === 1) return
    update({ targets: exists ? view.targets.filter((x) => targetKey(x) !== key) : [...view.targets, t].slice(0, 8) })
  }

  const send = async (text: string, files: { name: string; content: string }[]) => {
    let id = conv?.id
    if (!id) {
      const fresh = { ...draft, id: draft.id, createdAt: Date.now(), updatedAt: Date.now() }
      createConv(fresh)
      id = fresh.id
      setDraft(newConversation())
      router.replace(`/chat?c=${id}`)
    }
    stickToBottom.current = true
    await sendMessage(id, text, files)
  }

  // Автопрокрутка, пока пользователь сам не прокрутил вверх
  const lastTurn = view.turns[view.turns.length - 1]
  const streamSignature = useMemo(() => (lastTurn ? Object.values(lastTurn.replies).reduce((s, r) => s + r.text.length + (r.tools?.length ?? 0), 0) + (lastTurn.judge?.raw.length ?? 0) : 0), [lastTurn])
  useEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [streamSignature, view.turns.length])

  const list = (
    <ConversationList
      activeId={conv?.id ?? null}
      onSelect={(id) => {
        router.push(`/chat?c=${id}`)
        setListOpen(false)
      }}
      onNew={() => {
        setDraft(newConversation())
        router.push('/chat')
        setListOpen(false)
        composer.current?.focus()
      }}
    />
  )

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface/40 lg:block">{list}</aside>
      <Sheet open={listOpen} onOpenChange={setListOpen} title="Диалоги">
        {list}
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 md:px-5">
          <Tip content="Диалоги">
            <button onClick={() => setListOpen(true)} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg lg:hidden" aria-label="Диалоги">
              <PanelLeft className="size-4" />
            </button>
          </Tip>
          <div className="-my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 md:flex-wrap md:overflow-visible">
            {view.targets.map((t, i) => (
              <TargetChip key={targetKey(t)} target={t} index={i} removable={view.targets.length > 1} onRemove={() => toggleTarget(t)} />
            ))}
            <TargetPicker value={view.targets} onToggle={toggleTarget} />
          </div>
          {view.targets.length > 1 && (
            <Segmented
              className="hidden md:inline-flex"
              size="sm"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'columns', label: <Columns3 />, title: 'Колонки' },
                { value: 'stack', label: <Rows3 />, title: 'Лентой' },
              ]}
            />
          )}
          <Tip content={view.systemPrompt ? 'Системный промпт задан' : 'Системный промпт'}>
            <button onClick={() => setSystemOpen(true)} className={cn('flex size-8 items-center justify-center rounded-lg hover:bg-surface-2', view.systemPrompt ? 'text-accent' : 'text-muted hover:text-fg')} aria-label="Системный промпт">
              <ScrollText className="size-4" />
            </button>
          </Tip>
          {conv && (
            <Menu>
              <MenuTrigger asChild>
                <button className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Ещё">
                  <MoreHorizontal className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setChatDefaults({ autoJudge: !defaults.autoJudge })}>
                  <Gavel /> Автосудья: {defaults.autoJudge ? 'вкл' : 'выкл'}
                </MenuItem>
                <MenuItem onSelect={() => downloadFile(`${conv.title}.md`, conversationToMarkdown(conv), 'text/markdown')}>
                  <Download /> Экспорт в Markdown
                </MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => setDeleting(true)}>
                  <Trash2 /> Удалить диалог
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {view.turns.length === 0 ? (
            <EmptyChat
              onPick={(text) => composer.current?.setText(text)}
              onPreset={(targets) => update({ targets })}
            />
          ) : (
            <div className={cn('mx-auto space-y-8 px-3 py-6 md:px-6', view.targets.length > 1 && layout === 'columns' ? 'max-w-[1400px]' : 'max-w-3xl')}>
              {view.turns.map((t, i) => (
                <TurnView
                  key={t.id}
                  convId={view.id}
                  turn={t}
                  targets={view.targets}
                  layout={layout}
                  isLast={i === view.turns.length - 1}
                  running={running}
                  onEdit={() => {
                    truncateFrom(view.id, t.id)
                    composer.current?.setText(t.user)
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 px-3 pb-3 md:px-6 md:pb-5">
          <div className="mx-auto max-w-3xl">
            <Composer
              ref={composer}
              running={running}
              onStop={() => conv && stopConversation(conv.id)}
              onSend={send}
              tools={view.tools}
              onToolsChange={(tools) => update({ tools })}
              placeholder={view.targets.length > 1 ? `Вопрос для ${view.targets.length} участников…` : undefined}
            />
          </div>
        </div>
      </section>

      <Dialog
        open={systemOpen}
        onOpenChange={setSystemOpen}
        title="Системный промпт"
        description="Общая инструкция для всех участников диалога. У агентов она добавляется к их собственной."
        footer={<Button onClick={() => setSystemOpen(false)}>Готово</Button>}
      >
        <Textarea autoFocus rows={8} value={view.systemPrompt} onChange={(e) => update({ systemPrompt: e.target.value })} placeholder="Например: отвечай кратко, как опытный инженер." />
      </Dialog>
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title="Удалить диалог?"
        description="Диалог и все ответы будут удалены."
        onConfirm={() => {
          if (conv) removeConv(conv.id)
          router.replace('/chat')
        }}
      />
    </div>
  )
}
