import fs from 'node:fs/promises'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Markdown } from '@/components/markdown'
import { readWorkspaceFile, resolveWorkspacePath, SKIP_DIRS, WorkspaceError } from '@/lib/server/workspace'

// Просмотр рабочей папки в браузере: /files — корень проекта,
// /files/audit/findings/C5.md — файл, /files/audit — список папки.

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ path?: string[] }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params
  return { title: path?.length ? decodeURIComponent(path[path.length - 1]) : 'Файлы' }
}

const href = (rel: string) => `/files/${rel.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`

function Crumbs({ rel }: { rel: string }) {
  const parts = rel.split('/').filter(Boolean)
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-muted">
      <Link href="/files" className="text-accent hover:underline">
        workspace
      </Link>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          <span>/</span>
          {i === parts.length - 1 ? <span className="text-fg">{p}</span> : <Link href={href(parts.slice(0, i + 1).join('/'))} className="text-accent hover:underline">{p}</Link>}
        </span>
      ))}
    </nav>
  )
}

function size(n: number) {
  return n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`
}

export default async function FilesPage({ params }: Props) {
  const { path } = await params
  const input = (path ?? []).map((p) => decodeURIComponent(p)).join('/')
  let body: React.ReactNode
  let rel = input
  try {
    const r = await resolveWorkspacePath(input)
    rel = r.rel
    const st = await fs.stat(/* turbopackIgnore: true */ r.abs).catch(() => null)
    if (!st) throw new WorkspaceError(`Не найдено: ${input || '/'}`, 404)
    if (st.isDirectory()) {
      const entries = (await fs.readdir(/* turbopackIgnore: true */ r.abs, { withFileTypes: true }))
        .filter((e) => !SKIP_DIRS.has(e.name) && e.name !== '.git')
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      const rows = await Promise.all(
        entries.map(async (e) => {
          const s = e.isFile() ? await fs.stat(/* turbopackIgnore: true */ `${r.abs}/${e.name}`).catch(() => null) : null
          return { name: e.name, dir: e.isDirectory(), size: s?.size }
        }),
      )
      body = (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rel && (
            <li>
              <Link href={href(rel.split('/').slice(0, -1).join('/'))} className="block px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
                ..
              </Link>
            </li>
          )}
          {rows.map((e) => (
            <li key={e.name}>
              <Link href={href(`${rel}/${e.name}`)} className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-sm hover:bg-surface-2">
                <span className={e.dir ? 'text-accent' : ''}>{e.dir ? `${e.name}/` : e.name}</span>
                {e.size !== undefined && <span className="text-xs text-muted">{size(e.size)}</span>}
              </Link>
            </li>
          ))}
          {!rows.length && <li className="px-3 py-2 text-sm text-muted">Папка пуста</li>}
        </ul>
      )
    } else {
      const f = await readWorkspaceFile(input)
      const binary = f.content.includes('\0')
      body = binary ? (
        <p className="text-sm text-muted">Двоичный файл ({size(st.size)}) — просмотр недоступен.</p>
      ) : /\.mdx?$/i.test(rel) ? (
        <div className="rounded-lg border border-border p-5">
          <Markdown text={f.content} />
        </div>
      ) : (
        <Markdown text={'```' + (rel.split('.').pop() ?? '') + '\n' + f.content.replace(/```/g, '`​``') + '\n```'} />
      )
    }
  } catch (e) {
    body = <p className="text-sm text-danger">{e instanceof Error ? e.message : String(e)}</p>
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 overflow-y-auto p-6">
      <Crumbs rel={rel} />
      {body}
    </div>
  )
}
