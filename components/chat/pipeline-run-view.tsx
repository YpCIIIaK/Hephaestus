'use client'

import { ChevronDown, Workflow } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { usePipelines } from '@/lib/stores/pipelines'
import { cn } from '@/lib/utils'

// Схема тянет React Flow — грузим её, только когда окошко раскрыто
const RunGraph = dynamic(() => import('@/components/forge/run-graph').then((m) => m.RunGraph), { ssr: false })
const RunSummary = dynamic(() => import('@/components/forge/run-graph').then((m) => m.RunSummary), { ssr: false })
const RunFullscreen = dynamic(() => import('@/components/forge/run-graph').then((m) => m.RunFullscreen), { ssr: false })

/**
 * Ход пайплайна в ответе чата: строка со сводкой, по клику — живая схема,
 * где видно, какой блок работает, и логи любого блока. Во время работы
 * раскрыта, после — свёрнута.
 */
export function PipelineRunView({ runId, pipelineId, streaming }: { runId: string; pipelineId: string; streaming: boolean }) {
  const pipeline = usePipelines((s) => s.pipelines.find((p) => p.id === pipelineId))
  const run = usePipelines((s) => s.runs.find((r) => r.id === runId))
  const [open, setOpen] = useState(streaming)
  const [full, setFull] = useState(false)
  // Закончился — сворачиваем, если пользователь сам не трогал переключатель
  const touched = useRef(false)
  useEffect(() => {
    if (!streaming && !touched.current) setOpen(false)
  }, [streaming])

  if (!pipeline) return <div className="text-xs text-faint">Пайплайн удалён — схема запуска недоступна</div>
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-2/30">
      <button
        type="button"
        onClick={() => {
          touched.current = true
          setOpen((o) => !o)
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2/60"
        aria-expanded={open}
      >
        <Workflow className="size-3.5 shrink-0 text-accent" />
        <span className="shrink-0 text-xs font-medium">Схема запуска</span>
        <RunSummary pipeline={pipeline} run={run} className="min-w-0 flex-1" />
        <ChevronDown className={cn('size-4 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border bg-surface">
          <RunGraph pipeline={pipeline} run={run} compact onFullscreen={() => setFull(true)} />
        </div>
      )}
      {full && <RunFullscreen pipeline={pipeline} run={run} onClose={() => setFull(false)} />}
    </div>
  )
}
