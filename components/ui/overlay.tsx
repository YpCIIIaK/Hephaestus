'use client'

import { Dialog as D, DropdownMenu as DM, Popover as P, Tooltip as T, Switch as S, Slider as SL } from 'radix-ui'
import { X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

// ─── Диалог ──────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  trigger,
}: {
  open?: boolean
  onOpenChange?: (v: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  trigger?: React.ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-surface shadow-float outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>}
            </div>
            <D.Close className="-mr-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Закрыть">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Боковая панель (на мобильных — вместо колонок) */
export function Sheet({ open, onOpenChange, side = 'left', children, title, className }: { open: boolean; onOpenChange: (v: boolean) => void; side?: 'left' | 'right'; children: React.ReactNode; title: string; className?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <D.Content
          className={cn(
            'fixed inset-y-0 z-50 flex w-[min(22rem,88vw)] flex-col border-border bg-surface shadow-float outline-none data-[state=open]:animate-in data-[state=closed]:animate-out',
            side === 'left' ? 'left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left' : 'right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
            className,
          )}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export function Confirm({ open, onOpenChange, title, description, confirmLabel = 'Удалить', onConfirm, danger = true }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; onConfirm: () => void; danger?: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="max-w-sm"
      footer={
        <>
          <button className="h-9 rounded-lg px-3.5 text-sm text-muted hover:bg-surface-2 hover:text-fg" onClick={() => onOpenChange(false)}>
            Отмена
          </button>
          <button
            autoFocus
            className={cn('h-9 rounded-lg px-3.5 text-sm font-medium', danger ? 'bg-danger text-white hover:opacity-90' : 'bg-accent text-accent-fg hover:bg-accent-hover')}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  )
}

// ─── Меню ────────────────────────────────────────────────────────────────

export const Menu = DM.Root
export const MenuTrigger = DM.Trigger

export function MenuContent({ className, align = 'end', ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)}
        {...props}
      />
    </DM.Portal>
  )
}

export function MenuItem({ className, danger, ...props }: React.ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted',
        danger && 'text-danger [&_svg]:text-danger data-[highlighted]:bg-danger/10',
        className,
      )}
      {...props}
    />
  )
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <DM.Label className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{children}</DM.Label>

// ─── Поповер ─────────────────────────────────────────────────────────────

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverAnchor = P.Anchor

export function PopoverContent({ className, align = 'start', ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn('z-50 rounded-xl border border-border bg-surface shadow-float outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)}
        {...props}
      />
    </P.Portal>
  )
}

// ─── Подсказка ───────────────────────────────────────────────────────────

export const TooltipProvider = T.Provider

export function Tip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  if (!content) return <>{children}</>
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-float data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

// ─── Переключатель и слайдер ─────────────────────────────────────────────

export function Switch({ checked, onCheckedChange, className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-surface-3 transition-colors data-[state=checked]:bg-accent', className)}
      {...props}
    >
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[17px]" />
    </S.Root>
  )
}

export function Slider({ className, ...props }: React.ComponentProps<typeof SL.Root>) {
  return (
    <SL.Root className={cn('relative flex h-5 w-full touch-none select-none items-center', className)} {...props}>
      <SL.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
        <SL.Range className="absolute h-full bg-accent" />
      </SL.Track>
      <SL.Thumb className="block size-4 rounded-full border-2 border-accent bg-surface shadow focus-visible:ring-3 focus-visible:ring-ring/50 outline-none" aria-label="Значение" />
    </SL.Root>
  )
}
