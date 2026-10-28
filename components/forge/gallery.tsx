'use client'

import { CheckCircle2, Copy, Download, MoreHorizontal, Plus, Trash2, Upload, Workflow, AlertTriangle, CircleSlash } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, SectionTitle, Spinner } from '@/components/ui/misc'
import { Confirm, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlay'
import { validatePipeline, type Pipeline } from '@/lib/engine/pipeline'
import { blankPipeline, PIPELINE_TEMPLATES } from '@/lib/engine/templates'
import { usePipelines } from '@/lib/stores/pipelines'
import { downloadFile, formatCost, formatMs, formatRelative, plural, uid } from '@/lib/utils'
import { GraphPreview } from './graph-preview'

function cloneAsNew(p: Pipeline, name?: string): Pipeline {
  const now = new Date().toISOString()
  return { ...structuredClone(p), id: uid('pl'), name: name ?? p.name, createdAt: now, updatedAt: now }
}

export function ForgeGallery() {
  const pipelines = usePipelines((s) => s.pipelines)
  const runs = usePipelines((s) => s.runs)
  const upsert = usePipelines((s) => s.upsert)
  const remove = usePipelines((s) => s.remove)
  const router = useRouter()
  const params = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const [deleting, setDeleting] = useState<Pipeline | null>(null)

  const create = (p: Pipeline) => {
    upsert(p)
    router.push(`/forge/${p.id}`)
  }

  useEffect(() => {
    if (params.get('new')) create(blankPipeline(uid('pl')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Partial<Pipeline>
      if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('В файле нет узлов и связей')
      const p = cloneAsNew({ ...blankPipeline('x'), ...data } as Pipeline)
      if (validatePipeline(p).some((i) => i.message.startsWith('Цикл'))) throw new Error('В графе есть цикл')
      create(p)
      toast.success('Пайплайн импортирован')
    } catch (e) {
      toast.error('Не удалось импортировать', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const lastRun = (id: string) => runs.find((r) => r.pipelineId === id)

  return (
    <>
      <PageHeader
        icon={<Workflow />}
        title="Кузница"
        subtitle="Соберите конвейер из агентов, поиска, проверок и маршрутов — и запускайте его как одну модель"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload /> Импорт
            </Button>
            <Button variant="primary" onClick={() => create(blankPipeline(uid('pl')))}>
              <Plus /> Новый пайплайн
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-10 px-4 py-6 md:px-6">
          <section className="space-y-3">
            <SectionTitle>Мои пайплайны</SectionTitle>
            {pipelines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border-strong">
                <EmptyState icon={<Workflow />} title="Пока пусто" action={<Button variant="primary" onClick={() => create(cloneAsNew(PIPELINE_TEMPLATES[0]))}>Начать с «{PIPELINE_TEMPLATES[0].name}»</Button>}>
                  Пайплайн — это граф: вход проходит через агентов и инструменты, а на выходе получается результат. Начните с шаблона ниже или с чистого листа.
                </EmptyState>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pipelines.map((p) => {
                  const r = lastRun(p.id)
                  return (
                    <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft transition-[border,transform] hover:-translate-y-0.5 hover:border-border-strong">
                      <Link href={`/forge/${p.id}`} className="block">
                        <div className="grid-dots h-32 border-b border-border bg-surface-2/50 p-3">
                          <GraphPreview pipeline={p} className="h-full w-full" />
                        </div>
                        <div className="space-y-1 p-4">
                          <div className="flex items-center gap-2 pr-8">
                            <span className="text-lg">{p.emoji}</span>
                            <span className="truncate font-semibold">{p.name}</span>
                          </div>
                          <div className="line-clamp-2 min-h-10 text-[13px] text-muted">{p.description || `${p.nodes.length} ${plural(p.nodes.length, ['узел', 'узла', 'узлов'])}, ${p.edges.length} ${plural(p.edges.length, ['связь', 'связи', 'связей'])}`}</div>
                          <div className="flex items-center gap-2 pt-1 text-xs text-faint">
                            {r ? (
                              <>
                                {r.status === 'running' ? <Spinner className="size-3" /> : r.status === 'done' ? <CheckCircle2 className="size-3.5 text-success" /> : r.status === 'error' ? <AlertTriangle className="size-3.5 text-danger" /> : <CircleSlash className="size-3.5" />}
                                запуск {formatRelative(r.startedAt)}
                                {r.endedAt && <span>· {formatMs(r.endedAt - r.startedAt)}</span>}
                                <span>· {formatCost(r.usage.cost)}</span>
                              </>
                            ) : (
                              <>изменён {formatRelative(p.updatedAt)}</>
                            )}
                          </div>
                        </div>
                      </Link>
                      <div className="absolute right-2 top-[8.6rem]">
                        <Menu>
                          <MenuTrigger asChild>
                            <button className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Действия">
                              <MoreHorizontal className="size-4" />
                            </button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => create(cloneAsNew(p, `${p.name} (копия)`))}>
                              <Copy /> Дублировать
                            </MenuItem>
                            <MenuItem onSelect={() => downloadFile(`${p.name}.pipeline.json`, JSON.stringify({ ...p, format: 'hephaestus-pipeline@1' }, null, 2))}>
                              <Download /> Экспорт JSON
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem danger onSelect={() => setDeleting(p)}>
                              <Trash2 /> Удалить
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle>Шаблоны</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PIPELINE_TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => create(cloneAsNew(t))} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface/60 text-left transition-colors hover:border-accent/50 hover:bg-surface">
                  <div className="h-24 border-b border-border bg-surface-2/40 p-3 opacity-80 transition-opacity group-hover:opacity-100">
                    <GraphPreview pipeline={t} className="h-full w-full" />
                  </div>
                  <div className="space-y-1 p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{t.emoji}</span>
                      <span className="font-semibold">{t.name}</span>
                      <Badge className="ml-auto">{t.nodes.length} узлов</Badge>
                    </div>
                    <p className="text-[13px] leading-snug text-muted">{t.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
      <Confirm open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Удалить «${deleting?.name}»?`} description="Пайплайн и история его запусков будут удалены." onConfirm={() => deleting && remove(deleting.id)} />
    </>
  )
}
