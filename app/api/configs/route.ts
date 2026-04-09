import { NextRequest, NextResponse } from 'next/server'
import { loadConfigs } from '@/lib/config-store'

export async function GET() {
  try {
    const configs = await loadConfigs()
    
    return NextResponse.json({ 
      configs: configs.map((c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description || 'No description',
        nodeCount: c.nodes?.length || 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
