import { NextRequest, NextResponse } from 'next/server'
import { chainStorage, executeChain } from '@/lib/chains'

// GET /api/chains/[id] - Get a specific chain
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const chain = await chainStorage.get(params.id)
    
    if (!chain) {
      return NextResponse.json(
        { error: 'Chain not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(chain)
  } catch (error) {
    console.error('Failed to get chain:', error)
    return NextResponse.json(
      { error: 'Failed to get chain' },
      { status: 500 }
    )
  }
}

// POST /api/chains/[id]/execute - Execute a chain
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}))
    const { context = {}, options = {} } = body

    const result = await executeChain(params.id, context, options)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Failed to execute chain:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Failed to execute chain'
      },
      { status: 500 }
    )
  }
}
