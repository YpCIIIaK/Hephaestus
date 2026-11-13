'use client'

import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Crosshair, ExternalLink, Maximize2, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Badge, Spinner } from '@/components/ui/misc'
import { NODE_META, type Pipeline, type PipelineRun } from '@/lib/engine/pipeline'
import { cn, formatCost, formatMs } from '@/lib/utils'
import { ForgeNodeView, type ForgeFlowNode } from './forge-node'
import { NodeOutput } from './inspector'
import { NODE_STYLE } from './node-meta'

const nodeTypes = { forge: ForgeNodeView }

/** Секундомер, который тикает, пока запуск идёт */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** Сводка запуска: статус, время, сколько блоков готово, что работает сейчас, стоимость */
export function RunSummary({ pipeline, run, className }: { pipeline: Pick<Pipeline, 'nodes'>; run?: PipelineRun; className?: string }) {
  const live = run?.status === 'running'
  const now = useNow(live)
  if (!run) return <div className={cn('text-xs text-muted', className)}>Запуска ещё не было</div>
  const states = pipeline.nodes.map((n) => run.nodes[n.id]?.status ?? 'idle')
  const finished = states.filter((s) => s === 'done' || s === 'skipped' || s === 'error').length
  const running = pipeline.nodes.filter((n) => run.nodes[n.id]?.status === 'running')
  const errors = states.filter((s) => s === 'error').length
  const elapsed = (run.endedAt ?? now) - run.startedAt
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs', className)}>
      {live ? (
        <Badge tone="accent">
          <Spinner className="size-3" /> идёт
        </Badge>
      ) : run.status === 'done' ? (
        <Badge tone={errors ? 'warning' : 'success'}>{errors ? 'готово с ошибками' : 'готово'}</Badge>
      ) : run.status === 'error' ? (
        <Badge tone="danger">ошибка</Badge>
      ) : (
        <Badge>остановлен</Badge>
      )}
      <span className="flex items-center gap-1.5 text-muted">
        <span className="h-1 w-20 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(finished / Math.max(1, pipeline.nodes.length)) * 100}%` }} />
        </span>
        {finished}/{pipeline.nodes.length}
      </span>
      <span className="font-mono text-faint">{formatMs(Math.max(0, elapsed))}</span>
      {run.usage.cost != null && run.usage.cost > 0 && <span className="font-mono text-faint">{formatCost(run.usage.cost)}</span>}
      {running.length > 0 && <span className="min-w-0 truncate text-muted">сейчас: {running.map((n) => n.label).join(', ')}</span>}
    </div>
  )
}

function Graph({ pipeline, run, compact, selected, onSelect, follow }: { pipeline: Pipeline; run?: PipelineRun; compact: boolean; selected: string | null; onSelect: (id: string | null) => void; follow: boolean }) {
  const rf = useReactFlow()
  // Размеры блоков держим между перерисовками — иначе React Flow прячет их до повторного замера
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const nodes: ForgeFlowNode[] = useMemo(
    () =>
      pipeline.nodes.map((n) => ({
        id: n.id,
        type: 'forge',
        position: n.position,
        measured: measured[n.id],
        selected: n.id === selected,
        draggable: false,
        connectable: false,
        data: { node: n, run: run?.nodes[n.id] },
      })),
    [pipeline.nodes, run, selected, measured],
  )
  const edges: Edge[] = useMemo(
    () =>
      pipeline.edges.map((e) => {
        const src = run?.nodes[e.source]
        const dst = run?.nodes[e.target]
        // Ветка маршрутизатора, которую не выбрали, не подсвечивается
        const routeTaken = !e.sourceHandle || !src?.route || src.route === e.sourceHandle
        const live = src?.status === 'done' && dst?.status === 'running' && routeTaken
        const passed = src?.status === 'done' && (dst?.status === 'done' || dst?.status === 'error') && routeTaken
        return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, className: live ? 'edge-live' : passed ? 'edge-done' : run ? 'edge-idle' : undefined }
      }),
    [pipeline.edges, run],
  )
  const onNodesChange = useCallback((changes: NodeChange<ForgeFlowNode>[]) => {
    for (const ch of changes) {
      if (ch.type === 'dimensions' && ch.dimensions) {
        const { width, height } = ch.dimensions
        setMeasured((m) => (m[ch.id]?.width === width && m[ch.id]?.height === height ? m : { ...m, [ch.id]: { width, height } }))
      }
    }
  }, [])

  // Слежение: камера плавно переезжает к блокам, которые работают сейчас
  const runningIds = pipeline.nodes.filter((n) => run?.nodes[n.id]?.status === 'running').map((n) => n.id).join(',')
  useEffect(() => {
    if (!follow || !runningIds) return
    void rf.fitView({ nodes: runningIds.split(',').map((id) => ({ id })), duration: 500, maxZoom: compact ? 0.9 : 1.1, padding: compact ? 0.6 : 0.35 })
  }, [follow, runningIds, rf, compact])

  return (
    <ReactFlow<ForgeFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: compact ? 0.06 : 0.12, maxZoom: compact ? 0.8 : 1 }}
      minZoom={0.15}
      // В чате колесо прокручивает чат, а не масштаб схемы
      zoomOnScroll={!compact}
      preventScrolling={!compact}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'smoothstep' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--border-strong)" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  )
}

/** Логи выбранного блока: запрос, инструменты, вывод, ошибки, отказы, копия проекта */
function NodeLogs({ pipeline, run, nodeId, onClose }: { pipeline: Pipeline; run?: PipelineRun; nodeId: string; onClose: () => void }) {
  const node = pipeline.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const style = NODE_STYLE[node.kind]
  const Icon = style.icon
  const nr = run?.nodes[nodeId]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in oklch, ${style.color} 16%, transparent)`, color: style.color }}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{node.label}</div>
          <div className="text-[10.5px] uppercase tracking-wider text-faint">{NODE_META[node.kind].title}</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Закрыть логи">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{nr && nr.status !== 'idle' ? <NodeOutput run={nr} /> : <div className="text-[13px] text-muted">Блок ещё не запускался</div>}</div>
    </div>
  )
}

/**
 * Живая схема запуска: блоки подсвечиваются по ходу работы, связи показывают,
 * куда сейчас идут данные. Клик по блоку — его логи.
 * compact — для чата (не перехватывает прокрутку); иначе — на весь экран.
 */
export function RunGraph({ pipeline, run, compact = false, onFullscreen }: { pipeline: Pipeline; run?: PipelineRun; compact?: boolean; onFullscreen?: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [follow, setFollow] = useState(!compact)
  return (
    <div className={cn('flex min-h-0 flex-col', compact ? 'h-[420px]' : 'h-full')}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {/* В чате сводка уже есть в строке окошка — не повторяем */}
        {compact ? <span className="flex-1 text-[11px] text-faint">клик по блоку — его логи</span> : <RunSummary pipeline={pipeline} run={run} className="min-w-0 flex-1" />}
        <Button size="sm" variant={follow ? 'secondary' : 'ghost'} onClick={() => setFollow((f) => !f)} title="Камера следует за работающими блоками">
          <Crosshair /> {compact ? '' : 'Следить'}
        </Button>
        {onFullscreen && (
          <Button size="sm" variant="ghost" onClick={onFullscreen} title="На весь экран">
            <Maximize2 />
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild title="Открыть пайплайн в Кузнице">
          <Link href={`/forge/${pipeline.id}`}>
            <ExternalLink />
          </Link>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          <ReactFlowProvider>
            <Graph pipeline={pipeline} run={run} compact={compact} selected={selected} onSelect={setSelected} follow={follow} />
          </ReactFlowProvider>
          {!selected && !compact && <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-surface/80 px-2 py-1 text-[11px] text-faint">клик по блоку — логи</div>}
        </div>
        {selected && (
          <div className={cn('min-h-0 border-l border-border bg-surface', compact ? 'w-[52%]' : 'w-[min(480px,45%)]')}>
            <NodeLogs pipeline={pipeline} run={run} nodeId={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Схема запуска на весь экран — поверх всего, закрывается Esc */
export function RunFullscreen({ pipeline, run, onClose }: { pipeline: Pipeline; run?: PipelineRun; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="text-lg">{pipeline.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{pipeline.name}</div>
          {run?.input && <div className="truncate text-xs text-muted">Вход: {run.input}</div>}
        </div>
        <Button variant="ghost" onClick={onClose}>
          <X /> Закрыть · Esc
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <RunGraph pipeline={pipeline} run={run} />
      </div>
    </div>,
    document.body,
  )
}
