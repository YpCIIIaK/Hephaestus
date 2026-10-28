import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { addKnowledge, listKnowledge, removeKnowledge } from '@/lib/server/knowledge'
import { readWorkspaceFile } from '@/lib/server/workspace'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ docs: await listKnowledge() })
}

const schema = z.union([
  z.object({ path: z.string().min(1) }),
  z.object({ title: z.string().min(1).max(200), text: z.string().min(1).max(5_000_000), source: z.enum(['upload', 'text']) }),
])

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  try {
    if ('path' in parsed.data) {
      const file = await readWorkspaceFile(parsed.data.path)
      const doc = await addKnowledge({ title: file.path.split('/').pop() || file.path, text: file.content, source: 'workspace', path: file.path })
      return NextResponse.json({ doc })
    }
    return NextResponse.json({ doc: await addKnowledge(parsed.data) })
  } catch (e) {
    return jsonError(errorMessage(e))
  }
}

export async function DELETE(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return jsonError('Не указан id')
  return NextResponse.json({ ok: await removeKnowledge(id) })
}
