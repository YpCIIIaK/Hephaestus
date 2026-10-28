'use client'

import { AlertTriangle, ChartColumn, CheckCircle2, Download, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ModelName } from '@/components/model-picker'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, Meter, Segmented } from '@/components/ui/misc'
import { Confirm, Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/overlay'
import type { UsageSource } from '@/lib/engine/llm'
import { useSettings } from '@/lib/stores/settings'
import { spentSince, startOfDay, startOfMonth, useUsage, type UsageEvent } from '@/lib/stores/usage'
import { dayKey, downloadFile, formatCost, formatMs, formatTokens } from '@/lib/utils'

const SOURCES: { id: UsageSource; label: string; color: string }[] = [
  { id: 'chat', label: 'Чат', color: 'var(--chart-1)' },
  { id: 'pipeline', label: 'Пайплайны', color: 'var(--chart-2)' },
  { id: 'debate', label: 'Дебаты', color: 'var(--chart-3)' },
  { id: 'scenario', label: 'Сценарии', color: 'var(--chart-4)' },
  { id: 'judge', label: 'Судья', color: 'var(--chart-5)' },
  { id: 'system', label: 'Служебное', color: 'var(--chart-6)' },
]
const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.id, s.label])) as Record<UsageSource, string>

type Period = '7' | '30' | '90' | 'all'

function Kpi({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
      {children}
    </Card>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-float">
      <div className="mb-1 font-medium">{label}</div>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.name} className="flex items-center gap-2 py-0.5">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted">{p.name}</span>
            <span className="ml-auto font-mono tabular-nums">{formatCost(p.value)}</span>
          </div>
        ))}
      <div className="mt-1 flex border-t border-border pt-1 font-medium">
        Всего <span className="ml-auto font-mono tabular-nums">{formatCost(total)}</span>
      </div>
    </div>
  )
}

function toCsv(events: UsageEvent[]): string {
  const head = 'time,source,label,model,prompt_tokens,completion_tokens,cost_usd,latency_ms,ok,error'
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [head, ...events.map((e) => [new Date(e.ts).toISOString(), e.source, esc(e.label), e.model, e.promptTokens, e.completionTokens, e.cost ?? '', Math.round(e.latencyMs), e.ok, esc(e.error)].join(','))].join('\n')
}

export function AnalyticsView() {
  const events = useUsage((s) => s.events)
  const clear = useUsage((s) => s.clear)
  const limits = useSettings((s) => s.limits)
  const [period, setPeriod] = useState<Period>('30')
  const [clearing, setClearing] = useState(false)

  const since = period === 'all' ? 0 : startOfDay() - (Number(period) - 1) * 86_400_000
  const list = useMemo(() => events.filter((e) => e.ts >= since), [events, since])

  const stats = useMemo(() => {
    let cost = 0
    let prompt = 0
    let completion = 0
    let errors = 0
    let latency = 0
    let unknownCost = 0
    for (const e of list) {
      cost += e.cost ?? 0
      if (e.cost == null && e.ok) unknownCost++
      prompt += e.promptTokens
      completion += e.completionTokens
      if (!e.ok) errors++
      latency += e.latencyMs
    }
    return { cost, prompt, completion, errors, avgLatency: list.length ? latency / list.length : 0, unknownCost }
  }, [list])

  const daily = useMemo(() => {
    const days = period === 'all' ? Math.max(1, Math.ceil((Date.now() - (list[0]?.ts ?? Date.now())) / 86_400_000) + 1) : Number(period)
    const rows: Record<string, number | string>[] = []
    const index = new Map<string, Record<string, number | string>>()
    for (let i = days - 1; i >= 0; i--) {
      const t = startOfDay() - i * 86_400_000
      const row: Record<string, number | string> = { day: new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) }
      for (const s of SOURCES) row[s.id] = 0
      rows.push(row)
      index.set(dayKey(t), row)
    }
    for (const e of list) {
      const row = index.get(dayKey(e.ts))
      if (row) row[e.source] = (row[e.source] as number) + (e.cost ?? 0)
    }
    return rows
  }, [list, period])

  const byModel = useMemo(() => {
    const m = new Map<string, { model: string; cost: number; tokens: number; calls: number; errors: number; latency: number }>()
    for (const e of list) {
      const r = m.get(e.model) ?? { model: e.model, cost: 0, tokens: 0, calls: 0, errors: 0, latency: 0 }
      r.cost += e.cost ?? 0
      r.tokens += e.promptTokens + e.completionTokens
      r.calls++
      r.latency += e.latencyMs
      if (!e.ok) r.errors++
      m.set(e.model, r)
    }
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  }, [list])

  const bySource = useMemo(() => SOURCES.map((s) => ({ ...s, cost: list.filter((e) => e.source === s.id).reduce((a, e) => a + (e.cost ?? 0), 0), calls: list.filter((e) => e.source === s.id).length })).filter((s) => s.calls), [list])

  const today = spentSince(events, startOfDay())
  const month = spentSince(events, startOfMonth())
  const maxModelCost = Math.max(...byModel.map((m) => m.cost), 1e-9)
  const maxSourceCost = Math.max(...bySource.map((m) => m.cost), 1e-9)
  const usedSources = SOURCES.filter((s) => bySource.some((b) => b.id === s.id))

  return (
    <>
      <PageHeader
        icon={<ChartColumn />}
        title="Аналитика"
        subtitle="Сколько стоят ваши модели, пайплайны и дебаты — по данным провайдера"
        actions={
          <>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: '7', label: '7 дней' },
                { value: '30', label: '30 дней' },
                { value: '90', label: '90 дней' },
                { value: 'all', label: 'Всё' },
              ]}
            />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Экспорт и очистка">
                  <Download />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => downloadFile('hephaestus-usage.csv', toCsv(list), 'text/csv')}>
                  <Download /> Экспорт CSV
                </MenuItem>
                <MenuItem onSelect={() => downloadFile('hephaestus-usage.json', JSON.stringify(list, null, 2))}>
                  <Download /> Экспорт JSON
                </MenuItem>
                <MenuItem danger onSelect={() => setClearing(true)}>
                  <Trash2 /> Очистить историю
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Сегодня" value={formatCost(today)} hint={limits.dailyUsd ? `лимит $${limits.dailyUsd}` : 'без лимита'}>
              {limits.dailyUsd > 0 && <Meter value={today} max={limits.dailyUsd} className="mt-2.5" />}
            </Kpi>
            <Kpi label="Этот месяц" value={formatCost(month)} hint={limits.monthlyUsd ? `лимит $${limits.monthlyUsd}` : 'без лимита'}>
              {limits.monthlyUsd > 0 && <Meter value={month} max={limits.monthlyUsd} className="mt-2.5" />}
            </Kpi>
            <Kpi label="Токены за период" value={formatTokens(stats.prompt + stats.completion)} hint={`вход ${formatTokens(stats.prompt)} · выход ${formatTokens(stats.completion)}`} />
            <Kpi label="Запросы" value={String(list.length)} hint={`${stats.errors ? `${((stats.errors / list.length) * 100).toFixed(1)}% ошибок · ` : ''}ср. ${formatMs(stats.avgLatency)}`} />
          </div>

          {list.length === 0 ? (
            <Card>
              <EmptyState icon={<ChartColumn />} title="Пока нечего показать" action={<Link href="/chat" className="text-sm font-medium text-accent hover:underline">Перейти в чат →</Link>}>
                Здесь появятся расходы и токены по каждому вызову модели: из чата, пайплайнов, дебатов и сценариев.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-semibold">Расходы по дням</div>
                    <div className="text-xs text-muted">
                      За период {formatCost(stats.cost)}
                      {stats.unknownCost > 0 && ` · у ${stats.unknownCost} вызовов цена неизвестна`}
                    </div>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} tickFormatter={(v: number) => (v === 0 ? '0' : `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`)} width={56} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                      <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
                      {usedSources.map((s, i) => (
                        <Bar key={s.id} dataKey={s.id} name={s.label} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={1} radius={i === usedSources.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
                <Card className="overflow-hidden">
                  <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">По моделям</div>
                  <div className="divide-y divide-border">
                    {byModel.slice(0, 12).map((m) => (
                      <div key={m.model} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-2.5">
                        <ModelName id={m.model} className="text-[13px]" />
                        <span className="font-mono text-[13px] font-semibold tabular-nums">{formatCost(m.cost)}</span>
                        <div className="h-1.5 self-center overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${(m.cost / maxModelCost) * 100}%` }} />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-faint">
                          {m.calls} выз. · {formatTokens(m.tokens)} ток. · {formatMs(m.latency / m.calls)}
                          {m.errors ? ` · ${m.errors} ош.` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card className="overflow-hidden">
                  <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">По разделам</div>
                  <div className="space-y-3 p-4">
                    {bySource.map((s) => (
                      <div key={s.id}>
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                          {s.label}
                          <span className="ml-auto font-mono tabular-nums">{formatCost(s.cost)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full" style={{ width: `${(s.cost / maxSourceCost) * 100}%`, background: s.color }} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-faint">{s.calls} вызовов</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Последние вызовы</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[12.5px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-semibold">Время</th>
                        <th className="px-3 py-2 font-semibold">Где</th>
                        <th className="px-3 py-2 font-semibold">Модель</th>
                        <th className="px-3 py-2 text-right font-semibold">Токены</th>
                        <th className="px-3 py-2 text-right font-semibold">Цена</th>
                        <th className="px-3 py-2 text-right font-semibold">Время ответа</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {list
                        .slice(-60)
                        .reverse()
                        .map((e) => (
                          <Fragment key={e.id}>
                            <tr className="border-t border-border">
                              <td className="whitespace-nowrap px-4 py-2 font-mono text-faint">{new Date(e.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="max-w-48 truncate px-3 py-2">
                                {SOURCE_LABEL[e.source]}
                                {e.label && <span className="text-faint"> · {e.label}</span>}
                              </td>
                              <td className="max-w-56 px-3 py-2">
                                <ModelName id={e.model} />
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTokens(e.promptTokens + e.completionTokens)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCost(e.cost)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMs(e.latencyMs)}</td>
                              <td className="px-4 py-2" title={e.error}>
                                {e.ok ? <CheckCircle2 className="size-3.5 text-success" aria-label="Успешно" /> : <AlertTriangle className="size-3.5 text-danger" aria-label={e.error} />}
                              </td>
                            </tr>
                            {!e.ok && e.error && (
                              <tr>
                                <td colSpan={7} className="px-4 pb-2 text-xs text-danger">
                                  {e.error}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
      <Confirm open={clearing} onOpenChange={setClearing} title="Очистить историю расходов?" description="Удалятся все записи о вызовах. Лимиты расходов начнут считаться с нуля." confirmLabel="Очистить" onConfirm={clear} />
    </>
  )
}
