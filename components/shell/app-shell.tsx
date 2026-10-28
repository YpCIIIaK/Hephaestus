'use client'

import { Menu as MenuIcon, Moon, Search, Sun } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Kbd, Meter, Spinner } from '@/components/ui/misc'
import { Sheet, Tip } from '@/components/ui/overlay'
import { useCatalog } from '@/lib/stores/catalog'
import { useHydrated } from '@/lib/stores/hydration'
import { useSettings } from '@/lib/stores/settings'
import { useSpend } from '@/lib/stores/usage'
import { cn, formatCost } from '@/lib/utils'
import { CommandPalette, useCommandPalette } from './command-palette'
import { NAV, SETTINGS_NAV, type NavItem } from './nav'
import { SetupBanner } from './setup-banner'

export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icon.svg" alt="" className={cn('size-9 rounded-[11px] shadow-[0_2px_12px_oklch(0.7_0.17_50/0.35)]', className)} />
  )
}

function useBootstrap() {
  const refresh = useCatalog((s) => s.refresh)
  const loadStatus = useCatalog((s) => s.loadStatus)
  const fetchedAt = useCatalog((s) => s.fetchedAt)
  const hydrated = useHydrated()
  useEffect(() => {
    if (!hydrated) return
    loadStatus()
    if (!fetchedAt || Date.now() - fetchedAt > 6 * 3600_000) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Tip content={<span><b>{item.label}</b> — {item.hint}</span>} side="right">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-medium transition-colors',
          active ? 'text-fg' : 'text-faint hover:text-fg',
        )}
      >
        <span
          className={cn(
            'flex h-8 w-11 items-center justify-center rounded-lg transition-colors [&_svg]:size-[19px]',
            active ? 'bg-accent-soft text-accent' : 'group-hover:bg-surface-2',
          )}
        >
          <Icon strokeWidth={active ? 2.2 : 1.8} />
        </span>
        {item.label}
        {active && <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />}
      </Link>
    </Tip>
  )
}

function SpendWidget({ compact }: { compact?: boolean }) {
  const { today } = useSpend()
  const daily = useSettings((s) => s.limits.dailyUsd)
  return (
    <Tip content={`Сегодня потрачено ${formatCost(today)}${daily ? ` из лимита $${daily}` : ''}`} side="right">
      <Link href="/analytics" className={cn('flex w-full flex-col items-center gap-1.5 rounded-xl px-2 py-2 hover:bg-surface-2', compact && 'flex-row px-3')}>
        <span className="font-mono text-[11px] tabular-nums text-muted">{formatCost(today)}</span>
        {daily > 0 && <Meter value={today} max={daily} className="h-1 w-10" />}
      </Link>
    </Tip>
  )
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <Tip content={dark ? 'Светлая тема' : 'Тёмная тема'} side="right">
      <button onClick={() => setTheme(dark ? 'light' : 'dark')} className="flex size-9 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-fg" aria-label="Сменить тему">
        {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </button>
    </Tip>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hydrated = useHydrated()
  const palette = useCommandPalette()
  const [mobileOpen, setMobileOpen] = useState(false)
  useBootstrap()
  useEffect(() => setMobileOpen(false), [pathname])

  const current = [...NAV, SETTINGS_NAV].find((n) => isActive(pathname, n.href))

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Рейка навигации */}
      <aside className="hidden w-[76px] shrink-0 flex-col items-center border-r border-border bg-surface/60 py-3 md:flex">
        <Link href="/chat" className="mb-3" aria-label="Hephaestus">
          <BrandMark />
        </Link>
        <Tip content={<span>Командная палитра <Kbd className="ml-1 border-white/20 bg-transparent text-bg/70">Ctrl K</Kbd></span>} side="right">
          <button onClick={() => palette.setOpen(true)} className="mb-2 flex size-9 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-fg" aria-label="Поиск и команды">
            <Search className="size-[18px]" />
          </button>
        </Tip>
        <nav className="flex w-full flex-1 flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <RailLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </nav>
        <div className="flex w-full flex-col items-center gap-1 px-2">
          <SpendWidget />
          <ThemeButton />
          <RailLink item={SETTINGS_NAV} active={isActive(pathname, SETTINGS_NAV.href)} />
        </div>
      </aside>

      {/* Мобильная шапка */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/70 px-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="flex size-9 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Меню">
            <MenuIcon className="size-5" />
          </button>
          <BrandMark className="size-7 rounded-lg" />
          <span className="font-semibold">{current?.label ?? 'Hephaestus'}</span>
          <button onClick={() => palette.setOpen(true)} className="ml-auto flex size-9 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Поиск">
            <Search className="size-[18px]" />
          </button>
        </header>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen} title="Навигация">
          <div className="flex items-center gap-3 border-b border-border p-4">
            <BrandMark />
            <div>
              <div className="font-semibold">Hephaestus</div>
              <div className="text-xs text-muted">Кузница ИИ-агентов</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
            {[...NAV, SETTINGS_NAV].map((item) => {
              const Icon = item.icon
              const active = isActive(pathname, item.href)
              return (
                <Link key={item.href} href={item.href} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5', active ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2')}>
                  <Icon className="size-5" />
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className={cn('text-xs', active ? 'text-accent/80' : 'text-muted')}>{item.hint}</div>
                  </div>
                </Link>
              )
            })}
          </nav>
          <div className="flex items-center justify-between border-t border-border p-3">
            <SpendWidget compact />
            <ThemeButton />
          </div>
        </Sheet>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {hydrated ? (
            <>
              <SetupBanner />
              {children}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center gap-3 text-sm text-muted">
              <Spinner /> Разжигаем горн…
            </div>
          )}
        </main>
      </div>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  )
}
