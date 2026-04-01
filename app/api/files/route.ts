import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const EXCLUDED_DIRS = ['node_modules', '.next', '.git', 'out', 'dist', '.vercel']

/**
 * File API to browse and read local project files safely.
 */
export async function GET(req: NextRequest) {
  try {
    const root = process.cwd()
    const files = await getFilesRecursively(root, root)
    return NextResponse.json({ files })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let requestedPath = 'unknown'
  try {
    const { filePath } = await req.json()
    requestedPath = filePath
    if (!requestedPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

    // Normalize Windows paths for consistency
    const normalizedPath = requestedPath.replace(/\\/g, '/')
    
    const root = process.cwd()
    const fullPath = path.resolve(root, normalizedPath)

    console.log(`[API FILES] Reading: ${normalizedPath}`)

    // Security: Ensure path is within the project root
    if (!fullPath.startsWith(path.resolve(root))) {
      console.error(`[API FILES] Access Denied: ${fullPath} is outside ${root}`)
      return NextResponse.json({ error: 'Access denied: Path outside workspace' }, { status: 403 })
    }

    const content = await fs.readFile(fullPath, 'utf-8')
    console.log(`[API FILES] Success: ${normalizedPath} (${content.length} chars)`)
    return NextResponse.json({ content })
  } catch (error: any) {
    console.error(`[API FILES] Failed to read ${requestedPath}:`, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function getFilesRecursively(dir: string, root: string): Promise<any[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(root, fullPath)

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.includes(entry.name)) return null
      const children = await getFilesRecursively(fullPath, root)
      return {
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: children.filter(Boolean)
      }
    }

    return {
      name: entry.name,
      path: relativePath,
      type: 'file',
      size: (await fs.stat(fullPath)).size
    }
  }))

  return files.filter(Boolean)
}
