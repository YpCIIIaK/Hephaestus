import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

/**
 * PATCH /api/files/edit
 * 
 * Edit a file with various operations:
 * - 'write': Write full content (overwrite)
 * - 'edit': Apply diff/str_replace style edits
 * - 'append': Append to end of file
 * - 'delete': Delete file
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { 
      filePath, 
      operation = 'write',
      content,
      oldStr,
      newStr,
      createBackup = true 
    } = body

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 })
    }

    // Normalize path
    const normalizedPath = filePath.replace(/\\/g, '/')
    const root = process.cwd()
    const fullPath = path.resolve(root, normalizedPath)

    // Security check
    if (!fullPath.startsWith(path.resolve(root))) {
      return NextResponse.json({ error: 'Access denied: Path outside workspace' }, { status: 403 })
    }

    // Check if file exists
    const exists = await fs.access(fullPath).then(() => true).catch(() => false)

    switch (operation) {
      case 'write': {
        if (!content && content !== '') {
          return NextResponse.json({ error: 'content is required for write operation' }, { status: 400 })
        }

        // Create backup if requested and file exists
        if (createBackup && exists) {
          const backupPath = `${fullPath}.backup.${Date.now()}`
          await fs.copyFile(fullPath, backupPath)
        }

        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        
        await fs.writeFile(fullPath, content, 'utf-8')
        
        return NextResponse.json({ 
          success: true, 
          operation: 'write',
          filePath: normalizedPath,
          bytesWritten: Buffer.byteLength(content, 'utf-8')
        })
      }

      case 'edit': {
        if (!oldStr || !newStr) {
          return NextResponse.json({ error: 'oldStr and newStr are required for edit operation' }, { status: 400 })
        }

        if (!exists) {
          return NextResponse.json({ error: 'File does not exist' }, { status: 404 })
        }

        const currentContent = await fs.readFile(fullPath, 'utf-8')
        
        // Check if oldStr exists in file
        if (!currentContent.includes(oldStr)) {
          return NextResponse.json({ 
            error: 'oldStr not found in file',
            hint: 'The text to replace was not found. File may have changed.'
          }, { status: 400 })
        }

        // Create backup
        if (createBackup) {
          const backupPath = `${fullPath}.backup.${Date.now()}`
          await fs.copyFile(fullPath, backupPath)
        }

        // Apply replacement (replace first occurrence only for safety)
        const newContent = currentContent.replace(oldStr, newStr)
        
        await fs.writeFile(fullPath, newContent, 'utf-8')

        return NextResponse.json({ 
          success: true, 
          operation: 'edit',
          filePath: normalizedPath,
          replacements: 1,
          bytesChanged: Math.abs(Buffer.byteLength(newContent, 'utf-8') - Buffer.byteLength(currentContent, 'utf-8'))
        })
      }

      case 'append': {
        if (!content) {
          return NextResponse.json({ error: 'content is required for append operation' }, { status: 400 })
        }

        // Create backup if file exists
        if (createBackup && exists) {
          const backupPath = `${fullPath}.backup.${Date.now()}`
          await fs.copyFile(fullPath, backupPath)
        }

        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true })

        await fs.appendFile(fullPath, content, 'utf-8')

        return NextResponse.json({ 
          success: true, 
          operation: 'append',
          filePath: normalizedPath,
          bytesAppended: Buffer.byteLength(content, 'utf-8')
        })
      }

      case 'delete': {
        if (!exists) {
          return NextResponse.json({ error: 'File does not exist' }, { status: 404 })
        }

        // Create backup before delete
        if (createBackup) {
          const backupPath = `${fullPath}.backup.${Date.now()}.deleted`
          await fs.copyFile(fullPath, backupPath)
        }

        await fs.unlink(fullPath)

        return NextResponse.json({ 
          success: true, 
          operation: 'delete',
          filePath: normalizedPath
        })
      }

      default:
        return NextResponse.json({ error: `Unknown operation: ${operation}` }, { status: 400 })
    }

  } catch (error: any) {
    console.error('[API FILES EDIT] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to edit file' }, { status: 500 })
  }
}

/**
 * GET /api/files/edit/status
 * 
 * Get status of recent edits (backups, etc.)
 */
export async function GET() {
  return NextResponse.json({ 
    message: 'File Edit API is active',
    operations: ['write', 'edit', 'append', 'delete'],
    features: ['Automatic backups', 'Path security validation', 'Diff-based editing']
  })
}
