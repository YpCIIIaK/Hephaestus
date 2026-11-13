'use client'

import { Check, Copy } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-3 hover:text-fg', className)}
      aria-label="Копировать"
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {done ? 'Скопировано' : 'Копировать'}
    </button>
  )
}

function nodeText(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node && typeof node === 'object' && 'props' in node) return nodeText((node as { props: { children?: unknown } }).props.children)
  return ''
}

/**
 * Отчёты сканеров пишут переносы внутри ячеек таблиц как <br>. HTML в ответах
 * моделей не выполняется (небезопасно), но <br> превращаем в перенос строки.
 */
function rehypeBreaks() {
  type N = { type: string; value?: string; tagName?: string; properties?: object; children?: N[] }
  const walk = (node: N) => {
    if (!node.children) return
    node.children = node.children.map((c) => (c.type === 'raw' && /^<br\s*\/?>$/i.test(c.value?.trim() ?? '') ? { type: 'element', tagName: 'br', properties: {}, children: [] } : c))
    node.children.forEach(walk)
  }
  return (tree: N) => walk(tree)
}

const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children
    const className = (child as { props?: { className?: string } })?.props?.className ?? ''
    const lang = className.match(/language-(\S+)/)?.[1]
    const text = nodeText(children).replace(/\n$/, '')
    return (
      <div className="group/code my-3 overflow-hidden rounded-xl border border-border bg-surface-2">
        <div className="flex items-center justify-between border-b border-border px-3 py-1">
          <span className="font-mono text-[11px] text-faint">{lang ?? 'код'}</span>
          <CopyButton text={text} />
        </div>
        <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">{children}</pre>
      </div>
    )
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  },
}

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  return (
    <div className={cn('prose-forge text-[14.5px]', streaming && '[&>*:last-child]:streaming-caret', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeBreaks, [rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

const CHUNK_CHARS = 6000
const TABLE_ROWS = 40

/**
 * Делит Markdown на части по границам блоков (не внутри кода). Большая
 * таблица делится по строкам, у каждой части — свой заголовок.
 */
export function splitMarkdown(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let fence = false
  const flush = () => {
    if (cur.length) blocks.push(cur.join('\n'))
    cur = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && !line.trim()) flush()
    else cur.push(line)
  }
  flush()

  const pieces: string[] = []
  for (const b of blocks) {
    const lines = b.split('\n')
    const isTable = lines.length > TABLE_ROWS + 2 && lines.every((l) => l.trim().startsWith('|')) && /^\s*\|?\s*:?-{2,}/.test(lines[1])
    if (!isTable) {
      pieces.push(b)
      continue
    }
    const head = lines.slice(0, 2)
    for (let i = 2; i < lines.length; i += TABLE_ROWS) pieces.push([...head, ...lines.slice(i, i + TABLE_ROWS)].join('\n'))
  }

  const chunks: string[] = []
  let acc = ''
  for (const p of pieces) {
    if (acc && acc.length + p.length > CHUNK_CHARS) {
      chunks.push(acc)
      acc = ''
    }
    acc = acc ? `${acc}\n\n${p}` : p
  }
  if (acc) chunks.push(acc)
  return chunks
}

/**
 * Markdown для длинных текстов (отчёты, сотни находок): сначала рисуется
 * первая часть, следующие — когда до них докрутили. Готовые части при
 * потоковом выводе не перерисовываются.
 */
export function LazyMarkdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  const chunks = useMemo(() => splitMarkdown(text), [text])
  const [shown, setShown] = useState(1)
  const sentinel = useRef<HTMLDivElement>(null)
  const more = shown < chunks.length
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown((n) => n + 1), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, shown])
  if (chunks.length <= 1) return <Markdown text={text} className={className} streaming={streaming} />
  return (
    <div>
      {chunks.slice(0, shown).map((c, i) => (
        <Markdown key={i} text={c} className={cn(i && 'mt-3', className)} streaming={streaming && !more && i === chunks.length - 1} />
      ))}
      {more && (
        <div ref={sentinel} className="mt-3 flex items-center justify-center gap-2 py-2 text-xs text-muted">
          <button type="button" onClick={() => setShown(chunks.length)} className="rounded-md px-2 py-1 hover:bg-surface-3 hover:text-fg">
            Показано {Math.round((chunks.slice(0, shown).join('').length / text.length) * 100)}% — показать всё
          </button>
        </div>
      )}
    </div>
  )
}

export { CopyButton }
