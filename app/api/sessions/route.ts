import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { copySession, readSession, SessionError, writeSession } from '@/lib/server/sessions'

export const dynamic = 'force-dynamic'

// Память сессии (диалога): посмотреть, поправить, перенести в другой диалог

const id = z.string().regex(/^[\w-]{1,80}$/)

function fail(e: unknown) {
  return jsonError(errorMessage(e), e instanceof SessionError ? 400 : 500)
}

export async function GET(req: Request) {
  const parsed = id.safeParse(new URL(req.url).searchParams.get('id'))
  if (!parsed.success) return jsonError('Не указан id сессии')
  return NextResponse.json({ text: await readSession(parsed.data) })
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), id, text: z.string().max(200_000) }),
  z.object({ action: z.literal('copy'), from: id, to: id, extra: z.string().max(100_000).default('') }),
])

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  try {
    const body = parsed.data
    if (body.action === 'save') {
      await writeSession(body.id, body.text)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json(await copySession(body.from, body.to, body.extra))
  } catch (e) {
    return fail(e)
  }
}
