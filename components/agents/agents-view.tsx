'use client'

import { Bot, Copy, MessageSquare, MoreHorizontal, Pencil, Plus, Puzzle, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Markdown } from '@/components/markdown'
import { ModelName, ModelPicker } from '@/components/model-picker'
import { PageHeader } from '@/components/shell/page-header'
import { TOOLSET_ICONS, ToolsetToggles } from '@/components/tool-chips'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, Textarea } from '@/components/ui/field'
import { Badge, EmptyState, Segmented, Spinner } from '@/components/ui/misc'
import { Confirm, Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Slider, Tip } from '@/components/ui/overlay'
import { AGENT_EMOJIS, type Agent } from '@/lib/agents'
import { api } from '@/lib/client/llm'
import { useAgents, useAllAgents } from '@/lib/stores/agents'
import { useSettings } from '@/lib/stores/settings'
import { TOOLSET_INFO } from '@/lib/tool-labels'
import type { Skill } from '@/lib/types'
import { formatRelative, uid } from '@/lib/utils'

function AgentEditor({ agent, open, onOpenChange }: { agent: Agent | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const upsert = useAgents((s) => s.upsert)
  const [a, setA] = useState<Agent | null>(agent)
  useEffect(() => setA(agent), [agent])
  if (!a) return null
  const set = (p: Partial<Agent>) => setA({ ...a, ...p })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={agent?.name ? `Агент «${agent.name}»` : 'Новый агент'}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!a.name.trim() || !a.systemPrompt.trim()}
            onClick={() => {
              upsert({ ...a, builtin: false })
              onOpenChange(false)
              toast.success('Агент сохранён')
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-2xl hover:border-accent/50" aria-label="Эмодзи">
                {a.emoji}
              </button>
            </PopoverTrigger>
            <PopoverContent className="grid w-64 grid-cols-6 gap-1 p-2">
              {AGENT_EMOJIS.map((e) => (
                <button key={e} onClick={() => set({ emoji: e })} className="rounded-lg p-1.5 text-xl hover:bg-surface-2">
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <Input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Имя агента" />
            <Input value={a.role} onChange={(e) => set({ role: e.target.value })} placeholder="Коротко: что делает" />
          </div>
        </div>
        <FieldRow label="Модель">
          <ModelPicker value={a.model} onChange={(model) => set({ model })} />
        </FieldRow>
        <FieldRow label="Системный промпт" hint="Кто этот агент, как он думает и в каком виде отвечает">
          <Textarea rows={7} value={a.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={`Температура · ${a.temperature.toFixed(1)}`}>
            <Slider min={0} max={2} step={0.1} value={[a.temperature]} onValueChange={([v]) => set({ temperature: v })} />
          </FieldRow>
          <FieldRow label="Макс. токенов ответа">
            <Input type="number" min={100} max={64000} value={a.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) || 2000 })} />
          </FieldRow>
        </div>
        <FieldRow label="Инструменты">
          <ToolsetToggles value={a.tools} onChange={(tools) => set({ tools })} />
        </FieldRow>
      </div>
    </Dialog>
  )
}

function AgentsTab() {
  const agents = useAllAgents()
  const remove = useAgents((s) => s.remove)
  const duplicate = useAgents((s) => s.duplicate)
  const setChat = useSettings((s) => s.setChat)
  const router = useRouter()
  const [editing, setEditing] = useState<Agent | null>(null)
  const [deleting, setDeleting] = useState<Agent | null>(null)

  const blank = (): Agent => ({ id: uid('agent'), name: '', emoji: '🤖', role: '', model: '@default', systemPrompt: '', temperature: 0.7, maxTokens: 2000, tools: [] })

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Агентов можно звать в чат, ставить в узлы пайплайнов и сравнивать между собой.</p>
        <Button variant="primary" onClick={() => setEditing(blank())}>
          <Plus /> Новый агент
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <div key={a.id} className="group flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft transition-colors hover:border-border-strong">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-2xl">{a.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{a.name}</span>
                  {a.builtin ? <Badge>встроенный</Badge> : <Badge tone="accent">свой</Badge>}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{a.role}</div>
              </div>
              <Menu>
                <MenuTrigger asChild>
                  <button className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Действия">
                    <MoreHorizontal className="size-4" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  {!a.builtin && (
                    <MenuItem onSelect={() => setEditing(a)}>
                      <Pencil /> Изменить
                    </MenuItem>
                  )}
                  <MenuItem
                    onSelect={() => {
                      const copy = duplicate(a.id)
                      if (copy) setEditing(copy)
                    }}
                  >
                    <Copy /> {a.builtin ? 'Копия для правки' : 'Дублировать'}
                  </MenuItem>
                  {!a.builtin && (
                    <>
                      <MenuSeparator />
                      <MenuItem danger onSelect={() => setDeleting(a)}>
                        <Trash2 /> Удалить
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted">
              <ModelName id={a.model} className="min-w-0 flex-1" />
              {a.tools.map((t) => {
                const Icon = TOOLSET_ICONS[t]
                return (
                  <Tip key={t} content={TOOLSET_INFO[t].label}>
                    <Icon className="size-3.5 shrink-0 text-faint" />
                  </Tip>
                )
              })}
              <Button
                size="sm"
                variant="ghost"
                className="-mr-2 h-7"
                onClick={() => {
                  setChat({ targets: [{ kind: 'agent', id: a.id }] })
                  router.push('/chat?new=1')
                }}
              >
                <MessageSquare /> В чат
              </Button>
            </div>
          </div>
        ))}
      </div>
      <AgentEditor agent={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />
      <Confirm open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Удалить агента «${deleting?.name}»?`} description="Пайплайны, которые на него ссылаются, перестанут работать." onConfirm={() => deleting && remove(deleting.id)} />
    </>
  )
}

type SkillDraft = { id?: string; name: string; description: string; category?: string; content: string }

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [editing, setEditing] = useState<SkillDraft | null>(null)
  const [viewing, setViewing] = useState<Skill | null>(null)
  const [deleting, setDeleting] = useState<Skill | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () =>
    api<{ skills: Skill[] }>('/api/skills')
      .then((d) => setSkills(d.skills))
      .catch((e) => toast.error(e.message))
  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api('/api/skills', { method: 'POST', json: editing })
      toast.success('Навык сохранён')
      setEditing(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Навык — инструкция в <code className="font-mono text-xs">skills/&lt;id&gt;/SKILL.md</code>. Модель с включённым инструментом «Навыки» сама загружает подходящий.
        </p>
        <Button variant="primary" onClick={() => setEditing({ name: '', description: '', content: '' })}>
          <Plus /> Новый навык
        </Button>
      </div>
      {!skills ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : skills.length === 0 ? (
        <EmptyState icon={<Puzzle />} title="Навыков пока нет">
          Создайте первый: опишите, как выполнять типовую задачу — формат отчёта, чек-лист ревью, стиль перевода.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {skills.map((s) => (
            <div key={s.id} className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Puzzle className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{s.name}</div>
                  <div className="font-mono text-[11px] text-faint">{s.id}</div>
                </div>
                {s.category && <Badge>{s.category}</Badge>}
              </div>
              <p className="mt-2 line-clamp-3 flex-1 text-[13px] text-muted">{s.description}</p>
              <div className="mt-3 flex items-center gap-1 border-t border-border pt-2.5">
                <span className="mr-auto text-[11px] text-faint">{formatRelative(s.updatedAt)}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setViewing(s)}>
                  Открыть
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(s)} aria-label="Изменить">
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" className="hover:text-danger" onClick={() => setDeleting(s)} aria-label="Удалить">
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        title={editing?.id ? `Навык «${editing.name}»` : 'Новый навык'}
        className="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            <Button variant="primary" disabled={!editing?.name.trim() || !editing?.content.trim() || saving} onClick={save}>
              {saving && <Spinner />} Сохранить
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Название" />
              <Input value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value || undefined })} placeholder="Категория" />
            </div>
            <FieldRow label="Когда применять" hint="По этому описанию модель решает, загружать ли навык">
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Например: ревью кода с поиском уязвимостей" />
            </FieldRow>
            <FieldRow label="Инструкция (Markdown)">
              <Textarea rows={14} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className="font-mono text-[12.5px]" placeholder={'## Как выполнять\n1. …\n\n## Формат ответа\n…'} />
            </FieldRow>
          </div>
        )}
      </Dialog>
      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)} title={viewing?.name ?? ''} description={viewing?.description} className="max-w-3xl">
        {viewing && <Markdown text={viewing.content} />}
      </Dialog>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Удалить навык «${deleting?.name}»?`}
        description="Папка навыка будет удалена с диска."
        onConfirm={async () => {
          if (!deleting) return
          try {
            await api(`/api/skills?id=${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
            load()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
          }
        }}
      />
    </>
  )
}

export function AgentsView() {
  const [tab, setTab] = useState<'agents' | 'skills'>('agents')
  return (
    <>
      <PageHeader
        icon={<Bot />}
        title="Агенты и навыки"
        subtitle="Роли с собственными моделями, промптами и инструментами"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'agents', label: <><Bot /> Агенты</> },
              { value: 'skills', label: <><Puzzle /> Навыки</> },
            ]}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{tab === 'agents' ? <AgentsTab /> : <SkillsTab />}</div>
      </div>
    </>
  )
}
