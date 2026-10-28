'use client'

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, ArrowLeft, Download, History, Square, StepForward } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger, Sheet, Tip } from '@/components/ui/overlay'
import { continueStep, startPipeline, stopPipeline, usePipelineRunner, setStepMode } from '@/lib/client/pipeline-runner'
import { estimatePipelineCost, findCycle, NODE_META, validatePipeline, type NodeKind, type Pipeline, type PipelineEdge, type PipelineNode } from '@/lib/engine/pipeline'
import { getAgent } from '@/lib/stores/agents'
import { modelById, resolveModelId } from '@/lib/stores/catalog'
import { usePipelines } from '@/lib/stores/pipelines'
import { estimateTokens } from '@/lib/tokens'
import { cn, downloadFile, formatCost, uid } from '@/lib/utils'
import { ForgeNodeView, type ForgeFlowNode } from './forge-node'
import { Inspector } from './inspector'
import { NODE_STYLE, PALETTE_ORDER } from './node-meta'
import { RunPanel } from './run-panel'

const nodeTypes = { forge: ForgeNodeView }

const DEFAULT_CONFIG: Partial<Record<NodeKind, PipelineNode['config']>> = {
  agent: { model: '@default' },
  search: { query: '{{input}}', readPages: 0 },
  knowledge: { query: '{{input}}', limit: 5 },
  router: {
    routerMode: 'llm',
    routes: [
      { id: 'a', label: 'Ветка A' },
      { id: 'b', label: 'Ветка B' },
    ],
  },
  validator: { maxAttempts: 2 },
  write: { path: 'output/result.md' },
}

function uniqueLabel(nodes: PipelineNode[], base: string) {
  const taken = new Set(nodes.map((n) => n.label.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

function Palette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Узлы</div>
      {PALETTE_ORDER.map((kind) => {
        const s = NODE_STYLE[kind]
        const Icon = s.icon
        return (
          <Tip key={kind} content={NODE_META[kind].hint} side="right">
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/heph-node', kind)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => onAdd(kind)}
              className="flex cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 active:cursor-grabbing"
            >
              <span className="flex size-6 items-center justify-center rounded-md" style={{ background: `color-mix(in oklch, ${s.color} 16%, transparent)`, color: s.color }}>
                <Icon className="size-3.5" />
              </span>
              {NODE_META[kind].title}
            </button>
          </Tip>
        )
      })}
      <p className="mt-2 px-1 text-[11px] leading-relaxed text-faint">Перетащите на холст или нажмите. Соединяйте точки на краях узлов.</p>
    </div>
  )
}

function Canvas({ pipeline, onChange }: { pipeline: Pipeline; onChange: (p: Pipeline) => void }) {
  const rf = useReactFlow()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'run' | 'node'>('run')
  const [mobilePanel, setMobilePanel] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const runner = usePipelineRunner((s) => s.active[pipeline.id])
  const runs = usePipelines((s) => s.runs)
  const [viewRunId, setViewRunId] = useState<string | null>(null)
  const currentRun = runs.find((r) => r.id === (runner?.runId ?? viewRunId)) ?? runs.find((r) => r.pipelineId === pipeline.id)
  const issues = useMemo(() => validatePipeline(pipeline), [pipeline])
  const issueByNode = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>()
    for (const i of issues) if (i.nodeId && m.get(i.nodeId) !== 'error') m.set(i.nodeId, i.level)
    return m
  }, [issues])

  const flowNodes: ForgeFlowNode[] = useMemo(
    () =>
      pipeline.nodes.map((n) => ({
        id: n.id,
        type: 'forge',
        position: n.position,
        selected: n.id === selectedId,
        data: { node: n, run: currentRun?.pipelineId === pipeline.id ? currentRun.nodes[n.id] : undefined, waiting: runner?.waitingFor === n.id, issue: issueByNode.get(n.id) },
      })),
    [pipeline.nodes, selectedId, currentRun, runner?.waitingFor, issueByNode, pipeline.id],
  )

  const flowEdges: Edge[] = useMemo(
    () =>
      pipeline.edges.map((e) => {
        const live = currentRun?.status === 'running' && currentRun.nodes[e.target]?.status === 'running' && currentRun.nodes[e.source]?.status === 'done'
        return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, className: live ? 'edge-live' : undefined, animated: false }
      }),
    [pipeline.edges, currentRun],
  )

  const patchNodes = (fn: (nodes: PipelineNode[]) => PipelineNode[], edges = pipeline.edges) => onChange({ ...pipeline, nodes: fn(pipeline.nodes), edges, updatedAt: new Date().toISOString() })

  const onNodesChange = useCallback(
    (changes: NodeChange<ForgeFlowNode>[]) => {
      let nodes = pipeline.nodes
      let edges = pipeline.edges
      let changed = false
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          nodes = nodes.map((n) => (n.id === ch.id ? { ...n, position: ch.position! } : n))
          changed = true
        } else if (ch.type === 'remove') {
          nodes = nodes.filter((n) => n.id !== ch.id)
          edges = edges.filter((e) => e.source !== ch.id && e.target !== ch.id)
          if (selectedId === ch.id) setSelectedId(null)
          changed = true
        } else if (ch.type === 'select' && ch.selected) {
          setSelectedId(ch.id)
          setPanel('node')
        }
      }
      if (changed) onChange({ ...pipeline, nodes, edges, updatedAt: new Date().toISOString() })
    },
    [pipeline, onChange, selectedId],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
      if (removed.size) onChange({ ...pipeline, edges: pipeline.edges.filter((e) => !removed.has(e.id)), updatedAt: new Date().toISOString() })
    },
    [pipeline, onChange],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return
      if (pipeline.edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))) return
      const edge: PipelineEdge = { id: uid('e'), source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? null }
      const edges = [...pipeline.edges, edge]
      if (findCycle(pipeline.nodes, edges)) {
        toast.error('Такая связь создаст цикл', { description: 'Для повторной доработки используйте узел «Проверка».' })
        return
      }
      onChange({ ...pipeline, edges, updatedAt: new Date().toISOString() })
    },
    [pipeline, onChange],
  )

  const addNode = (kind: NodeKind, position?: { x: number; y: number }) => {
    const rect = wrapper.current?.getBoundingClientRect()
    const pos = position ?? rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 115, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 40 })
    const node: PipelineNode = { id: uid('n'), kind, label: uniqueLabel(pipeline.nodes, NODE_META[kind].title), position: pos, config: structuredClone(DEFAULT_CONFIG[kind] ?? {}) }
    patchNodes((nodes) => [...nodes, node])
    setSelectedId(node.id)
    setPanel('node')
  }

  const selected = pipeline.nodes.find((n) => n.id === selectedId)

  const run = async (input: string, step: boolean) => {
    const errors = issues.filter((i) => i.level === 'error')
    if (errors.length) {
      toast.error('Пайплайн не готов к запуску', { description: errors[0].message })
      return
    }
    setPanel('run')
    setViewRunId(null)
    const result = await startPipeline(pipeline, input, step)
    if (result.status === 'done') toast.success('Пайплайн выполнен', { description: result.error })
    else if (result.status === 'error') toast.error('Пайплайн завершился с ошибкой', { description: result.error })
  }

  const sidePanel =
    panel === 'node' && selected ? (
      <Inspector
        pipeline={pipeline}
        node={selected}
        run={currentRun?.pipelineId === pipeline.id ? currentRun.nodes[selected.id] : undefined}
        onClose={() => {
          setSelectedId(null)
          setPanel('run')
        }}
        onChange={(patch) => patchNodes((nodes) => nodes.map((n) => (n.id === selected.id ? { ...n, ...patch } : n)))}
        onDelete={() => {
          patchNodes(
            (nodes) => nodes.filter((n) => n.id !== selected.id),
            pipeline.edges.filter((e) => e.source !== selected.id && e.target !== selected.id),
          )
          setSelectedId(null)
          setPanel('run')
        }}
        onDuplicate={() => {
          const copy: PipelineNode = { ...structuredClone(selected), id: uid('n'), label: uniqueLabel(pipeline.nodes, selected.label), position: { x: selected.position.x + 40, y: selected.position.y + 60 } }
          patchNodes((nodes) => [...nodes, copy])
          setSelectedId(copy.id)
        }}
      />
    ) : (
      <RunPanel pipeline={pipeline} run={currentRun?.pipelineId === pipeline.id ? currentRun : undefined} onRun={run} onSelectRun={setViewRunId} onSelectNode={(id) => { setSelectedId(id); setPanel('node') }} />
    )

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-48 shrink-0 overflow-y-auto border-r border-border bg-surface/40 md:block">
        <Palette onAdd={(k) => addNode(k)} />
      </aside>
      <div
        ref={wrapper}
        className="relative min-w-0 flex-1"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const kind = e.dataTransfer.getData('application/heph-node') as NodeKind
          if (kind) addNode(kind, rf.screenToFlowPosition({ x: e.clientX - 115, y: e.clientY - 30 }))
        }}
      >
        <ReactFlow<ForgeFlowNode>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={() => {
            setSelectedId(null)
            setPanel('run')
          }}
          fitView
          fitViewOptions={{ padding: 0.15, minZoom: 0.6, maxZoom: 1 }}
          minZoom={0.2}
          deleteKeyCode={['Delete', 'Backspace']}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--border-strong)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {runner?.waitingFor && (
          <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-warning/40 bg-surface px-3 py-2 shadow-float">
            <span className="text-[13px]">
              Следующий шаг: <b>{pipeline.nodes.find((n) => n.id === runner.waitingFor)?.label}</b>
            </span>
            <Button size="sm" variant="primary" onClick={() => continueStep(pipeline.id)}>
              <StepForward /> Дальше
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStepMode(pipeline.id, false)}>
              До конца
            </Button>
          </div>
        )}
        <div className="absolute right-3 top-3 z-10 flex gap-2 md:hidden">
          <Button size="sm" onClick={() => setMobilePanel(true)}>
            {selected ? 'Настройки узла' : 'Запуск'}
          </Button>
        </div>
        <div className="absolute left-3 top-3 z-10 md:hidden">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm">+ Узел</Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0">
              <Palette onAdd={(k) => addNode(k)} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <aside className="hidden w-[380px] shrink-0 border-l border-border bg-surface/40 md:block">{sidePanel}</aside>
      <Sheet open={mobilePanel} onOpenChange={setMobilePanel} side="right" title="Панель">
        {sidePanel}
      </Sheet>
    </div>
  )
}

function Header({ pipeline, onChange }: { pipeline: Pipeline; onChange: (p: Pipeline) => void }) {
  const runner = usePipelineRunner((s) => s.active[pipeline.id])
  const issues = useMemo(() => validatePipeline(pipeline), [pipeline])
  const errors = issues.filter((i) => i.level === 'error')
  const estimate = useMemo(
    () =>
      estimatePipelineCost(
        pipeline,
        estimateTokens('x'.repeat(400)),
        (m) => {
          const real = resolveModelId(m)
          const info = real ? modelById(real) : undefined
          return info?.provider === 'ollama' ? { prompt: 0, completion: 0 } : info?.pricing
        },
        getAgent,
      ),
    [pipeline],
  )
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 md:px-4">
      <Link href="/forge" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="К списку пайплайнов">
        <ArrowLeft className="size-4" />
      </Link>
      <input value={pipeline.emoji} onChange={(e) => onChange({ ...pipeline, emoji: [...e.target.value].slice(-1).join('') || '⚒️' })} className="w-9 rounded-md bg-transparent text-center text-xl outline-none hover:bg-surface-2" aria-label="Эмодзи" />
      <input value={pipeline.name} onChange={(e) => onChange({ ...pipeline, name: e.target.value, updatedAt: new Date().toISOString() })} className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none hover:bg-surface-2 focus:bg-surface-2" aria-label="Название" />
      <Popover>
        <PopoverTrigger asChild>
          <button className="hidden sm:block">
            {issues.length === 0 ? (
              <Badge tone="success">Готов к запуску</Badge>
            ) : (
              <Badge tone={errors.length ? 'danger' : 'warning'}>
                <AlertTriangle /> {errors.length ? `${errors.length} ошиб.` : `${issues.length} замеч.`}
              </Badge>
            )}
          </button>
        </PopoverTrigger>
        {issues.length > 0 && (
          <PopoverContent align="end" className="w-80 space-y-2 p-3 text-[13px]">
            {issues.map((i, k) => (
              <div key={k} className="flex gap-2">
                <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', i.level === 'error' ? 'bg-danger' : 'bg-warning')} />
                {i.message}
              </div>
            ))}
          </PopoverContent>
        )}
      </Popover>
      <Tip content={`${estimate.calls} вызовов моделей. Оценка для запроса ~100 слов; реальная стоимость зависит от длины ответов.`}>
        <span className="hidden font-mono text-xs text-muted lg:inline">
          ≈ {estimate.min == null ? '?' : formatCost(estimate.min)}–{estimate.max == null ? '?' : formatCost(estimate.max)}
        </span>
      </Tip>
      <Tip content="Экспорт в JSON">
        <Button size="icon" variant="ghost" onClick={() => downloadFile(`${pipeline.name}.pipeline.json`, JSON.stringify({ ...pipeline, format: 'hephaestus-pipeline@1' }, null, 2))} aria-label="Экспорт">
          <Download />
        </Button>
      </Tip>
      {runner ? (
        <Button variant="danger" size="sm" onClick={() => stopPipeline(pipeline.id)}>
          <Square className="fill-current" /> Стоп
        </Button>
      ) : null}
    </div>
  )
}

export function PipelineEditor({ id }: { id: string }) {
  const stored = usePipelines((s) => s.pipelines.find((p) => p.id === id))
  const upsert = usePipelines((s) => s.upsert)
  const [local, setLocal] = useState<Pipeline | undefined>(stored)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!local && stored) setLocal(stored)
  }, [stored, local])

  const onChange = useCallback(
    (p: Pipeline) => {
      setLocal(p)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => upsert(p), 350)
    },
    [upsert],
  )

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    [],
  )
  // Сохраняем незаписанные правки при уходе со страницы
  const latest = useRef(local)
  latest.current = local
  useEffect(() => () => void (latest.current && upsert(latest.current)), [upsert])

  if (!local) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
        <History className="size-6" />
        Пайплайн не найден.
        <Link href="/forge" className="text-accent hover:underline">
          Вернуться в Кузницу
        </Link>
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Header pipeline={local} onChange={onChange} />
      <Canvas pipeline={local} onChange={onChange} />
    </ReactFlowProvider>
  )
}

