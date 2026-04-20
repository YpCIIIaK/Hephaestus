import { NextRequest, NextResponse } from 'next/server'
import { actionRegistry, executeAction } from '@/lib/actions'

// GET /api/actions - List all available actions
export async function GET() {
  try {
    const actions = actionRegistry.getAll().map(action => ({
      id: action.id,
      name: action.name,
      description: action.description,
      category: action.category,
      icon: action.icon,
      inputs: action.inputs,
      outputs: action.outputs,
      config: action.config,
    }))

    // Group by category
    const byCategory = actions.reduce((acc, action) => {
      const cat = action.category
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(action)
      return acc
    }, {} as Record<string, typeof actions>)

    return NextResponse.json({ 
      actions,
      byCategory,
      total: actions.length 
    })
  } catch (error) {
    console.error('Failed to list actions:', error)
    return NextResponse.json(
      { error: 'Failed to list actions' },
      { status: 500 }
    )
  }
}

// POST /api/actions/execute - Execute an action
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { actionId, inputs, context = {} } = body

    if (!actionId) {
      return NextResponse.json(
        { error: 'Missing actionId' },
        { status: 400 }
      )
    }

    const action = actionRegistry.get(actionId)
    if (!action) {
      return NextResponse.json(
        { error: `Action '${actionId}' not found` },
        { status: 404 }
      )
    }

    // Validate required inputs
    const missingInputs = action.inputs
      .filter(input => input.required && !inputs?.[input.name])
      .map(input => input.name)

    if (missingInputs.length > 0) {
      return NextResponse.json(
        { error: `Missing required inputs: ${missingInputs.join(', ')}` },
        { status: 400 }
      )
    }

    // Execute action
    const result = await executeAction(actionId, inputs || {}, context)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Failed to execute action:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Failed to execute action' 
      },
      { status: 500 }
    )
  }
}
