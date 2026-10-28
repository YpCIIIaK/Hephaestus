import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'
import { deleteSkill, listSkills, saveSkill } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ skills: await listSkills() })
}

const schema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  category: z.string().max(60).optional(),
  content: z.string().min(1).max(200_000),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  try {
    return NextResponse.json({ skill: await saveSkill(parsed.data) })
  } catch (e) {
    return jsonError(errorMessage(e), 500)
  }
}

export async function DELETE(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return jsonError('Не указан id')
  try {
    await deleteSkill(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(errorMessage(e))
  }
}
