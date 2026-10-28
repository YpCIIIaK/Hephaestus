'use client'

import { BookOpenText, CheckCircle2, FilePen, FileText, Globe, Puzzle, XCircle, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { ALL_TOOLSETS, TOOL_LABELS, TOOLSET_INFO } from '@/lib/tool-labels'
import type { ToolsetId, ToolTrace } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Spinner } from './ui/misc'
import { Tip } from './ui/overlay'

export const TOOLSET_ICONS: Record<ToolsetId, LucideIcon> = {
  web: Globe,
  knowledge: BookOpenText,
  files_read: FileText,
  files_write: FilePen,
  skills: Puzzle,
}

export function ToolsetToggles({ value, onChange, compact, className }: { value: ToolsetId[]; onChange: (v: ToolsetId[]) => void; compact?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {ALL_TOOLSETS.map((t) => {
        const Icon = TOOLSET_ICONS[t]
        const on = value.includes(t)
        return (
          <Tip key={t} content={TOOLSET_INFO[t].hint}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors [&_svg]:size-3.5',
                compact ? 'h-7 px-2' : 'h-8 px-2.5',
                on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-muted hover:border-border-strong hover:text-fg',
              )}
            >
              <Icon />
              {TOOLSET_INFO[t].label}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}

function argsPreview(args: string): string {
  try {
    const a = JSON.parse(args) as Record<string, unknown>
    const v = a.query ?? a.url ?? a.path ?? a.skill
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

export function ToolTraceList({ tools }: { tools: ToolTrace[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!tools.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((t) => (
        <div key={t.id} className="max-w-full">
          <button
            type="button"
            onClick={() => setOpen(open === t.id ? null : t.id)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11.5px] text-muted hover:text-fg"
          >
            {t.ok === undefined ? <Spinner className="size-3" /> : t.ok ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-danger" />}
            <span className="font-medium text-fg">{TOOL_LABELS[t.name] ?? t.name}</span>
            {argsPreview(t.args) && <span className="truncate">{argsPreview(t.args)}</span>}
          </button>
          {open === t.id && t.preview && <pre className="mt-1 max-h-48 max-w-[min(36rem,80vw)] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-2 font-mono text-[11px] text-muted">{t.preview}</pre>}
        </div>
      ))}
    </div>
  )
}
