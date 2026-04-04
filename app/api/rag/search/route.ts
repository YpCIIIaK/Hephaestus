import { NextRequest, NextResponse } from 'next/server'
import { getVectorStore } from '@/lib/simple-vector-store'

export async function POST(req: NextRequest) {
  try {
    const { query, topK = 5 } = await req.json()
    
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 })
    }

    const store = getVectorStore()
    const results = store.search(query, topK)
    
    return NextResponse.json({
      results: results.map(r => ({
        text: r.chunk.text,
        score: r.score,
        source: r.document,
        startLine: r.chunk.startLine,
        endLine: r.chunk.endLine,
      }))
    })
  } catch (error: any) {
    console.error('RAG Search Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}