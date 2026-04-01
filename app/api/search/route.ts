import { NextResponse } from 'next/server'
import { performSearch } from '@/lib/search-utils'

export async function POST(req: Request) {
  try {
    const { query, maxResults = 5 } = await req.json()
    
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const results = await performSearch(query, maxResults)
    
    if (results.startsWith('[Search')) {
       return NextResponse.json({ error: results }, { status: 502 })
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Search API Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to perform search' }, { status: 500 })
  }
}
