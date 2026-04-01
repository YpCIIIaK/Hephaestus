import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
  content: string
  className?: string
  compact?: boolean // for step logs - monospace, smaller
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className, compact }: MarkdownRendererProps) {
  if (compact) {
    // For pipeline step logs: minimal styling, keep monospace feel but render tables
    return (
      <div className={cn('text-xs font-mono', className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children }) => (
              <div className="overflow-x-auto my-2">
                <table className="w-full text-xs border-collapse">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
            th: ({ children }) => (
              <th className="border border-border/50 px-2 py-1 text-left font-semibold text-foreground">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border/50 px-2 py-1 text-muted-foreground">
                {children}
              </td>
            ),
            tr: ({ children }) => <tr className="even:bg-muted/20">{children}</tr>,
            code: ({ children }) => (
              <code className="bg-muted/60 px-1 rounded text-[10px]">{children}</code>
            ),
            p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Tables - beautifully styled
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-border">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-primary/5 border-b border-border">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-sm text-muted-foreground border-t border-border/40">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
          ),

          // Headings
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-foreground mt-5 mb-3 pb-1 border-b border-border">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-foreground mt-4 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-foreground mt-3 mb-1.5">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-foreground mt-2 mb-1">{children}</h4>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-sm text-muted-foreground mb-3 last:mb-0 leading-relaxed">{children}</p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="my-2 ml-4 space-y-1 list-disc marker:text-primary/60">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-4 space-y-1 list-decimal marker:text-primary/60">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-muted-foreground leading-relaxed">{children}</li>
          ),

          // Code
          code: ({ className, children, ...props }) => {
            const isInline = !className
            if (isInline) {
              return (
                <code
                  className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-foreground border border-border/50"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className="block text-xs font-mono" {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="bg-secondary/50 border border-border rounded-lg p-4 overflow-x-auto my-3 text-xs font-mono">
              {children}
            </pre>
          ),

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-4 my-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),

          // Strong / emphasis
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-muted-foreground">{children}</em>
          ),

          // Horizontal rule
          hr: () => <hr className="my-4 border-border" />,

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

