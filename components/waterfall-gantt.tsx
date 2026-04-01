'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PipelineStep } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Clock, AlertTriangle, CheckCircle2, Loader2, SkipForward } from 'lucide-react'

interface WaterfallGanttProps {
  pipelineSteps?: PipelineStep[]
  className?: string
}

const typeColors: Record<string, string> = {
  model: 'bg-emerald-500',
  prompt: 'bg-blue-500',
  validator: 'bg-orange-500',
  aggregator: 'bg-purple-500',
  search: 'bg-cyan-500',
  file: 'bg-slate-500',
  router: 'bg-pink-500',
}

const typeLabels: Record<string, string> = {
  model: 'Model',
  prompt: 'Prompt',
  validator: 'Validator',
  aggregator: 'Aggregator',
  search: 'Search',
  file: 'File',
  router: 'Router',
}

const statusIcons: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  running: <Loader2 className="w-4 h-4 text-primary animate-spin" />,
  error: <AlertTriangle className="w-4 h-4 text-destructive" />,
  skipped: <SkipForward className="w-4 h-4 text-muted-foreground" />,
  idle: <div className="w-4 h-4 rounded-full border-2 border-border" />,
}

export function WaterfallGantt({ pipelineSteps, className }: WaterfallGanttProps) {
  const { nodes, totalDuration, minTime } = useMemo(() => {
    if (!pipelineSteps || pipelineSteps.length === 0) {
      return { nodes: [], totalDuration: 0, minTime: 0 }
    }

    // Find time range
    const validSteps = pipelineSteps.filter(
      (s): s is PipelineStep & { startTime: number; endTime: number } =>
        typeof s.startTime === 'number' && typeof s.endTime === 'number'
    )

    if (validSteps.length === 0) {
      return { nodes: [], totalDuration: 0, minTime: 0 }
    }

    const minTime = Math.min(...validSteps.map(s => s.startTime))
    const maxTime = Math.max(...validSteps.map(s => s.endTime))
    const totalDuration = maxTime - minTime

    // Calculate positions and widths
    const nodes = validSteps.map(step => {
      const startOffset = step.startTime - minTime
      const duration = step.endTime - step.startTime
      const leftPercent = (startOffset / totalDuration) * 100
      const widthPercent = (duration / totalDuration) * 100

      return {
        ...step,
        leftPercent,
        widthPercent,
        duration,
      }
    })

    // Sort by start time
    nodes.sort((a, b) => a.startTime - b.startTime)

    return { nodes, totalDuration, minTime }
  }, [pipelineSteps])

  if (!pipelineSteps || pipelineSteps.length === 0) {
    return (
      <Card className={cn('border-border/50 bg-card/50', className)}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-400" /> Pipeline Waterfall
          </CardTitle>
          <CardDescription>Visualize execution timeline and identify bottlenecks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Clock className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm">No pipeline execution data available</p>
            <p className="text-xs mt-1">Run a pipeline in Chat mode to see the waterfall diagram</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (nodes.length === 0) {
    return (
      <Card className={cn('border-border/50 bg-card/50', className)}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-400" /> Pipeline Waterfall
          </CardTitle>
          <CardDescription>Visualize execution timeline and identify bottlenecks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-12 h-12 mb-4 opacity-20 animate-spin" />
            <p className="text-sm">Pipeline is running...</p>
            <p className="text-xs mt-1">Timing data will appear when nodes complete</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Group nodes by type for the legend
  const nodesByType = useMemo(() => {
    const grouped: Record<string, typeof nodes> = {}
    nodes.forEach(node => {
      const type = node.type || 'unknown'
      if (!grouped[type]) grouped[type] = []
      grouped[type].push(node)
    })
    return grouped
  }, [nodes])

  // Calculate critical path (longest chain)
  const criticalPathNodes = useMemo(() => {
    // Simple approach: nodes with longest duration are potential bottlenecks
    const sortedByDuration = [...nodes].sort((a, b) => b.duration - a.duration)
    const top3 = sortedByDuration.slice(0, 3)
    return new Set(top3.map(n => n.nodeId))
  }, [nodes])

  return (
    <Card className={cn('border-border/50 bg-card/50', className)}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-400" /> Pipeline Waterfall
        </CardTitle>
        <CardDescription>
          Total duration: {(totalDuration / 1000).toFixed(2)}s • {nodes.length} nodes executed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(nodesByType).map(([type, typeNodes]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className={cn('w-3 h-3 rounded-sm', typeColors[type] || 'bg-gray-500')} />
              <span className="text-muted-foreground">
                {typeLabels[type] || type} ({typeNodes.length})
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-3 h-3 rounded-sm bg-amber-500/50 border border-amber-500" />
            <span className="text-muted-foreground">Bottleneck</span>
          </div>
        </div>

        {/* Gantt Chart */}
        <div className="relative">
          {/* Timeline header */}
          <div className="flex justify-between text-xs text-muted-foreground mb-2 px-2">
            <span>0s</span>
            <span>{((totalDuration / 1000) * 0.25).toFixed(2)}s</span>
            <span>{((totalDuration / 1000) * 0.5).toFixed(2)}s</span>
            <span>{((totalDuration / 1000) * 0.75).toFixed(2)}s</span>
            <span>{(totalDuration / 1000).toFixed(2)}s</span>
          </div>

          {/* Grid lines */}
          <div className="absolute inset-0 flex justify-between pointer-events-none px-2 pt-6">
            {[0, 25, 50, 75, 100].map((percent) => (
              <div
                key={percent}
                className="h-full w-px bg-border/30"
                style={{ marginLeft: percent === 0 ? '0' : undefined }}
              />
            ))}
          </div>

          {/* Node bars */}
          <div className="space-y-2 relative">
            {nodes.map((node) => {
              const isBottleneck = criticalPathNodes.has(node.nodeId)
              const colorClass = typeColors[node.type] || 'bg-gray-500'

              return (
                <div key={node.nodeId} className="flex items-center gap-3 group">
                  {/* Node label */}
                  <div className="w-40 shrink-0 text-xs truncate text-right pr-2">
                    <div className="font-medium text-foreground truncate">{node.label}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {(node.duration / 1000).toFixed(2)}s
                    </div>
                  </div>

                  {/* Bar container */}
                  <div className="flex-1 h-8 relative bg-secondary/30 rounded-sm overflow-hidden">
                    {/* The bar */}
                    <div
                      className={cn(
                        'absolute h-full rounded-sm transition-all duration-300',
                        colorClass,
                        node.status === 'running' && 'animate-pulse',
                        node.status === 'error' && 'bg-destructive',
                        node.status === 'skipped' && 'bg-muted-foreground/30',
                        isBottleneck && 'ring-2 ring-amber-500/50'
                      )}
                      style={{
                        left: `${node.leftPercent}%`,
                        width: `${Math.max(node.widthPercent, 0.5)}%`,
                      }}
                    >
                      {/* Tooltip on hover */}
                      <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-900 text-white text-[10px] rounded whitespace-nowrap z-10 pointer-events-none transition-opacity">
                        {node.label}: {(node.duration / 1000).toFixed(2)}s
                        {isBottleneck && ' (bottleneck)'}
                      </div>
                    </div>
                  </div>

                  {/* Status icon */}
                  <div className="w-6 shrink-0 flex justify-center">
                    {statusIcons[node.status] || statusIcons.idle}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bottleneck analysis */}
        {criticalPathNodes.size > 0 && (
          <div className="pt-4 border-t border-border/50">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Potential Bottlenecks
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {nodes
                .filter((n) => criticalPathNodes.has(n.nodeId))
                .map((node) => (
                  <div
                    key={node.nodeId}
                    className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={cn('w-2 h-2 rounded-full', typeColors[node.type])} />
                      <span className="text-sm font-medium truncate">{node.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(node.duration / 1000).toFixed(2)}s • {node.tokens || 0} tokens
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border/50">
          <div className="text-center">
            <div className="text-2xl font-bold">{nodes.length}</div>
            <div className="text-xs text-muted-foreground">Nodes</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {(Math.max(...nodes.map((n) => n.duration)) / 1000).toFixed(2)}s
            </div>
            <div className="text-xs text-muted-foreground">Slowest Node</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {(nodes.reduce((acc, n) => acc + n.duration, 0) / nodes.length / 1000).toFixed(2)}s
            </div>
            <div className="text-xs text-muted-foreground">Average</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
