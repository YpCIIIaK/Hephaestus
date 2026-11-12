'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, Textarea } from '@/components/ui/field'
import { Dialog } from '@/components/ui/overlay'
import type { Pipeline } from '@/lib/engine/pipeline'
import { rawGithubUrl, routineToPipeline } from '@/lib/engine/routine-import'
import { uid } from '@/lib/utils'

/**
 * Импорт порядка действий (runbook в Markdown, например ROUTINE.md) в схему:
 * каждый шаг — блок-агент, правила — общий системный промпт, шаблон отчёта —
 * финальный блок. Источник — ссылка, файл или вставленный текст.
 */
export function RoutineImportDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (p: Pipeline) => void }) {
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [model, setModel] = useState('@default')
  const [reportPath, setReportPath] = useState('reports/routine-report.md')
  const [loading, setLoading] = useState(false)

  const preview = useMemo(() => {
    if (!text.trim()) return null
    try {
      return { pipeline: routineToPipeline(text, { id: 'preview', model, reportPath }) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, model, reportPath])

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(rawGithubUrl(url))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setText(await res.text())
    } catch (e) {
      toast.error('Не удалось загрузить', { description: `${e instanceof Error ? e.message : String(e)}. Скачайте файл и выберите его или вставьте текст` })
    } finally {
      setLoading(false)
    }
  }

  const steps = preview?.pipeline?.nodes.filter((n) => n.kind === 'agent' || n.kind === 'validator') ?? []
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Импорт порядка действий"
      description="Runbook в Markdown (например, ROUTINE.md): каждый шаг станет блоком-агентом с инструментами, правила — общим системным промптом, шаблон отчёта — финальным блоком. Схему можно поправить в редакторе и запускать в чате как участника."
      className="max-w-2xl"
      footer={
        <Button
          variant="primary"
          disabled={!preview?.pipeline}
          onClick={() => {
            onCreate(routineToPipeline(text, { id: uid('pl'), model, reportPath }))
            onOpenChange(false)
            setText('')
          }}
        >
          Создать пайплайн
        </Button>
      }
    >
      <div className="space-y-4">
        <FieldRow label="Ссылка" hint="Ссылка на файл в GitHub или прямая ссылка на .md">
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo/blob/main/ROUTINE.md" />
            <Button disabled={!url.trim() || loading} onClick={() => void load()}>
              Загрузить
            </Button>
          </div>
        </FieldRow>
        <FieldRow label="Текст" hint="Или вставьте Markdown, или выберите файл">
          <div className="space-y-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-mono text-xs" placeholder={'# Название\n\n## Правила\n1. …\n\n## 1. Первый шаг\n…\n\n## 2. Второй шаг\n…\n\n## Отчёт\n…'} />
            <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="text-xs text-muted" onChange={async (e) => e.target.files?.[0] && setText(await e.target.files[0].text())} />
          </div>
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Модель шагов">
            <ModelPicker value={model} onChange={setModel} />
          </FieldRow>
          <FieldRow label="Сохранить отчёт в файл" hint="Путь в рабочей папке; пусто — не сохранять">
            <Input value={reportPath} onChange={(e) => setReportPath(e.target.value)} className="font-mono" />
          </FieldRow>
        </div>
        {preview?.error && <p className="text-[13px] text-danger">{preview.error}</p>}
        {preview?.pipeline && (
          <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-[13px]">
            <div className="mb-1 font-medium">
              {preview.pipeline.name} · {preview.pipeline.description}
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-muted">
              {steps.map((n) => (
                <li key={n.id}>{n.label}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Dialog>
  )
}
