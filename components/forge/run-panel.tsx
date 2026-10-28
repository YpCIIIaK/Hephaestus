'use client'

import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Footprints, History, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CopyButton, Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { Badge, Spinner } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger, Switch } from '@/components/ui/overlay'
import { UsageLine } from '@/components/usage-line'
import { usePipelineRunner } from '@/lib/client/pipeline-runner'
import type { Pipeline, PipelineRun } from '@/lib/engine/pipeline'
import { usePipelines } from '@/lib/stores/pipelines'
import { cn, formatMs, formatRelative } from '@/lib/utils'
import { NODE_STYLE } from './node-meta'

const inputs = new Map<string, string>()

function RunStatus({ run }: { run: PipelineRun }) {
  const map = {
    running: <Badge tone="accent"><Spinner className="size-3" /> идёт</Badge>,
    done: <Badge tone="success"><CheckCircle2 /> готово</Badge>,
    error: <Badge tone="danger"><AlertTriangle /> ошибка</Badge>,
    aborted: <Badge><CircleSlash /> остановлен</Badge>,
  }
  return map[run.status]
}

export function RunPanel({ pipeline, run, onRun, onSelectRun, onSelectNode }: { pipeline: Pipeline; run?: PipelineRun; onRun: (input: string, step: boolean) => void; onSelectRun: (id: string) => void; onSelectNode: (id: string) => void }) {
  const [input, setInput] = useState(() => inputs.get(pipeline.id) ?? run?.input ?? '')
  const [step, setStep] = useState(false)
  const active = usePipelineRunner((s) => s.active[pipeline.id])
  const runs = usePipelines((s) => s.runs)
  const history = useMemo(() => runs.filter((r) => r.pipelineId === pipeline.id), [runs, pipeline.id])
  const finished = run && run.status !== 'running'
  const done = run ? Object.values(run.nodes).filter((n) => n.status === 'done' || n.status === 'skipped' || n.status === 'error').length : 0

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold">Запуск</div>
          {history.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                  <History className="size-3.5" /> История · {history.length}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-80 w-80 overflow-y-auto p-1.5">
                {history.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      onSelectRun(r.id)
                      setInput(r.input)
                    }}
                    className={cn('flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2', r.id === run?.id && 'bg-surface-2')}
                  >
                    <div className="flex items-center gap-2">
                      <RunStatus run={r} />
                      <span className="text-xs text-faint">{formatRelative(r.startedAt)}</span>
                    </div>
                    <div className="truncate text-[13px]">{r.input || '(пустой вход)'}</div>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
        <Textarea
          rows={4}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            inputs.set(pipeline.id, e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !active) onRun(input, step)
          }}
          placeholder="Вход пайплайна — {{input}}"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <Switch checked={step} onCheckedChange={setStep} />
            <Footprints className="size-3.5" /> Пошагово
          </label>
          <Button variant="primary" className="ml-auto" disabled={!!active} onClick={() => onRun(input, step)}>
            {active ? <Spinner /> : <Play className="fill-current" />} {active ? 'Выполняется' : 'Запустить'}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!run ? (
          <div className="p-6 text-center text-sm leading-relaxed text-muted">Введите запрос и запустите пайплайн. Узлы будут подсвечиваться по мере выполнения, а результат появится здесь.</div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <RunStatus run={run} />
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-faint">
                <Clock className="size-3" />
                {formatMs((run.endedAt ?? Date.now()) - run.startedAt)}
              </span>
              {run.status === 'running' && (
                <span className="text-xs text-muted">
                  {done}/{pipeline.nodes.length} узлов
                </span>
              )}
            </div>
            {finished && <UsageLine usage={run.usage} />}
            {run.error && <div className="rounded-lg border border-warning/30 bg-warning/8 p-2.5 text-[13px]">{run.error}</div>}
            {run.output && (
              <div className="rounded-xl border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Результат</span>
                  <CopyButton text={run.output} />
                </div>
                <div className="p-3">
                  <Markdown text={run.output} className="text-[13.5px]" />
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Узлы</div>
              <div className="space-y-0.5">
                {pipeline.nodes.map((n) => {
                  const nr = run.nodes[n.id]
                  const s = NODE_STYLE[n.kind]
                  const Icon = s.icon
                  return (
                    <button key={n.id} onClick={() => onSelectNode(n.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                      <Icon className="size-3.5" style={{ color: s.color }} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{n.label}</span>
                      {nr?.status === 'running' && <Spinner className="size-3 text-accent" />}
                      {nr?.status === 'done' && <span className="font-mono text-[10.5px] text-faint">{nr.startedAt && nr.endedAt ? formatMs(nr.endedAt - nr.startedAt) : ''}</span>}
                      {nr?.status === 'error' && <AlertTriangle className="size-3.5 text-danger" />}
                      {nr?.status === 'skipped' && <CircleSlash className="size-3.5 text-faint" />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
