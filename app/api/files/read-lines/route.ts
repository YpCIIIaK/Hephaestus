import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const PROJECT_ROOT = process.cwd()

// Read specific line ranges from a file (IDE-like selective reading)
export async function POST(req: NextRequest) {
  try {
    const { filePath, lineRanges, maxPreviewLines } = await req.json()

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 })
    }

    // Security: Normalize and validate path
    const normalizedPath = path.normalize(filePath).replace(/\\/g, '/')
    const absolutePath = path.join(PROJECT_ROOT, normalizedPath)
    
    // Ensure path doesn't escape project root
    if (!absolutePath.startsWith(PROJECT_ROOT)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
    }

    // Check if file exists
    try {
      await fs.access(absolutePath)
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Read file content
    const content = await fs.readFile(absolutePath, 'utf-8')
    const lines = content.split('\n')
    const totalLines = lines.length

    // If no lineRanges specified, return preview and metadata
    if (!lineRanges || lineRanges.length === 0) {
      const previewLimit = maxPreviewLines || 50
      const preview = lines.slice(0, previewLimit).join('\n')
      
      return NextResponse.json({
        content: preview,
        totalLines,
        filePath: normalizedPath,
        isPreview: true,
        previewLines: Math.min(previewLimit, totalLines)
      })
    }

    // Read specific line ranges
    const selectedLines: string[] = []
    const readStats = []

    for (const range of lineRanges) {
      const start = Math.max(0, (range.start || 1) - 1) // 1-indexed to 0-indexed
      const end = Math.min(totalLines, range.end || totalLines)
      
      if (start < end) {
        const chunk = lines.slice(start, end)
        selectedLines.push(`// Lines ${start + 1}-${end}:\n${chunk.join('\n')}`)
        readStats.push({ start: start + 1, end, count: end - start })
      }
    }

    const result = selectedLines.join('\n\n')
    const totalReadLines = readStats.reduce((sum, r) => sum + r.count, 0)

    return NextResponse.json({
      content: result,
      totalLines,
      filePath: normalizedPath,
      readLines: totalReadLines,
      ranges: readStats,
      isPreview: false
    })

  } catch (error: any) {
    console.error('Read Lines API Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to read file lines' },
      { status: 500 }
    )
  }
}

// Also support GET for simple metadata/statistics about a file
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const filePath = searchParams.get('path')

    if (!filePath) {
      return NextResponse.json({ error: 'path parameter is required' }, { status: 400 })
    }

    const normalizedPath = path.normalize(filePath).replace(/\\/g, '/')
    const absolutePath = path.join(PROJECT_ROOT, normalizedPath)
    
    if (!absolutePath.startsWith(PROJECT_ROOT)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
    }

    const content = await fs.readFile(absolutePath, 'utf-8')
    const lines = content.split('\n')
    
    // Generate line index: first 100 chars of each line for AI planning
    const lineIndex = lines.slice(0, 1000).map((line, i) => ({
      line: i + 1,
      preview: line.slice(0, 100).trim()
    }))

    return NextResponse.json({
      filePath: normalizedPath,
      totalLines: lines.length,
      totalChars: content.length,
      lineIndex: lines.length > 1000 ? lineIndex.slice(0, 1000) : lineIndex,
      hasMore: lines.length > 1000
    })

  } catch (error: any) {
    console.error('File Stats API Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get file stats' },
      { status: 500 }
    )
  }
}
