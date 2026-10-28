'use client'

import { AlertTriangle, ArrowRight, CheckCircle2, Download, Eye, Lightbulb, MoreHorizontal, PanelLeft, Play, RotateCcw, Square, Telescope, Trash2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { FieldRow, Textarea } from '@/components/ui/field'
import { Badge, Segmented, Spinner } from '@/components/ui/misc'
import { Confirm, Menu, MenuContent, MenuItem, MenuTrigger, Sheet, Switch } from '@/components/ui/overlay'
import { UsageLine } from '@/components/usage-line'
import { reportToMarkdown, startScenario, stopScenario } from '@/lib/client/scenario-runner'
import { DOMAINS, HORIZONS, SCENARIO_KINDS, type DomainId, type Horizon, type ScenarioConfig, type ScenarioKind, type StageId, type StageState } from '@/lib/engine/scenario'
import { useScenarios, type ScenarioRun } from '@/lib/stores/scenarios'
import { cn, downloadFile, formatRelative, truncate } from '@/lib/utils'

const KIND_COLOR: Record<ScenarioKind, string> = {
  baseline: 'var(--info)',
  optimistic: 'var(--success)',
  pessimistic: 'var(--danger)',
  wildcard: 'var(--p3)',
}

const EXAMPLES = [
  'Центробанк неожиданно повышает ключевую ставку на 3 п.п.',
  'Крупный облачный провайдер на сутки теряет доступность в Европе',
  'Выходит открытая ИИ-модель уровня лучших коммерческих',
  'Цены на нефть падают на 30% за месяц',
]

function defaultConfig(): ScenarioConfig {
  return { event: '', context: '', domains: ['economy', 'politics', 'tech'], scenarios: ['baseline', 'optimistic', 'pessimistic'], horizon: '3m', analystModel: '@default', synthModel: '@smart', research: true }
}

function Setup({ initial, onStart }: { initial?: ScenarioConfig; onStart: (c: ScenarioConfig) => void }) {
  const [c, setC] = useState<ScenarioConfig>(() => initial ?? defaultConfig())
  const set = (p: Partial<ScenarioConfig>) => setC((x) => ({ ...x, ...p }))
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const calls = (c.research ? 1 : 0) + c.domains.length + 1
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Сценарный анализ</h2>
        <p className="mt-1 text-sm text-muted">Опишите событие — отраслевые ИИ-аналитики разберут его параллельно, а руководитель сведёт выводы в сценарии с вероятностями, последствиями и сигналами, за которыми стоит следить.</p>
      </div>
      <FieldRow label="Событие">
        <Textarea rows={3} autoFocus value={c.event} onChange={(e) => set({ event: e.target.value })} placeholder="Что произошло или может произойти?" />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((t) => (
            <button key={t} onClick={() => set({ event: t })} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-fg">
              {t}
            </button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Контекст" hint="Необязательно: для кого анализ, какие у вас вводные">
        <Textarea rows={2} value={c.context} onChange={(e) => set({ context: e.target.value })} placeholder="Например: мы — интернет-магазин электроники в России" />
      </FieldRow>
      <FieldRow label={`Области анализа · ${c.domains.length}`}>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(Object.entries(DOMAINS) as [DomainId, (typeof DOMAINS)[DomainId]][]).map(([id, d]) => (
            <button key={id} onClick={() => set({ domains: toggle(c.domains, id) })} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px]', c.domains.includes(id) ? 'border-accent bg-accent-soft font-medium' : 'border-border text-muted hover:border-border-strong')}>
              <span>{d.emoji}</span> {d.title}
            </button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Сценарии">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(Object.entries(SCENARIO_KINDS) as [ScenarioKind, (typeof SCENARIO_KINDS)[ScenarioKind]][]).map(([id, k]) => (
            <button key={id} title={k.hint} onClick={() => set({ scenarios: toggle(c.scenarios, id) })} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px]', c.scenarios.includes(id) ? 'border-accent bg-accent-soft font-medium' : 'border-border text-muted hover:border-border-strong')}>
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[id] }} /> {k.title}
            </button>
          ))}
        </div>
      </FieldRow>
      <div className="grid gap-5 rounded-2xl border border-border bg-surface/50 p-4 md:grid-cols-2">
        <FieldRow label="Горизонт">
          <Segmented size="sm" value={c.horizon} onChange={(horizon: Horizon) => set({ horizon })} options={(Object.entries(HORIZONS) as [Horizon, string][]).map(([v, label]) => ({ value: v, label }))} />
        </FieldRow>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            Собрать факты в интернете
            <span className="block text-xs text-muted">Перед анализом найти актуальные данные</span>
          </span>
          <Switch checked={c.research} onCheckedChange={(v) => set({ research: v })} />
        </label>
        <FieldRow label="Модель аналитиков">
          <ModelPicker value={c.analystModel} onChange={(analystModel) => set({ analystModel })} />
        </FieldRow>
        <FieldRow label="Модель для синтеза">
          <ModelPicker value={c.synthModel} onChange={(synthModel) => set({ synthModel })} />
        </FieldRow>
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted">{calls} вызовов моделей</span>
        <Button variant="primary" size="lg" disabled={!c.event.trim() || !c.domains.length || !c.scenarios.length} onClick={() => onStart(c)}>
          <Play className="fill-current" /> Запустить анализ
        </Button>
      </div>
    </div>
  )
}

function StageRow({ label, s }: { label: string; s?: StageState }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      {!s || s.status === 'pending' ? <span className="size-4 rounded-full border-2 border-border" /> : s.status === 'running' ? <Spinner className="size-4 text-accent" /> : s.status === 'done' ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-danger" />}
      <span className={cn(!s && 'text-faint')}>{label}</span>
      {s?.error && <span className="truncate text-xs text-danger">{s.error}</span>}
    </div>
  )
}

function sevColor(sev: number) {
  return `color-mix(in oklch, var(--danger) ${Math.round(sev * 18)}%, transparent)`
}

function Report({ run }: { run: ScenarioRun }) {
  const r = run.report!
  const cfg = run.config
  const [showFacts, setShowFacts] = useState(false)
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Главный вывод</div>
        <h3 className="mt-1 text-xl font-semibold leading-snug tracking-tight">{r.headline}</h3>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{r.summary}</p>
        {r.scenarios.length > 0 && (
          <div className="mt-4">
            <div className="flex h-3 overflow-hidden rounded-full">
              {r.scenarios.map((s) => (
                <div key={s.kind + s.title} style={{ width: `${s.probability}%`, background: KIND_COLOR[s.kind] }} title={`${s.title}: ${s.probability}%`} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {r.scenarios.map((s) => (
                <span key={s.kind + s.title} className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: KIND_COLOR[s.kind] }} />
                  {s.title} <b className="tabular-nums">{s.probability}%</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {r.scenarios.map((s) => (
          <div key={s.kind + s.title} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="h-1" style={{ background: KIND_COLOR[s.kind] }} />
            <div className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: KIND_COLOR[s.kind] }}>
                    {SCENARIO_KINDS[s.kind].title}
                  </div>
                  <div className="font-semibold">{s.title}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-2xl font-semibold tabular-nums">{s.probability}%</div>
                  <div className="text-[10px] uppercase tracking-wider text-faint">вероятность</div>
                </div>
              </div>
              <p className="text-[13.5px] leading-relaxed">{s.narrative}</p>
              {s.triggers.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Условия</div>
                  <ul className="space-y-0.5 text-[13px] text-muted">
                    {s.triggers.map((t) => (
                      <li key={t} className="flex gap-2">
                        <ArrowRight className="mt-1 size-3 shrink-0" /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.timeline.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Хронология</div>
                  <ol className="relative space-y-2 border-l border-border pl-4">
                    {s.timeline.map((t, i) => (
                      <li key={i} className="text-[13px]">
                        <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface" style={{ background: KIND_COLOR[s.kind] }} />
                        <span className="font-medium">{t.when}</span> <span className="text-muted">— {t.what}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {r.scenarios.some((s) => s.impacts.length) && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Карта последствий</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-semibold">Область</th>
                  {r.scenarios.map((s) => (
                    <th key={s.kind + s.title} className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: KIND_COLOR[s.kind] }} /> {SCENARIO_KINDS[s.kind].title}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cfg.domains.map((d) => (
                  <tr key={d} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                      {DOMAINS[d].emoji} {DOMAINS[d].title}
                    </td>
                    {r.scenarios.map((s) => {
                      const im = s.impacts.filter((i) => i.domain === d)
                      const sev = im.length ? Math.max(...im.map((i) => i.severity)) : 0
                      return (
                        <td key={s.kind + s.title} className="px-3 py-2.5" style={{ background: sev ? sevColor(sev) : undefined }}>
                          {im.length ? (
                            <>
                              <div className="mb-0.5 font-mono text-[10.5px] font-semibold">{'●'.repeat(sev)}{'○'.repeat(5 - sev)}</div>
                              {im.map((i) => i.text).join('; ')}
                            </>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {r.indicators.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Eye className="size-4 text-accent" /> Что отслеживать
            </div>
            <div className="space-y-2.5">
              {r.indicators.map((i) => (
                <div key={i.signal} className="text-[13px]">
                  <div className="font-medium">{i.signal}</div>
                  <div className="text-muted">{i.meaning}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {r.recommendations.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Lightbulb className="size-4 text-gold" /> Рекомендации
            </div>
            <ul className="space-y-2 text-[13px]">
              {r.recommendations.map((x) => (
                <li key={x} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> {x}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {r.crossEffects.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 text-[13px] font-semibold">Взаимное влияние областей</div>
          <div className="space-y-2">
            {r.crossEffects.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Badge>{DOMAINS[c.from].emoji} {DOMAINS[c.from].title}</Badge>
                <ArrowRight className="size-3.5 text-faint" />
                <Badge>{DOMAINS[c.to].emoji} {DOMAINS[c.to].title}</Badge>
                <span className="text-muted">{c.effect}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {run.facts && (
        <div className="rounded-2xl border border-border bg-surface">
          <button onClick={() => setShowFacts(!showFacts)} className="w-full px-4 py-3 text-left text-[13px] font-semibold">
            {showFacts ? '▾' : '▸'} Собранные факты
          </button>
          {showFacts && (
            <div className="border-t border-border px-4 py-3">
              <Markdown text={run.facts} className="text-[13px]" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RunView({ run, onRepeat }: { run: ScenarioRun; onRepeat: () => void }) {
  const stages: [StageId, string][] = [...(run.config.research ? [['research', 'Сбор фактов в интернете'] as [StageId, string]] : []), ...run.config.domains.map((d) => [`domain:${d}`, `Аналитик: ${DOMAINS[d].title}`] as [StageId, string]), ['synthesis', 'Синтез сценариев']]
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              Событие · горизонт {HORIZONS[run.config.horizon]}
            </div>
            <h2 className="mt-1 text-xl font-semibold leading-snug">{run.config.event}</h2>
            {run.usage && <UsageLine usage={run.usage} latencyMs={run.finishedAt ? run.finishedAt - run.createdAt : undefined} className="mt-2" />}
          </div>
          <div className="flex gap-2">
            {run.status === 'running' ? (
              <Button size="sm" variant="danger" onClick={() => stopScenario(run.id)}>
                <Square className="fill-current" /> Стоп
              </Button>
            ) : (
              <>
                {run.report && (
                  <Button size="sm" variant="ghost" onClick={() => downloadFile(`${truncate(run.config.event, 40)}.md`, reportToMarkdown(run.config, run.report!, run.facts), 'text/markdown')}>
                    <Download /> Markdown
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={onRepeat}>
                  <RotateCcw /> Изменить и повторить
                </Button>
              </>
            )}
          </div>
        </div>
        {(run.status === 'running' || !run.report) && (
          <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-4">
            {stages.map(([id, label]) => (
              <StageRow key={id} label={label} s={run.stages[id]} />
            ))}
          </div>
        )}
        {run.error && <div className="rounded-xl border border-danger/30 bg-danger/8 p-3 text-sm text-danger">{run.error}</div>}
        {run.report && <Report run={run} />}
        {!run.report && run.raw && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 text-[13px] font-semibold">Ответ модели</div>
            <Markdown text={run.raw} />
          </div>
        )}
      </div>
    </div>
  )
}

export function ScenariosView() {
  const runs = useScenarios((s) => s.runs)
  const remove = useScenarios((s) => s.remove)
  const params = useSearchParams()
  const router = useRouter()
  const id = params.get('s')
  const current = runs.find((r) => r.id === id)
  const [repeat, setRepeat] = useState<ScenarioConfig | undefined>()
  const [listOpen, setListOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const list = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => {
            setRepeat(undefined)
            router.push('/scenarios')
            setListOpen(false)
          }}
        >
          <Telescope /> Новый анализ
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {runs.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-muted">Здесь будут ваши анализы</div>}
        {runs.map((r) => (
          <div key={r.id} className={cn('group flex items-center rounded-lg', r.id === id ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
            <button
              onClick={() => {
                router.push(`/scenarios?s=${r.id}`)
                setListOpen(false)
              }}
              className="min-w-0 flex-1 px-2.5 py-2 text-left"
            >
              <div className="flex items-center gap-1.5">
                {r.status === 'running' && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
                <span className="truncate text-[13px]">{r.config.event}</span>
              </div>
              <div className="text-[11px] text-faint">
                {r.config.domains.map((d) => DOMAINS[d].emoji).join('')} · {formatRelative(r.createdAt)}
              </div>
            </button>
            <Menu>
              <MenuTrigger asChild>
                <button className="mr-1 rounded-md p-1 text-faint opacity-0 hover:bg-surface-3 group-hover:opacity-100" aria-label="Действия">
                  <MoreHorizontal className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem danger onSelect={() => setDeleting(r.id)}>
                  <Trash2 /> Удалить
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface/40 lg:block">{list}</aside>
      <Sheet open={listOpen} onOpenChange={setListOpen} title="Анализы">
        {list}
      </Sheet>
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center border-b border-border px-3 py-1.5 lg:hidden">
          <button onClick={() => setListOpen(true)} className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
            <PanelLeft className="size-4" /> История
          </button>
        </div>
        {current ? (
          <RunView
            key={current.id}
            run={current}
            onRepeat={() => {
              setRepeat(current.config)
              router.push('/scenarios')
            }}
          />
        ) : (
          <div className="forge-glow min-h-0 flex-1 overflow-y-auto">
            <Setup key={repeat ? 'repeat' : 'new'} initial={repeat} onStart={(c) => router.push(`/scenarios?s=${startScenario(c)}`)} />
          </div>
        )}
      </section>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Удалить анализ?"
        onConfirm={() => {
          if (deleting) {
            stopScenario(deleting)
            remove(deleting)
            if (deleting === id) router.push('/scenarios')
          }
        }}
      />
    </div>
  )
}
