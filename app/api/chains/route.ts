import { NextRequest, NextResponse } from 'next/server'
import { chainStorage, executeChain, Chain } from '@/lib/chains'

// GET /api/chains - List all chains
export async function GET() {
  try {
    const chains = await chainStorage.getAll()
    return NextResponse.json({ chains })
  } catch (error) {
    console.error('Failed to list chains:', error)
    return NextResponse.json(
      { error: 'Failed to list chains' },
      { status: 500 }
    )
  }
}

// POST /api/chains - Create or update a chain
export async function POST(req: NextRequest) {
  try {
    const chain: Chain = await req.json()

    // Validate required fields
    if (!chain.id || !chain.name) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name' },
        { status: 400 }
      )
    }

    // Ensure timestamps
    chain.updatedAt = new Date().toISOString()
    if (!chain.createdAt) {
      chain.createdAt = chain.updatedAt
    }

    // Set defaults
    chain.executionCount = chain.executionCount || 0
    chain.enabled = chain.enabled !== false
    chain.triggerIds = chain.triggerIds || []

    await chainStorage.save(chain)

    return NextResponse.json({ 
      success: true,
      chain 
    })
  } catch (error: any) {
    console.error('Failed to save chain:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save chain' },
      { status: 500 }
    )
  }
}

// DELETE /api/chains?id=xxx - Delete a chain
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Missing chain id' },
        { status: 400 }
      )
    }

    await chainStorage.delete(id)

    return NextResponse.json({ 
      success: true,
      message: `Chain ${id} deleted` 
    })
  } catch (error: any) {
    console.error('Failed to delete chain:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete chain' },
      { status: 500 }
    )
  }
}
