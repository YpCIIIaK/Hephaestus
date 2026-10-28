'use client'

import { ArrowUp, Paperclip, Wrench, X } from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolsetToggles } from '@/components/tool-chips'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger, Tip } from '@/components/ui/overlay'
import { useSettings } from '@/lib/stores/settings'
import { estimateTokens } from '@/lib/tokens'
import type { ToolsetId } from '@/lib/types'
import { cn, formatTokens } from '@/lib/utils'
import { StopButton } from './turn-view'

export interface ComposerHandle {
  setText: (t: string) => void
  focus: () => void
}

const MAX_FILE = 400_000

export const Composer = forwardRef<
  ComposerHandle,
  {
    onSend: (text: string, files: { name: string; content: string }[]) => void
    onStop: () => void
    running: boolean
    tools: ToolsetId[]
    onToolsChange: (t: ToolsetId[]) => void
    placeholder?: string
    disabled?: boolean
  }
>(function Composer({ onSend, onStop, running, tools, onToolsChange, placeholder, disabled }, ref) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ name: string; content: string }[]>([])
  const [dragging, setDragging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sendOnEnter = useSettings((s) => s.sendOnEnter)

  useImperativeHandle(ref, () => ({
    setText: (t) => {
      setText(t)
      requestAnimationFrame(() => {
        taRef.current?.focus()
        autosize()
      })
    },
    focus: () => taRef.current?.focus(),
  }))

  const autosize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }

  const addFiles = async (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) {
        toast.error(`${f.name}: файл больше 400 КБ`)
        continue
      }
      const content = await f.text()
      if (/[\u0000-\u0008]/.test(content.slice(0, 2000))) {
        toast.error(`${f.name}: похоже, это не текстовый файл`)
        continue
      }
      setFiles((prev) => [...prev.filter((p) => p.name !== f.name), { name: f.name, content }])
    }
  }

  const submit = () => {
    const t = text.trim()
    if ((!t && !files.length) || running || disabled) return
    onSend(t || 'Посмотри приложенные файлы.', files)
    setText('')
    setFiles([])
    requestAnimationFrame(autosize)
  }

  const tokens = estimateTokens(text) + files.reduce((s, f) => s + estimateTokens(f.content), 0)

  return (
    <div
      className={cn('relative rounded-2xl border border-border bg-surface shadow-soft transition-[border,box-shadow] focus-within:border-accent/50 focus-within:shadow-[0_0_0_4px_var(--accent-soft)]', dragging && 'border-accent')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {files.map((f) => (
            <span key={f.name} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 py-1 pl-2 pr-1 text-xs">
              {f.name}
              <span className="text-faint">{formatTokens(estimateTokens(f.content))} ток.</span>
              <button onClick={() => setFiles(files.filter((x) => x !== f))} className="rounded p-0.5 text-faint hover:text-fg" aria-label={`Убрать ${f.name}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        value={text}
        rows={1}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          autosize()
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault()
            addFiles(e.clipboardData.files)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={placeholder ?? 'Спросите что-нибудь…'}
        className="block max-h-80 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <Tip content="Приложить текстовые файлы">
          <button onClick={() => fileRef.current?.click()} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Приложить файл">
            <Paperclip className="size-4" />
          </button>
        </Tip>
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium hover:bg-surface-2', tools.length ? 'text-accent' : 'text-muted hover:text-fg')}>
              <Wrench className="size-4" />
              {tools.length ? `Инструменты · ${tools.length}` : 'Инструменты'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" side="top">
            <div className="mb-2 text-[13px] font-medium">Что модели можно использовать</div>
            <ToolsetToggles value={tools} onChange={onToolsChange} />
            <p className="mt-2.5 text-xs leading-relaxed text-muted">У агентов есть свои инструменты — эти добавляются к ним. Модель сама решает, когда их вызвать.</p>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex items-center gap-2">
          {tokens > 0 && <span className="hidden font-mono text-[11px] text-faint sm:inline">≈{formatTokens(tokens)} ток.</span>}
          <span className="hidden text-[11px] text-faint lg:inline-flex lg:items-center lg:gap-1">
            <Kbd>{sendOnEnter ? 'Enter' : 'Ctrl Enter'}</Kbd> отправить
          </span>
          {running ? (
            <StopButton onClick={onStop} />
          ) : (
            <Button variant="primary" size="icon" onClick={submit} disabled={disabled || (!text.trim() && !files.length)} className="size-9 rounded-xl" aria-label="Отправить">
              <ArrowUp className="size-[18px]" />
            </Button>
          )}
        </div>
      </div>
      {dragging && <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-accent-soft text-sm font-medium text-accent">Отпустите, чтобы приложить</div>}
    </div>
  )
})
