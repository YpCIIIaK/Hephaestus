import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { AuthError, cancelJob, getJob, loginStatus, sendCode, startJob } from '@/lib/server/subscription-auth'
import { cliVersion, subscriptionConfig } from '@/lib/server/subscriptions'

export const dynamic = 'force-dynamic'

// Установка CLI, вход и выход из подписки кнопками из настроек

const ids = ['claude-code', 'codex'] as const

export async function GET() {
  const list = await Promise.all(
    ids.map(async (id) => {
      const cfg = await subscriptionConfig(id)
      const version = await cliVersion(cfg.bin)
      const job = getJob(id)
      const status = version.version && job?.state !== 'running' ? await loginStatus(id) : { loggedIn: null }
      return { id, installed: !!version.version, version: version.version, ...status, job }
    }),
  )
  return NextResponse.json({ subscriptions: list })
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['install', 'login', 'logout']), id: z.enum(ids) }),
  z.object({ action: z.literal('code'), id: z.enum(ids), code: z.string().min(1).max(2000) }),
  z.object({ action: z.literal('cancel'), id: z.enum(ids) }),
])

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data
  try {
    if (body.action === 'code') sendCode(body.id, body.code)
    else if (body.action === 'cancel') cancelJob(body.id)
    else return NextResponse.json({ job: await startJob(body.id, body.action) })
    return NextResponse.json({ job: getJob(body.id) })
  } catch (e) {
    return jsonError(errorMessage(e), e instanceof AuthError ? 409 : 500)
  }
}
