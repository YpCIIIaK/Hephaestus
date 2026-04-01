import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { splitForRAG, estimateTokens } from '@/lib/text-splitter'
import { SimpleVectorStore, SearchResult } from '@/lib/simple-vector-store'

// In-memory vector store (persists across requests in dev mode)
// For production, consider Redis or persistent storage
let vectorStore: SimpleVectorStore | null = null

function getStore(): SimpleVectorStore {
  if (!vectorStore) {
    vectorStore = require('@/lib/simple-vector-store').getVectorStore() as SimpleVectorStore
  }
  return vectorStore!
}

// Cache for indexed documents: filePath -> indexed text
const indexCache = new Map<string, string>()

/**
 * POST /api/knowledge/search
 * 
 * Search for relevant chunks using BM25
 * Body: { query: string, filePaths?: string[], topK?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, filePaths = [], topK = 3 } = body

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const store = getStore()
    const results = store.search(query, topK)

    return NextResponse.json({
      results: results.map(r => ({
        text: r.chunk.text,
        score: Math.round(r.score * 100) / 100,
        source: r.chunk.metadata.source,
        lines: `L${r.chunk.startLine}-${r.chunk.endLine}`,
      })),
      totalResults: results.length,
      stats: store.getStats(),
    })
  } catch (error: any) {
    console.error('Search API Error:', error)
    return NextResponse.json({ error: error.message || 'Search failed' }, { status: 500 })
  }
}

/**
 * POST /api/knowledge/index
 * 
 * Index a file for RAG search
 * Body: { filePath: string, chunkSize?: number, overlap?: number }
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { filePath, chunkSize = 500, overlap = 50 } = body

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 })
    }

    const root = process.cwd()
    const fullPath = path.resolve(root, filePath)

    if (!fullPath.startsWith(path.resolve(root))) {
      return NextResponse.json({ error: 'Access denied: Path outside workspace' }, { status: 403 })
    }

    // Check if we already have this file indexed with same content
    const cached = indexCache.get(filePath)
    const cachedContent = await fs.readFile(fullPath, 'utf-8')

    const store = getStore()

    if (cached === cachedContent && store.isIndexed(filePath)) {
      return NextResponse.json({
        message: 'File already indexed',
        stats: store.getStats(),
      })
    }

    // Split and index
    const result = splitForRAG(cachedContent, filePath, chunkSize, overlap)
    store.indexDocument(filePath, result.chunks, result.totalTokens)

    // Update cache
    indexCache.set(filePath, cachedContent)

    return NextResponse.json({
      message: 'File indexed successfully',
      stats: result.stats,
      totalChunks: result.chunks.length,
      totalTokens: result.totalTokens,
      storeStats: store.getStats(),
    })
  } catch (error: any) {
    console.error('Index API Error:', error)
    return NextResponse.json({ error: error.message || 'Indexing failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/knowledge/index
 * 
 * Remove a file from the index
 * Body: { filePath: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { filePath } = body

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 })
    }

    const store = getStore()
    store.removeDocument(filePath)
    indexCache.delete(filePath)

    return NextResponse.json({
      message: 'File removed from index',
      storeStats: store.getStats(),
    })
  } catch (error: any) {
    console.error('Delete Index API Error:', error)
    return NextResponse.json({ error: error.message || 'Delete failed' }, { status: 500 })
  }
}

/**
 * GET /api/knowledge/stats
 * 
 * Get vector store statistics
 */
export async function GET() {
  try {
    const store = getStore()
    return NextResponse.json({
      stats: store.getStats(),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to get stats' }, { status: 500 })
  }
}