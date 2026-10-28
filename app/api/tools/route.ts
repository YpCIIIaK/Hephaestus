import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, rejectCrossSite } from '@/lib/server/http'
import { runTool } from '@/lib/server/tools'

export const dynamic = 'force-dynamic'

// Прямой вызов инструмента — им пользуются узлы пайплайна «Поиск», «Файл», «Знания».
const schema = z.object({
  name: z.enum(['web_search', 'fetch_url', 'list_files', 'read_file', 'write_file', 'knowledge_search', 'load_skill']),
  args: z.record(z.string(), z.unknown()),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  return NextResponse.json(await runTool(parsed.data.name, parsed.data.args, req.signal))
}
