'use client'

import { Handle, NodeToolbar, Position, type NodeProps, type Node } from '@xyflow/react'
import { AlertTriangle, Check, CircleSlash, Copy, Hourglass, Settings2, Trash2 } from 'lucide-react'
import { memo } from 'react'
import { ModelName } from '@/components/model-picker'
import { Spinner } from '@/components/ui/misc'
import { NODE_META, type NodeRun, type PipelineNode } from '@/lib/engine/pipeline'
import { getAgent } from '@/lib/stores/agents'
import { cn, formatCost, formatMs, truncate } from '@/lib/utils'
import { NODE_STYLE } from './node-meta'

export type ForgeNodeData = {
  node: PipelineNode
  run?: NodeRun
  waiting?: boolean
  issue?: 'error' | 'warning'
  /** Кнопки над выбранным блоком — только в редакторе */
  actions?: NodeActions
}

export interface NodeActions {
  edit: (id: string) => void
  duplicate: (id: string) => void
  remove: (id: string) => void
}

export type ForgeFlowNode = Node<ForgeNodeData, 'forge'>

function Subtitle({ node }: { node: PipelineNode }) {
  const c = node.config
  switch (node.kind) {
    case 'agent': {
      const agent = c.agentId ? getAgent(c.agentId) : undefined
      return (
        <span className="flex min-w-0 items-center gap-1">
          {agent && <span>{agent.emoji}</span>}
          <ModelName id={c.model || agent?.model || '@default'} showAliasTarget={false} className="min-w-0" />
          {c.isolate && <span title="Своя копия проекта">· копия</span>}
        </span>
      )
    }
    case 'search':
    case 'knowledge':
      return <span className="truncate font-mono">{truncate(c.query || '{{prev}}', 34)}</span>
    case 'file':
    case 'write':
      return <span className="truncate font-mono">{c.path || 'путь не задан'}</span>
    case 'router':
      return <span>{c.routerMode === 'keyword' ? 'по ключевым словам' : 'по смыслу'}</span>
    case 'validator':
      return <span>{c.checkCommand != null ? <span className="font-mono">$ {truncate(c.checkCommand, 28)}</span> : `до ${c.maxAttempts ?? 2} доработок`}</span>
    case 'command':
      return <span className="truncate font-mono">$ {truncate(c.command || 'команда не задана', 32)}</span>
    case 'foreach': {
      const agent = c.agentId ? getAgent(c.agentId) : undefined
      return (
        <span className="flex min-w-0 items-center gap-1">
          ×{c.concurrency ?? 3} · <ModelName id={c.model || agent?.model || '@default'} showAliasTarget={false} className="min-w-0" />
        </span>
      )
    }
    default:
      return <span>{NODE_META[node.kind].hint}</span>
  }
}

function StatusIcon({ run, waiting }: { run?: NodeRun; waiting?: boolean }) {
  if (waiting) return <Hourglass className="size-3.5 text-warning" />
  if (!run || run.status === 'idle') return null
  if (run.status === 'running') return <Spinner className="size-3.5 text-accent" />
  if (run.status === 'done') return <Check className="size-3.5 text-success" />
  if (run.status === 'skipped') return <CircleSlash className="size-3.5 text-faint" />
  return <AlertTriangle className="size-3.5 text-danger" />
}

export const ForgeNodeView = memo(function ForgeNodeView({ data, selected }: NodeProps<ForgeFlowNode>) {
  const { node, run, waiting, issue, actions } = data
  const style = NODE_STYLE[node.kind]
  const Icon = style.icon
  const routes = node.kind === 'router' ? node.config.routes ?? [] : []
  const status = run?.status
  return (
    <div
      className={cn(
        'group relative w-[230px] rounded-xl border bg-surface shadow-soft transition-[border,box-shadow,opacity]',
        selected ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-border hover:border-border-strong',
        status === 'running' && 'pulse-ring border-accent',
        status === 'skipped' && 'opacity-50',
        status === 'error' && 'border-danger/60',
        waiting && 'border-warning',
      )}
    >
      {actions && (
        <NodeToolbar isVisible={selected} position={Position.Top} offset={8} className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-float">
          <button type="button" onClick={() => actions.edit(node.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] hover:bg-surface-2">
            <Settings2 className="size-3.5" /> Настроить
          </button>
          <button type="button" onClick={() => actions.duplicate(node.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] hover:bg-surface-2">
            <Copy className="size-3.5" /> Дублировать
          </button>
          <button type="button" onClick={() => actions.remove(node.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-danger hover:bg-danger/10">
            <Trash2 className="size-3.5" /> Удалить
          </button>
        </NodeToolbar>
      )}
      {node.kind !== 'input' && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2.5 px-3 pt-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in oklch, ${style.color} 16%, transparent)`, color: style.color }}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{node.label}</div>
          <div className="truncate text-[10.5px] uppercase tracking-wider text-faint">{NODE_META[node.kind].title}</div>
        </div>
        <StatusIcon run={run} waiting={waiting} />
        {issue && !run && <span className={cn('size-2 rounded-full', issue === 'error' ? 'bg-danger' : 'bg-warning')} />}
      </div>
      <div className="flex min-w-0 px-3 pb-2.5 pt-1.5 text-[11.5px] text-muted">
        <Subtitle node={node} />
      </div>
      {run && (run.status === 'done' || run.status === 'error' || run.status === 'running') && (
        <div className="border-t border-border px-3 py-1.5">
          {run.items && run.items.total > 0 && (
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-faint">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span className={cn('block h-full rounded-full transition-[width] duration-500', run.items.failed ? 'bg-warning' : 'bg-accent')} style={{ width: `${(run.items.done / run.items.total) * 100}%` }} />
              </span>
              {run.items.done}/{run.items.total}
            </div>
          )}
          {run.status === 'error' ? (
            <div className="line-clamp-2 text-[11px] text-danger">{run.error}</div>
          ) : (
            <div className="line-clamp-2 text-[11px] leading-snug text-muted">{run.note ? `${run.note} · ` : ''}{truncate((run.output ?? '').replace(/\s+/g, ' '), 140) || '…'}</div>
          )}
          {(run.usage || (run.startedAt && run.endedAt)) && (
            <div className="mt-1 flex gap-2 font-mono text-[10px] text-faint">
              {run.startedAt && run.endedAt && <span>{formatMs(run.endedAt - run.startedAt)}</span>}
              {run.usage && <span>{formatCost(run.usage.cost)}</span>}
            </div>
          )}
        </div>
      )}
      {routes.length > 0 ? (
        <div className="border-t border-border py-1">
          {routes.map((r) => (
            <div key={r.id} className={cn('relative flex items-center justify-end px-3 py-1 text-[11px]', run?.route === r.id ? 'font-semibold text-accent' : 'text-muted')}>
              {r.label}
              <Handle id={r.id} type="source" position={Position.Right} style={{ top: '50%' }} />
            </div>
          ))}
        </div>
      ) : (
        node.kind !== 'output' && <Handle type="source" position={Position.Right} />
      )}
    </div>
  )
})
