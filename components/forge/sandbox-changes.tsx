'use client'

import { Check, FileDiff, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { api } from '@/lib/client/llm'

interface ChangedFile {
  path: string
  status: string
  additions?: number
  deletions?: number
}

/**
 * Изменения, которые блок Кузницы сделал в своей копии проекта: список файлов,
 * diff и кнопки «Применить к проекту» / «Удалить копию». Оригинал не меняется,
 * пока изменения не приняты.
 */
export function SandboxChanges({ id }: { id: string }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [patch, setPatch] = useState<string | null>(null)
  const [state, setState] = useState<'open' | 'applied' | 'removed'>('open')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<{ files: ChangedFile[] }>(`/api/sandboxes?id=${id}`)
      .then((d) => alive && setFiles(d.files))
      .catch(() => alive && setState('removed'))
    return () => {
      alive = false
    }
  }, [id])

  const apply = async () => {
    setBusy(true)
    try {
      const r = await api<{ applied: string[]; conflicts: string[] }>('/api/sandboxes', { method: 'POST', json: { action: 'apply', id } })
      setState('applied')
      if (r.conflicts.length) toast.warning(`Применено ${r.applied.length}, конфликтов ${r.conflicts.length}`, { description: `Эти файлы изменились в проекте после создания копии: ${r.conflicts.join(', ')}` })
      else toast.success(`Применено к проекту: ${r.applied.length} файлов`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    await api(`/api/sandboxes?id=${id}`, { method: 'DELETE' }).catch(() => {})
    setState('removed')
    setBusy(false)
  }

  const showDiff = async () => {
    if (patch != null) return setPatch(null)
    const d = await api<{ patch: string; truncated: boolean }>(`/api/sandboxes?id=${id}&patch=1`).catch(() => null)
    setPatch(d ? d.patch + (d.truncated ? '\n…[diff обрезан]' : '') : 'Не удалось получить diff')
  }

  if (state === 'removed') return <div className="rounded-xl border border-border p-3 text-xs text-muted">Копия проекта удалена</div>
  return (
    <div className="space-y-2 rounded-xl border border-accent/30 bg-accent-soft/30 p-3 text-[13px]">
      <div className="flex items-center gap-2 font-medium">
        <FileDiff className="size-4 text-accent" /> Изменения в копии проекта
        {state === 'applied' && <span className="text-xs font-normal text-success">применены</span>}
      </div>
      {files == null ? (
        <Spinner className="size-4" />
      ) : files.length === 0 ? (
        <div className="text-xs text-muted">Файлы не менялись</div>
      ) : (
        <>
          <ul className="space-y-0.5 font-mono text-xs">
            {files.map((f) => (
              <li key={f.path}>
                <span className="text-muted">{f.status}</span> {f.path}
                {f.additions != null && (
                  <span className="text-faint">
                    {' '}
                    +{f.additions} −{f.deletions ?? 0}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => void showDiff()}>
              {patch != null ? 'Скрыть diff' : 'Показать diff'}
            </Button>
            {state === 'open' && (
              <>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void apply()}>
                  <Check /> Применить к проекту
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
                  <Trash2 /> Удалить копию
                </Button>
              </>
            )}
          </div>
          {patch != null && <pre className="max-h-80 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] leading-relaxed">{patch}</pre>}
        </>
      )}
    </div>
  )
}
