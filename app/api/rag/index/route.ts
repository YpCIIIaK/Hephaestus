import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { splitText, estimateTokens } from '@/lib/text-splitter'
import { getVectorStore } from '@/lib/simple-vector-store'

const CHUNK_SIZE = 1500
const CHUNK_OVERLAP = 150

export async function POST(req: NextRequest) {
  try {
    const { filePaths } = await req.json()
    
    if (!filePaths || !Array.isArray(filePaths)) {
      return NextResponse.json({ error: 'filePaths array is required' }, { status: 400 })
    }

    const store = getVectorStore()
    const root = process.cwd()
    const results: { path: string; chunks: number; tokens: number; error?: string }[] = []

    for (const filePath of filePaths) {
      try {
        const normalizedPath = filePath.replace(/\\/g, '/')
        const fullPath = path.resolve(root, normalizedPath)
        
        if (!fullPath.startsWith(path.resolve(root))) {
          results.push({ path: filePath, chunks: 0, tokens: 0, error: 'Access denied' })
          continue
        }

        const content = await fs.readFile(fullPath, 'utf-8')
        const chunks = splitText(content, filePath, {
          chunkSize: CHUNK_SIZE,
          chunkOverlap: CHUNK_OVERLAP,
        })

        const totalTokens = chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0)
        store.indexDocument(filePath, chunks, totalTokens)
        
        results.push({ path: filePath, chunks: chunks.length, tokens: totalTokens })
      } catch (e: any) {
        results.push({ path: filePath, chunks: 0, tokens: 0, error: e.message })
      }
    }

    return NextResponse.json({ 
      success: true, 
      indexed: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
      results 
    })
  } catch (error: any) {
    console.error('RAG Index Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { filePath } = await req.json()
    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 })
    }

    const store = getVectorStore()
    store.removeDocument(filePath)
    
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}