import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { deleteWorkspacePath, listTree, readWorkspaceFile, WorkspaceError, writeWorkspaceFile } from '@/lib/server/workspace'

export const dynamic = 'force-dynamic'

function fail(e: unknown) {
  return jsonError(errorMessage(e), e instanceof WorkspaceError ? e.status : 500)
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get('path')
  try {
    if (p) return NextResponse.json(await readWorkspaceFile(p))
    return NextResponse.json({ tree: await listTree() })
  } catch (e) {
    return fail(e)
  }
}

const writeSchema = z.object({ path: z.string().min(1).max(500), content: z.string().max(2_000_000) })

export async function PUT(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, writeSchema)
  if ('error' in parsed) return parsed.error
  try {
    return NextResponse.json(await writeWorkspaceFile(parsed.data.path, parsed.data.content))
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const p = new URL(req.url).searchParams.get('path')
  if (!p) return jsonError('Не указан путь')
  try {
    return NextResponse.json(await deleteWorkspacePath(p))
  } catch (e) {
    return fail(e)
  }
}
