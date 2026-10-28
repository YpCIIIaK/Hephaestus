import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, rejectCrossSite } from '@/lib/server/http'
import { saveServerSettings } from '@/lib/server/settings'
import { getServerStatus } from '@/lib/server/status'

export const dynamic = 'force-dynamic'

const url = z.union([z.literal(''), z.url({ protocol: /^https?$/ })])

const schema = z.object({
  openrouterKey: z.string().max(400).optional(),
  ollamaUrl: url.optional(),
  customUrl: url.optional(),
  customKey: z.string().max(400).optional(),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  await saveServerSettings(parsed.data)
  return NextResponse.json(await getServerStatus())
}
