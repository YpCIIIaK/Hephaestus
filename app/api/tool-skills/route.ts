import { NextResponse } from 'next/server'
import type { ActionContext } from '@/lib/actions/types'
import { toolSkillRegistry } from '@/lib/skills/tool-skill'

import '@/lib/skills/tool-skills-examples'

export async function GET() {
  try {
    const toolSkills = toolSkillRegistry.list().map((t) => ({
      id: t.metadata.id,
      name: t.metadata.name,
      description: t.metadata.description,
      category: t.metadata.category,
      actionId: t.metadata.actionId,
      updatedAt: t.updatedAt,
    }))

    return NextResponse.json({ toolSkills })
  } catch (error) {
    console.error('Error listing tool skills:', error)
    return NextResponse.json({ error: 'Failed to list tool skills' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { id, inputs, context } = body || {}

    if (!id) {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    const toolSkill = toolSkillRegistry.get(String(id))
    if (!toolSkill) {
      return NextResponse.json({ error: `Tool skill '${id}' not found` }, { status: 404 })
    }

    const actionContext: ActionContext | undefined = context && typeof context === 'object' ? context : undefined

    const result = await toolSkill.execute(inputs || {}, actionContext)
    return NextResponse.json({ result })
  } catch (error: any) {
    console.error('Error executing tool skill:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to execute tool skill' },
      { status: 500 }
    )
  }
}
