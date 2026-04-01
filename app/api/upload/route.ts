import { NextRequest, NextResponse } from 'next/server'

/**
 * Extract text content from various file formats
 */
async function extractTextFromBuffer(buffer: Buffer, filename: string, mimetype: string): Promise<{ text: string; error?: string }> {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  try {
    // PDF files
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      const pdfParse = require('pdf-parse')
      const data = await pdfParse(buffer)
      return { text: data.text || '[PDF contains no extractable text]' }
    }

    // Word documents (.docx)
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return { text: result.value || '[Document contains no extractable text]' }
    }

    // Legacy Word documents (.doc) - limited support
    if (ext === 'doc') {
      return { text: '[Legacy .doc format not fully supported. Please convert to .docx for better extraction.]' }
    }

    // Excel files (.xlsx, .xls)
    if (mimetype.includes('spreadsheet') || ext === 'xlsx' || ext === 'xls') {
      const XLSX = require('xlsx')
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const texts: string[] = []

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        texts.push(`### Sheet: ${sheetName}\n${csv}`)
      }

      return { text: texts.join('\n\n') || '[Spreadsheet is empty]' }
    }

    // CSV files
    if (mimetype === 'text/csv' || ext === 'csv') {
      return { text: buffer.toString('utf-8') }
    }

    // Text-based files - direct text read
    if (mimetype.startsWith('text/') || [
      'txt', 'md', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx',
      'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift',
      'kt', 'scala', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
      'sql', 'r', 'm', 'pl', 'lua', 'dart', 'vue', 'svelte', 'astro', 'mdx',
      'log', 'diff', 'patch', 'env', 'gitignore', 'dockerignore', 'dockerfile',
      'lock', 'sum', 'mod', 'proto', 'graphql', 'gql', 'prisma', 'tf', 'tfvars'
    ].includes(ext)) {
      return { text: buffer.toString('utf-8') }
    }

    // Image files - metadata only
    if (mimetype.startsWith('image/') || [
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif'
    ].includes(ext)) {
      return { text: `[Image file: ${filename}, ${formatFileSize(buffer.length)}]` }
    }

    // Audio/Video - metadata only
    if (mimetype.startsWith('audio/') || mimetype.startsWith('video/')) {
      return { text: `[${mimetype.split('/')[0]} file: ${filename}, ${formatFileSize(buffer.length)}]` }
    }

    // Binary/archived files
    if ([
      'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
      'exe', 'dll', 'so', 'dylib', 'bin',
      'ppt', 'pptx',
      'woff', 'woff2', 'ttf', 'eot', 'otf',
      'db', 'sqlite', 'sqlite3'
    ].includes(ext)) {
      return { text: `[Binary file: ${filename}, ${formatFileSize(buffer.length)}, cannot extract text content]` }
    }

    // Fallback: try as UTF-8 text
    const textContent = buffer.toString('utf-8')
    if (textContent.length > 0 && !textContent.includes('\ufffd')) {
      return { text: textContent }
    }

    return { text: `[File: ${filename}, ${formatFileSize(buffer.length)}, format not recognized for text extraction]` }

  } catch (error: any) {
    return {
      text: `[Error processing ${filename}: ${error.message}]`,
      error: error.message
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Max file size: 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const results: Array<{
      filename: string
      size: number
      mimetype: string
      text: string
      error?: string
    }> = []

    for (const file of files) {
      const filename = file.name || 'unnamed'
      const mimetype = file.type || 'application/octet-stream'
      const size = file.size

      if (size > MAX_FILE_SIZE) {
        results.push({
          filename,
          size,
          mimetype,
          text: `[File too large: ${formatFileSize(size)}, max ${formatFileSize(MAX_FILE_SIZE)}]`,
          error: 'File exceeds maximum size'
        })
        continue
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const extracted = await extractTextFromBuffer(buffer, filename, mimetype)

      results.push({
        filename,
        size,
        mimetype,
        text: extracted.text,
        error: extracted.error
      })
    }

    return NextResponse.json({
      files: results,
      totalFiles: results.length
    })

  } catch (error: any) {
    console.error('Upload API Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to process files' }, { status: 500 })
  }
}