import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, rejectCrossSite } from '@/lib/server/http'
import { sandboxTree } from '@/lib/server/sandboxes'
import { runTool } from '@/lib/server/tools'
import { runInWorkspace } from '@/lib/server/workspace-scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 1800

// Прямой вызов инструмента — им пользуются узлы пайплайна «Поиск», «Файл», «Знания», «Команда».
const schema = z.object({
  name: z.enum(['web_search', 'fetch_url', 'list_files', 'read_file', 'write_file', 'knowledge_search', 'load_skill', 'run_command']),
  args: z.record(z.string(), z.unknown()),
  /** Выполнить в копии проекта узла со «своей копией» */
  sandbox: z.string().regex(/^sb_[a-z0-9]+$/).optional(),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  const { name, args, sandbox } = parsed.data
  const run = () => runTool(name, args, req.signal)
  if (!sandbox) return NextResponse.json(await run())
  try {
    const root = await sandboxTree(sandbox)
    return NextResponse.json(await runInWorkspace({ root, sandbox: true }, run))
  } catch (e) {
    return NextResponse.json({ ok: false, output: e instanceof Error ? e.message : String(e) })
  }
}
