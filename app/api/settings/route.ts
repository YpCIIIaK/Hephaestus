import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { MAX_COMMAND_TIMEOUT_SEC, saveServerSettings } from '@/lib/server/settings'
import { getServerStatus } from '@/lib/server/status'

export const dynamic = 'force-dynamic'

const url = z.union([z.literal(''), z.url({ protocol: /^https?$/ })])

const schema = z.object({
  openrouterKey: z.string().max(400).optional(),
  ollamaUrl: url.optional(),
  customUrl: url.optional(),
  customKey: z.string().max(400).optional(),
  workspaceDir: z.string().max(1000).optional(),
  terminal: z.enum(['off', 'full']).optional(),
  commandTimeoutSec: z.number().int().min(5).max(MAX_COMMAND_TIMEOUT_SEC).optional(),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  try {
    await saveServerSettings(parsed.data)
  } catch (e) {
    return jsonError(errorMessage(e))
  }
  return NextResponse.json(await getServerStatus())
}
