'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { AlertTriangle, Check, CircleSlash, Hourglass } from 'lucide-react'
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
      return <span>до {c.maxAttempts ?? 2} доработок</span>
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
  const { node, run, waiting, issue } = data
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
