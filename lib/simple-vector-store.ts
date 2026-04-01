/**
 * Simple BM25-based Vector Store for RAG
 * 
 * Без внешних зависимостей — используем TF-IDF/BM25 для поиска по чанкам.
 * Позже можно заменить на реальные эмбеддинги (OpenRouter Nomic / OpenAI).
 */

import { TextChunk } from './text-splitter'

export interface IndexedDocument {
  id: string           // source file path
  source: string       // filename
  chunks: TextChunk[]
  indexedAt: string    // timestamp
  totalTokens: number
}

export interface SearchResult {
  chunk: TextChunk
  score: number
  document: string
}

export interface IndexStats {
  documentCount: number
  totalChunks: number
  totalTokens: number
  indexedDocuments: { source: string; chunks: number; totalTokens: number; indexedAt: string }[]
}

// BM25 parameters
const BM25_K1 = 1.5  // Term frequency saturation
const BM25_B = 0.75  // Length normalization

/**
 * Simple BM25 search over indexed documents
 */
export class SimpleVectorStore {
  private documents: Map<string, IndexedDocument> = new Map()
  // Inverted index: term -> Set of chunk IDs
  private termToChunks: Map<string, Set<string>> = new Map()
  // Term frequency in each chunk: chunkId -> Map<term, count>
  private chunkTermFreq: Map<string, Map<string, number>> = new Map()
  // Average chunk length
  private avgChunkLength: number = 0
  // Total number of chunks
  private totalChunks: number = 0

  /**
   * Index a document (file) - split into chunks and build index
   */
  indexDocument(documentId: string, chunks: TextChunk[], totalTokens: number): void {
    // Remove old index if exists
    this.removeDocument(documentId)

    const doc: IndexedDocument = {
      id: documentId,
      source: chunks[0]?.metadata.source || documentId,
      chunks,
      indexedAt: new Date().toISOString(),
      totalTokens,
    }

    this.documents.set(documentId, doc)
    this.totalChunks += chunks.length

    // Build inverted index and term frequencies
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text)
      this.chunkTermFreq.set(chunk.id, new Map())
      const chunkFreq = this.chunkTermFreq.get(chunk.id)!

      for (const token of tokens) {
        if (!this.termToChunks.has(token)) {
          this.termToChunks.set(token, new Set())
        }
        this.termToChunks.get(token)!.add(chunk.id)

        chunkFreq.set(token, (chunkFreq.get(token) || 0) + 1)
      }
    }

    // Update average chunk length
    const allChunks = Array.from(this.documents.values()).flatMap(d => d.chunks)
    this.avgChunkLength = allChunks.length > 0
      ? allChunks.reduce((sum, c) => sum + c.text.length, 0) / allChunks.length
      : 0
  }

  /**
   * Remove a document from the index
   */
  removeDocument(documentId: string): void {
    const doc = this.documents.get(documentId)
    if (!doc) return

    this.documents.delete(documentId)
    this.totalChunks -= doc.chunks.length

    // Clean inverted index
    for (const chunk of doc.chunks) {
      this.chunkTermFreq.delete(chunk.id)
    }

    // Rebuild termToChunks (simple approach)
    this.rebuildInvertedIndex()
  }

  /**
   * Search for relevant chunks using BM25
   */
  search(query: string, topK: number = 3): SearchResult[] {
    if (this.totalChunks === 0) return []

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    // Score each chunk using BM25
    const scores = new Map<string, number>()

    for (const queryToken of queryTokens) {
      const chunkIds = this.termToChunks.get(queryToken)
      if (!chunkIds || chunkIds.size === 0) continue

      const df = chunkIds.size // document frequency
      const idf = Math.log(1 + (this.totalChunks - df + 0.5) / (df + 0.5))

      for (const chunkId of chunkIds) {
        const tf = this.chunkTermFreq.get(chunkId)?.get(queryToken) || 0
        const chunkLength = this.getChunkLength(chunkId)
        const normalizedLength = chunkLength / this.avgChunkLength

        // BM25 formula
        const bm25Score = idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * normalizedLength))
        scores.set(chunkId, (scores.get(chunkId) || 0) + bm25Score)
      }
    }

    // Sort by score and return top K
    const results: SearchResult[] = []
    for (const [chunkId, score] of scores.entries()) {
      const chunk = this.findChunk(chunkId)
      if (chunk) {
        const doc = this.findDocumentForChunk(chunkId)
        results.push({
          chunk,
          score,
          document: doc?.source || 'unknown',
        })
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    const docs = Array.from(this.documents.values())
    return {
      documentCount: docs.length,
      totalChunks: this.totalChunks,
      totalTokens: docs.reduce((sum, d) => sum + d.totalTokens, 0),
      indexedDocuments: docs.map(d => ({
        source: d.source,
        chunks: d.chunks.length,
        totalTokens: d.totalTokens,
        indexedAt: d.indexedAt,
      })),
    }
  }

  /**
   * Check if document is indexed
   */
  isIndexed(documentId: string): boolean {
    return this.documents.has(documentId)
  }

  /**
   * Clear all indices
   */
  clear(): void {
    this.documents.clear()
    this.termToChunks.clear()
    this.chunkTermFreq.clear()
    this.totalChunks = 0
    this.avgChunkLength = 0
  }

  // --- Private helpers ---

  private rebuildInvertedIndex(): void {
    this.termToChunks.clear()
    for (const doc of this.documents.values()) {
      for (const chunk of doc.chunks) {
        const tokens = tokenize(chunk.text)
        const seen = new Set<string>()
        for (const token of tokens) {
          if (seen.has(token)) continue
          seen.add(token)
          if (!this.termToChunks.has(token)) {
            this.termToChunks.set(token, new Set())
          }
          this.termToChunks.get(token)!.add(chunk.id)
        }
      }
    }
  }

  private getChunkLength(chunkId: string): number {
    for (const doc of this.documents.values()) {
      const chunk = doc.chunks.find(c => c.id === chunkId)
      if (chunk) return chunk.text.length
    }
    return this.avgChunkLength
  }

  private findChunk(chunkId: string): TextChunk | undefined {
    for (const doc of this.documents.values()) {
      const chunk = doc.chunks.find(c => c.id === chunkId)
      if (chunk) return chunk
    }
    return undefined
  }

  private findDocumentForChunk(chunkId: string): IndexedDocument | undefined {
    for (const doc of this.documents.values()) {
      if (doc.chunks.some(c => c.id === chunkId)) return doc
    }
    return undefined
  }
}

/**
 * Tokenize text: lowercase, split on non-alphanumeric, filter stopwords
 */
function tokenize(text: string): string[] {
  // Russian stopwords
  const RU_STOPWORDS = new Set([
    'и', 'в', 'не', 'на', 'я', 'с', 'он', 'а', 'по', 'но', 'это', 'она', 'они',
    'к', 'у', 'как', 'из', 'мы', 'за', 'что', 'так', 'тот', 'этот', 'все',
    'для', 'от', 'до', 'же', 'бы', 'ли', 'или', 'о', 'об', 'если', 'то',
    'the', 'is', 'in', 'at', 'on', 'and', 'for', 'with', 'a', 'an', 'to',
    'of', 'that', 'it', 'as', 'by', 'this', 'are', 'was', 'were', 'be',
  ])

  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)  // Split on punctuation and spaces
    .filter(t => t.length > 2)  // Filter short tokens
    .filter(t => !RU_STOPWORDS.has(t))  // Filter stopwords
    .filter(Boolean)
}

// Singleton instance for global use
let _store: SimpleVectorStore | null = null

export function getVectorStore(): SimpleVectorStore {
  if (!_store) {
    _store = new SimpleVectorStore()
  }
  return _store
}