import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, rejectCrossSite } from '@/lib/server/http'
import { searchKnowledge } from '@/lib/server/knowledge'

export const dynamic = 'force-dynamic'

const schema = z.object({ query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(30).optional() })

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  return NextResponse.json({ hits: await searchKnowledge(parsed.data.query, parsed.data.limit ?? 8) })
}
