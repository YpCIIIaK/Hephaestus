'use client'

import { BookOpenText, ChevronRight, ClipboardPaste, File, FilePlus, Folder, FolderTree, Library, RefreshCw, Save, Search, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, Textarea } from '@/components/ui/field'
import { Badge, EmptyState, Segmented, Spinner } from '@/components/ui/misc'
import { Confirm, Dialog, Tip } from '@/components/ui/overlay'
import { api } from '@/lib/client/llm'
import { useCatalog } from '@/lib/stores/catalog'
import type { KnowledgeDoc, KnowledgeHit, WorkspaceEntry } from '@/lib/types'
import { cn, formatRelative, formatTokens } from '@/lib/utils'

const SOURCE_LABEL: Record<KnowledgeDoc['source'], string> = { workspace: 'workspace', upload: 'файл', text: 'текст' }

function KnowledgeTab() {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState({ title: '', text: '' })
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api<{ docs: KnowledgeDoc[] }>('/api/knowledge')
      .then((d) => setDocs(d.docs))
      .catch((e) => toast.error(e.message))
  }, [])
  useEffect(load, [load])

  const upload = async (files: FileList) => {
    setBusy(true)
    let ok = 0
    for (const f of Array.from(files)) {
      try {
        if (f.size > 5_000_000) throw new Error('файл больше 5 МБ')
        const text = await f.text()
        await api('/api/knowledge', { method: 'POST', json: { title: f.name, text, source: 'upload' } })
        ok++
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(false)
    if (ok) toast.success(`Проиндексировано документов: ${ok}`)
    load()
  }

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      setHits((await api<{ hits: KnowledgeHit[] }>('/api/knowledge/search', { method: 'POST', json: { query } })).hits)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  const totalTokens = docs?.reduce((s, d) => s + d.tokens, 0) ?? 0

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <div className="font-semibold">Документы</div>
            {docs && (
              <div className="text-xs text-muted">
                {docs.length} док. · {docs.reduce((s, d) => s + d.chunks, 0)} фрагментов · ≈{formatTokens(totalTokens)} токенов
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" multiple hidden accept=".txt,.md,.markdown,.csv,.json,.html,.xml,.yaml,.yml,.log,.py,.js,.ts,.tsx,.go,.rs,.java,.c,.cpp,.sql" onChange={(e) => e.target.files && upload(e.target.files)} />
          <Button variant="ghost" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste /> Вставить текст
          </Button>
          <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Upload />} Загрузить файлы
          </Button>
        </div>
        {!docs ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong">
            <EmptyState icon={<Library />} title="База знаний пуста">
              Загрузите заметки, документацию или выгрузки — модели с инструментом «База знаний» и узлы пайплайнов найдут в них нужные фрагменты. Поиск работает локально, без эмбеддингов и платных API.
            </EmptyState>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <BookOpenText className="size-4 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{d.title}</div>
                  <div className="text-xs text-faint">
                    {d.chunks} фрагм. · ≈{formatTokens(d.tokens)} ток. · {formatRelative(d.indexedAt)}
                  </div>
                </div>
                <Badge>{SOURCE_LABEL[d.source]}</Badge>
                <Button size="icon-sm" variant="ghost" className="hover:text-danger" onClick={() => setDeleting(d)} aria-label="Удалить">
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="font-semibold">Проверить поиск</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            search()
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Что ищем в документах?" />
          <Button type="submit" disabled={searching || !query.trim()}>
            {searching ? <Spinner /> : <Search />} Найти
          </Button>
        </form>
        {hits && hits.length === 0 && <div className="py-6 text-center text-sm text-muted">Ничего не найдено</div>}
        <div className="space-y-2">
          {hits?.map((h, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs">
                <span className="font-medium">{h.title}</span>
                <span className="text-faint">
                  строки {h.startLine}–{h.endLine}
                </span>
                <span className="ml-auto font-mono text-faint">{h.score.toFixed(2)}</span>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-muted">{h.text}</pre>
            </div>
          ))}
        </div>
      </section>

      <Dialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Добавить текст"
        className="max-w-2xl"
        footer={
          <Button
            variant="primary"
            disabled={!paste.title.trim() || !paste.text.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api('/api/knowledge', { method: 'POST', json: { ...paste, source: 'text' } })
                setPaste({ title: '', text: '' })
                setPasteOpen(false)
                load()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Проиндексировать
          </Button>
        }
      >
        <div className="space-y-3">
          <Input value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} placeholder="Название документа" />
          <Textarea rows={12} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder="Текст документа" />
        </div>
      </Dialog>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Убрать «${deleting?.title}» из базы?`}
        description="Исходный файл не удаляется — только индекс."
        confirmLabel="Убрать"
        onConfirm={async () => {
          if (!deleting) return
          await api(`/api/knowledge?id=${deleting.id}`, { method: 'DELETE' }).catch((e) => toast.error(e.message))
          load()
        }}
      />
    </div>
  )
}

function Tree({ items, selected, onSelect, depth = 0 }: { items: WorkspaceEntry[]; selected: string | null; onSelect: (p: string) => void; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <div>
      {items.map((it) =>
        it.type === 'dir' ? (
          <div key={it.path}>
            <button onClick={() => setOpen({ ...open, [it.path]: !open[it.path] })} className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] hover:bg-surface-2" style={{ paddingLeft: depth * 14 + 6 }}>
              <ChevronRight className={cn('size-3.5 text-faint transition-transform', open[it.path] && 'rotate-90')} />
              <Folder className="size-3.5 text-gold" />
              {it.name}
            </button>
            {open[it.path] && it.children && <Tree items={it.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
          </div>
        ) : (
          <button key={it.path} onClick={() => onSelect(it.path)} className={cn('flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px]', selected === it.path ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2')} style={{ paddingLeft: depth * 14 + 25 }}>
            <File className="size-3.5 shrink-0 text-faint" />
            <span className="truncate">{it.name}</span>
          </button>
        ),
      )}
    </div>
  )
}

function WorkspaceTab() {
  const status = useCatalog((s) => s.status)
  const [tree, setTree] = useState<WorkspaceEntry[] | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    api<{ tree: WorkspaceEntry[] }>('/api/workspace')
      .then((d) => setTree(d.tree))
      .catch((e) => toast.error(e.message))
  }, [])
  useEffect(load, [load])

  const open = async (p: string) => {
    try {
      const d = await api<{ content: string }>(`/api/workspace?path=${encodeURIComponent(p)}`)
      setPath(p)
      setContent(d.content)
      setOriginal(d.content)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const save = async (p = path, c = content) => {
    if (!p) return
    try {
      await api('/api/workspace', { method: 'PUT', json: { path: p, content: c } })
      setOriginal(c)
      toast.success('Сохранено')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const dirty = content !== original

  return (
    <div className="grid min-h-[560px] gap-4 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col rounded-2xl border border-border bg-surface">
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          <span className="mr-auto font-mono text-xs text-muted">{status?.workspace ?? 'workspace'}/</span>
          <Tip content="Новый файл">
            <Button size="icon-sm" variant="ghost" onClick={() => setNewOpen(true)} aria-label="Новый файл">
              <FilePlus />
            </Button>
          </Tip>
          <Tip content="Обновить">
            <Button size="icon-sm" variant="ghost" onClick={load} aria-label="Обновить">
              <RefreshCw />
            </Button>
          </Tip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {!tree ? <Spinner className="m-3" /> : tree.length === 0 ? <div className="p-4 text-center text-[13px] text-muted">Папка пуста. Здесь появятся файлы, которые создадут агенты.</div> : <Tree items={tree} selected={path} onSelect={open} />}
        </div>
      </div>
      <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface">
        {path ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{path}</span>
              {dirty && <Badge tone="warning">не сохранено</Badge>}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await api('/api/knowledge', { method: 'POST', json: { path } })
                    toast.success('Добавлено в базу знаний')
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                <Library /> В базу знаний
              </Button>
              <Button size="icon-sm" variant="ghost" className="hover:text-danger" onClick={() => setDeleting(true)} aria-label="Удалить файл">
                <Trash2 />
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty} onClick={() => save()}>
                <Save /> Сохранить
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault()
                  save()
                }
              }}
              spellCheck={false}
              className="min-h-[480px] flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed outline-none"
            />
          </>
        ) : (
          <EmptyState icon={<FolderTree />} title="Песочница для файлов" className="my-auto">
            Это папка <code className="font-mono">workspace/</code> — единственное место, где модели с инструментами «Чтение/Запись файлов» могут работать с файлами. Выберите файл слева или создайте новый.
          </EmptyState>
        )}
      </div>
      <Dialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Новый файл"
        className="max-w-md"
        footer={
          <Button
            variant="primary"
            disabled={!newPath.trim()}
            onClick={async () => {
              await save(newPath.trim(), '')
              setNewOpen(false)
              open(newPath.trim())
              setNewPath('')
            }}
          >
            Создать
          </Button>
        }
      >
        <FieldRow label="Путь" hint="Папки создадутся автоматически">
          <Input autoFocus value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="notes/идеи.md" className="font-mono" />
        </FieldRow>
      </Dialog>
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={`Удалить ${path}?`}
        onConfirm={async () => {
          if (!path) return
          await api(`/api/workspace?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).catch((e) => toast.error(e.message))
          setPath(null)
          load()
        }}
      />
    </div>
  )
}

export function KnowledgeView() {
  const [tab, setTab] = useState<'kb' | 'files'>('kb')
  return (
    <>
      <PageHeader
        icon={<Library />}
        title="Знания и файлы"
        subtitle="Документы для поиска и рабочая папка, в которой агенты создают файлы"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'kb', label: <><BookOpenText /> База знаний</> },
              { value: 'files', label: <><FolderTree /> Workspace</> },
            ]}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{tab === 'kb' ? <KnowledgeTab /> : <WorkspaceTab />}</div>
      </div>
    </>
  )
}
