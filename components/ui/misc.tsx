import * as React from 'react'
import { cn } from '@/lib/utils'

export function Badge({ className, tone = 'neutral', ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted border-border',
    accent: 'bg-accent-soft text-accent border-accent/25',
    success: 'bg-success/10 text-success border-success/25',
    warning: 'bg-warning/12 text-warning border-warning/25',
    danger: 'bg-danger/10 text-danger border-danger/25',
    info: 'bg-info/10 text-info border-info/25',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap [&_svg]:size-3', tones[tone], className)} {...props} />
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[10px] text-muted', className)} {...props} />
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-label="Загрузка" className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70', className)} />
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-soft', className)} {...props} />
}

export function EmptyState({ icon, title, children, action, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-14 gap-3', className)}>
      {icon && <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent [&_svg]:size-6">{icon}</div>}
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted leading-relaxed">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-lg border border-border bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors [&_svg]:size-3.5',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
            value === o.value ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h3>
      {action}
    </div>
  )
}

export function Dot({ color, className, pulse }: { color: string; className?: string; pulse?: boolean }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', pulse && 'pulse-ring', className)} style={{ background: color }} />
}

export function Meter({ value, max, className, tone }: { value: number; max: number; className?: string; tone?: 'accent' | 'warning' | 'danger' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const t = tone ?? (pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'accent')
  const colors = { accent: 'bg-accent', warning: 'bg-warning', danger: 'bg-danger' }
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', colors[t])} style={{ width: `${pct}%` }} />
    </div>
  )
}
