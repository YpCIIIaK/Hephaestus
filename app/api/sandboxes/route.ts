import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { applySandbox, createSandbox, diffSandbox, removeSandbox, SandboxError } from '@/lib/server/sandboxes'

export const dynamic = 'force-dynamic'

// Копии проекта для параллельных правок: создать, посмотреть изменения, применить, удалить

const id = z.string().regex(/^sb_[a-z0-9]+$/)

function fail(e: unknown) {
  return jsonError(errorMessage(e), e instanceof SandboxError ? e.status : 500)
}

export async function GET(req: Request) {
  const parsed = id.safeParse(new URL(req.url).searchParams.get('id'))
  if (!parsed.success) return jsonError('Не указан id копии')
  try {
    return NextResponse.json(await diffSandbox(parsed.data))
  } catch (e) {
    return fail(e)
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), label: z.string().max(200).default('') }),
  z.object({ action: z.literal('apply'), id, paths: z.array(z.string().max(1000)).max(5000).optional() }),
])

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  try {
    const body = parsed.data
    if (body.action === 'create') return NextResponse.json(await createSandbox(body.label))
    return NextResponse.json(await applySandbox(body.id, body.paths))
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = id.safeParse(new URL(req.url).searchParams.get('id'))
  if (!parsed.success) return jsonError('Не указан id копии')
  await removeSandbox(parsed.data)
  return NextResponse.json({ ok: true })
}
