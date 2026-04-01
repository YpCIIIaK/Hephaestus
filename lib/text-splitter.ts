/**
 * Text Splitter - разбивает текст на чанки с overlap
 * Используется для RAG (Retrieval-Augmented Generation)
 */

export interface TextChunk {
  id: string          // Уникальный ID чанка
  text: string        // Содержимое чанка
  startLine: number   // Стартовая строка в оригинальном документе
  endLine: number     // Конечная строка
  chunkIndex: number  // Индекс чанка в документе
  metadata: {
    source: string    // Имя файла
    totalChunks: number
  }
}

export interface TextSplitterOptions {
  chunkSize: number       // Максимальный размер чанка (в символах, ~токенах * 3.5)
  chunkOverlap: number   // Overlap между чанками (в символах)
  separator?: string     // Разделитель (по умолчанию '\n')
}

const DEFAULT_OPTIONS: TextSplitterOptions = {
  chunkSize: 1500,       // ~500 токенов (в среднем 3.5 символа на токен)
  chunkOverlap: 150,     // ~50 токенов overlap
  separator: '\n',       // Разбиваем по строкам
}

/**
 * Split text into chunks with overlap
 */
export function splitText(
  text: string,
  source: string,
  options: Partial<TextSplitterOptions> = {}
): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  if (!text || text.length === 0) {
    return []
  }
  
  // Разделяем текст на строки
  const lines = text.split(opts.separator || '\n')
  
  const chunks: TextChunk[] = []
  let currentChunk: string[] = []
  let currentSize = 0
  let startLine = 0
  let chunkIndex = 0
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineLength = line.length
    
    // Если строка длиннее chunkSize, разбиваем её по символам
    if (lineLength > opts.chunkSize) {
      // Если есть накопленный чанк, сохраняем его сначала
      if (currentChunk.length > 0) {
        chunks.push(
          createChunk(currentChunk.join('\n'), source, startLine, i - 1, chunkIndex++, chunks.length + 1)
        )
        currentChunk = []
        currentSize = 0
      }
      
      // Разбиваем длинную строку на части
      let remaining = line
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, opts.chunkSize)
        chunks.push(
          createChunk(chunk, source, i, i, chunkIndex++, 0) // totalChunks обновим потом
        )
        remaining = remaining.slice(opts.chunkSize - opts.chunkOverlap)
      }
      continue
    }
    
    // Проверяем, помещается ли строка в текущий чанк
    if (currentSize + lineLength + (currentChunk.length > 0 ? 1 : 0) > opts.chunkSize && currentChunk.length > 0) {
      // Сохраняем текущий чанк
      chunks.push(
        createChunk(currentChunk.join('\n'), source, startLine, i - 1, chunkIndex++, chunks.length + 1)
      )
      
      // Начинаем новый чанк с overlap (берём последние строки)
      const overlapLines = getOverlapLines(currentChunk, opts.chunkOverlap)
      currentChunk = overlapLines
      currentSize = overlapLines.reduce((sum, l) => sum + l.length + 1, 0)
      startLine = i - overlapLines.length
    }
    
    currentChunk.push(line)
    currentSize += lineLength + (currentChunk.length > 1 ? 1 : 0)
  }
  
  // Сохраняем последний чанк
  if (currentChunk.length > 0) {
    chunks.push(
      createChunk(currentChunk.join('\n'), source, startLine, lines.length - 1, chunkIndex++, chunks.length + 1)
    )
  }
  
  // Обновляем totalChunks во всех чанках
  const totalChunks = chunks.length
  chunks.forEach(c => c.metadata.totalChunks = totalChunks)
  
  return chunks
}

function createChunk(
  text: string,
  source: string,
  startLine: number,
  endLine: number,
  chunkIndex: number,
  totalChunks: number
): TextChunk {
  return {
    id: `chunk-${source.replace(/[\/\\]/g, '-')}-${chunkIndex}`,
    text: text.trim(),
    startLine: startLine + 1, // 1-based
    endLine: endLine + 1,
    chunkIndex,
    metadata: {
      source: source.split('/').pop() || source,
      totalChunks,
    }
  }
}

/**
 * Получить последние строки для overlap, не превышая overlap size
 */
function getOverlapLines(lines: string[], maxOverlapChars: number): string[] {
  const result: string[] = []
  let totalLength = 0
  
  // Берём строки с конца
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const newLength = totalLength + line.length + (result.length > 0 ? 1 : 0)
    if (newLength > maxOverlapChars) break
    result.unshift(line)
    totalLength = newLength
  }
  
  return result
}

/**
 * Estimate token count (simple heuristic)
 */
export function estimateTokens(text: string): number {
  // ~3.5 chars per token for English, ~2 for Russian/CJK
  return Math.ceil(text.length / 3.5)
}

/**
 * Split large file into chunks for RAG indexing
 * Returns metadata about the split operation
 */
export function splitForRAG(
  text: string,
  source: string,
  maxChunkTokens: number = 500,
  overlapTokens: number = 50
): { chunks: TextChunk[]; totalTokens: number; stats: { chunkCount: number; avgChunkTokens: number } } {
  const chunkChars = maxChunkTokens * 3.5
  const overlapChars = overlapTokens * 3.5
  
  const chunks = splitText(text, source, {
    chunkSize: Math.round(chunkChars),
    chunkOverlap: Math.round(overlapChars),
  })
  
  const totalTokens = chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0)
  const avgChunkTokens = chunks.length > 0 ? totalTokens / chunks.length : 0
  
  return {
    chunks,
    totalTokens,
    stats: {
      chunkCount: chunks.length,
      avgChunkTokens: Math.round(avgChunkTokens),
    }
  }
}