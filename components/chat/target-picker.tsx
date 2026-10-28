'use client'

import { Bot, Cpu, Plus, Workflow } from 'lucide-react'
import { useState } from 'react'
import { ModelList } from '@/components/model-picker'
import { Segmented } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { targetKey, type ChatTarget } from '@/lib/engine/chat'
import { useAllAgents } from '@/lib/stores/agents'
import { usePipelines } from '@/lib/stores/pipelines'
import { cn } from '@/lib/utils'

export function TargetPicker({ value, onToggle, trigger }: { value: ChatTarget[]; onToggle: (t: ChatTarget) => void; trigger?: React.ReactNode }) {
  const [tab, setTab] = useState<'model' | 'agent' | 'pipeline'>('model')
  const agents = useAllAgents()
  const pipelines = usePipelines((s) => s.pipelines)
  const keys = new Set(value.map(targetKey))
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button className="inline-flex h-7 items-center gap-1 rounded-lg border border-dashed border-border-strong px-2 text-xs font-medium text-muted hover:border-accent hover:text-accent">
            <Plus className="size-3.5" /> Участник
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(440px,calc(100vw-2rem))] p-0">
        <div className="border-b border-border p-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'model', label: <><Cpu /> Модели</> },
              { value: 'agent', label: <><Bot /> Агенты</> },
              { value: 'pipeline', label: <><Workflow /> Пайплайны</> },
            ]}
          />
        </div>
        {tab === 'model' && <ModelList multi value={value.filter((t) => t.kind === 'model').map((t) => t.id)} onPick={(id) => onToggle({ kind: 'model', id })} />}
        {tab === 'agent' && (
          <div className="max-h-[420px] overflow-y-auto p-1.5">
            {agents.map((a) => {
              const on = keys.has(`agent:${a.id}`)
              return (
                <button key={a.id} onClick={() => onToggle({ kind: 'agent', id: a.id })} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2', on && 'bg-accent-soft hover:bg-accent-soft')}>
                  <span className="text-lg">{a.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="truncate text-xs text-muted">{a.role}</div>
                  </div>
                  {on && <span className="text-xs font-medium text-accent">добавлен</span>}
                </button>
              )
            })}
          </div>
        )}
        {tab === 'pipeline' && (
          <div className="max-h-[420px] overflow-y-auto p-1.5">
            {pipelines.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">Пайплайнов пока нет — соберите первый в Кузнице</div>}
            {pipelines.map((p) => {
              const on = keys.has(`pipeline:${p.id}`)
              return (
                <button key={p.id} onClick={() => onToggle({ kind: 'pipeline', id: p.id })} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2', on && 'bg-accent-soft hover:bg-accent-soft')}>
                  <span className="text-lg">{p.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted">{p.description || `${p.nodes.length} узлов`}</div>
                  </div>
                  {on && <span className="text-xs font-medium text-accent">добавлен</span>}
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
