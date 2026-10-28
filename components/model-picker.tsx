'use client'

import { Check, ChevronDown, Cpu, RefreshCw, Search, Sparkles, Star, Wrench } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { Segmented, Spinner } from '@/components/ui/misc'
import { ALIAS_LABELS, isAlias, shortModelName, vendorLabel } from '@/lib/models'
import { useCatalog, useResolvedModel } from '@/lib/stores/catalog'
import { useSettings } from '@/lib/stores/settings'
import type { ModelAlias, ModelInfo } from '@/lib/types'
import { cn, formatPricePerM, formatTokens } from '@/lib/utils'

export function ModelName({ id, className, showAliasTarget = true }: { id: string; className?: string; showAliasTarget?: boolean }) {
  const { id: real, info } = useResolvedModel(id)
  if (isAlias(id)) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
        <Sparkles className="size-3.5 shrink-0 text-accent" />
        <span className="truncate">{ALIAS_LABELS[id as ModelAlias].title}</span>
        {showAliasTarget && <span className="truncate text-faint">· {real ? shortModelName(info, real) : 'не выбрана'}</span>}
      </span>
    )
  }
  return <span className={cn('truncate', className)}>{shortModelName(info, id)}</span>
}

type Filter = 'all' | 'fav' | 'local' | 'free'

function priceLine(m: ModelInfo) {
  if (m.provider === 'ollama') return 'локально · бесплатно'
  if (!m.pricing) return 'цена неизвестна'
  if (m.pricing.prompt === 0 && m.pricing.completion === 0) return 'бесплатно'
  return `${formatPricePerM(m.pricing.prompt)} / ${formatPricePerM(m.pricing.completion)} за 1M`
}

function ModelRow({ m, selected, fav, onPick, onFav }: { m: ModelInfo; selected: boolean; fav: boolean; onPick: () => void; onFav: () => void }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => e.key === 'Enter' && onPick()}
      className={cn('group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 outline-none hover:bg-surface-2 focus-visible:bg-surface-2', selected && 'bg-accent-soft hover:bg-accent-soft')}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm">{shortModelName(m)}</span>
          {m.supportsTools && <Wrench className="size-3 shrink-0 text-faint" aria-label="Поддерживает инструменты" />}
          {m.provider === 'ollama' && <Cpu className="size-3 shrink-0 text-faint" aria-label="Локальная" />}
        </div>
        <div className="truncate font-mono text-[10.5px] text-faint">
          {priceLine(m)}
          {m.contextLength ? ` · ${formatTokens(m.contextLength)} контекст` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onFav()
        }}
        className={cn('rounded p-1 text-faint hover:text-gold', fav ? 'text-gold' : 'opacity-0 group-hover:opacity-100')}
        aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
      >
        <Star className={cn('size-3.5', fav && 'fill-current')} />
      </button>
      {selected && <Check className="size-4 shrink-0 text-accent" />}
    </div>
  )
}

export function ModelList({ value, onPick, allowAliases = true, multi }: { value: string[]; onPick: (id: string) => void; allowAliases?: boolean; multi?: boolean }) {
  const models = useCatalog((s) => s.models)
  const loading = useCatalog((s) => s.loading)
  const errors = useCatalog((s) => s.errors)
  const refresh = useCatalog((s) => s.refresh)
  const favorites = useSettings((s) => s.favorites)
  const toggleFavorite = useSettings((s) => s.toggleFavorite)
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim().toLowerCase())
  const [filter, setFilter] = useState<Filter>(favorites.length ? 'fav' : 'all')

  const filtered = useMemo(() => {
    let list = models
    if (filter === 'fav') list = list.filter((m) => favorites.includes(m.id))
    if (filter === 'local') list = list.filter((m) => m.provider !== 'openrouter')
    if (filter === 'free') list = list.filter((m) => m.provider === 'ollama' || (m.pricing && m.pricing.prompt === 0 && m.pricing.completion === 0))
    if (q) list = list.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q))
    const groups = new Map<string, ModelInfo[]>()
    for (const m of list.slice(0, 400)) {
      const g = m.provider === 'openrouter' ? vendorLabel(m.vendor) : vendorLabel(m.provider)
      groups.set(g, [...(groups.get(g) ?? []), m])
    }
    return Array.from(groups.entries())
  }, [models, filter, favorites, q])

  const custom = q && !models.some((m) => m.id.toLowerCase() === q) && /^[\w.-]+\/[\w.:@-]+$/.test(query.trim()) ? query.trim() : null

  return (
    <div className="flex max-h-[min(70vh,520px)] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-4 text-faint" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск модели или ID…" className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
        <button onClick={() => refresh(true)} className="rounded p-1 text-faint hover:text-fg" aria-label="Обновить каталог" title="Обновить каталог">
          {loading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
        </button>
      </div>
      <div className="border-b border-border px-3 py-2">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Все · ${models.length}` },
            { value: 'fav', label: `Избранные · ${favorites.length}` },
            { value: 'local', label: 'Локальные' },
            { value: 'free', label: 'Бесплатные' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-multiselectable={multi}>
        {allowAliases && !q && (
          <div className="mb-1">
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Роли — подставляется модель из настроек</div>
            {(Object.keys(ALIAS_LABELS) as ModelAlias[]).map((a) => (
              <div
                key={a}
                role="option"
                aria-selected={value.includes(a)}
                tabIndex={0}
                onClick={() => onPick(a)}
                onKeyDown={(e) => e.key === 'Enter' && onPick(a)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-2', value.includes(a) && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <div className="min-w-0 flex-1">
                  <ModelName id={a} className="text-sm" />
                  <div className="truncate text-[11px] text-faint">{ALIAS_LABELS[a].hint}</div>
                </div>
                {value.includes(a) && <Check className="size-4 text-accent" />}
              </div>
            ))}
          </div>
        )}
        {custom && (
          <button onClick={() => onPick(custom)} className="mb-1 w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2">
            Использовать ID <span className="font-mono text-accent">{custom}</span>
          </button>
        )}
        {filtered.map(([group, list]) => (
          <div key={group} className="mb-1">
            <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{group}</div>
            {list.map((m) => (
              <ModelRow key={m.id} m={m} selected={value.includes(m.id)} fav={favorites.includes(m.id)} onPick={() => onPick(m.id)} onFav={() => toggleFavorite(m.id)} />
            ))}
          </div>
        ))}
        {!filtered.length && (
          <div className="px-3 py-8 text-center text-sm text-muted">
            {models.length === 0 ? (errors[0] ? `Каталог не загрузился: ${errors[0]}` : 'Каталог пуст — проверьте подключение в настройках') : filter === 'fav' ? 'В избранном пусто: отмечайте модели звёздочкой' : 'Ничего не найдено'}
          </div>
        )}
      </div>
    </div>
  )
}

export function ModelPicker({ value, onChange, allowAliases = true, className, placeholder = 'Выбрать модель', size = 'md', align = 'start' }: { value: string; onChange: (id: string) => void; allowAliases?: boolean; className?: string; placeholder?: string; size?: 'sm' | 'md'; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left text-sm hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40 outline-none',
            size === 'sm' ? 'h-8' : 'h-9',
            className,
          )}
        >
          {value ? <ModelName id={value} className="min-w-0 flex-1" /> : <span className="flex-1 text-faint">{placeholder}</span>}
          <ChevronDown className="size-4 shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(420px,calc(100vw-2rem))] p-0">
        <ModelList
          value={value ? [value] : []}
          allowAliases={allowAliases}
          onPick={(id) => {
            onChange(id)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
