import { cn } from '@/lib/utils'

export function PageHeader({ title, subtitle, actions, icon, className, children }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn('shrink-0 border-b border-border bg-bg/80 px-4 py-3.5 backdrop-blur md:px-6', className)}>
      <div className="flex flex-wrap items-center gap-3">
        {icon && <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-[18px]">{icon}</div>}
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
