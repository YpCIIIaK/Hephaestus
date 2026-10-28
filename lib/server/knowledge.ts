import path from 'node:path'
import type { KnowledgeDoc, KnowledgeHit } from '../types'
import { BM25, chunkText, tokenize, type Chunk } from '../text'
import { estimateTokens } from '../tokens'
import { DATA_DIR } from './paths'
import { readJson, writeJson } from './json-file'

// База знаний: документы режутся на фрагменты, по ним строится BM25-индекс.
// Тексты фрагментов хранятся в data/knowledge.json, индекс собирается в памяти.

interface StoredDoc extends KnowledgeDoc {
  items: Chunk[]
}

interface Store {
  docs: StoredDoc[]
}

const FILE = path.join(DATA_DIR, 'knowledge.json')

let cache: { store: Store; index: BM25 } | null = null

function buildIndex(store: Store): BM25 {
  const index = new BM25()
  for (const d of store.docs) {
    d.items.forEach((c, i) => index.add(`${d.id}#${i}`, tokenize(`${d.title}\n${c.text}`)))
  }
  return index
}

async function load() {
  if (!cache) {
    const store = await readJson<Store>(FILE, { docs: [] })
    cache = { store, index: buildIndex(store) }
  }
  return cache
}

function strip({ items: _items, ...doc }: StoredDoc): KnowledgeDoc {
  return doc
}

export async function listKnowledge(): Promise<KnowledgeDoc[]> {
  const { store } = await load()
  return store.docs.map(strip)
}

export async function addKnowledge(input: {
  title: string
  text: string
  source: KnowledgeDoc['source']
  path?: string
}): Promise<KnowledgeDoc> {
  const c = await load()
  const items = chunkText(input.text)
  // Повторная индексация того же файла заменяет старую версию
  const existing = input.path ? c.store.docs.find((d) => d.path === input.path) : undefined
  const id = existing?.id ?? `kb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  if (existing) await removeKnowledge(existing.id)
  const doc: StoredDoc = {
    id,
    title: input.title,
    source: input.source,
    path: input.path,
    chunks: items.length,
    tokens: estimateTokens(input.text),
    indexedAt: new Date().toISOString(),
    items,
  }
  c.store.docs.push(doc)
  items.forEach((ch, i) => c.index.add(`${id}#${i}`, tokenize(`${doc.title}\n${ch.text}`)))
  await writeJson(FILE, c.store)
  return strip(doc)
}

export async function removeKnowledge(id: string): Promise<boolean> {
  const c = await load()
  const doc = c.store.docs.find((d) => d.id === id)
  if (!doc) return false
  doc.items.forEach((_, i) => c.index.remove(`${id}#${i}`))
  c.store.docs = c.store.docs.filter((d) => d.id !== id)
  await writeJson(FILE, c.store)
  return true
}

export async function searchKnowledge(query: string, limit = 5): Promise<KnowledgeHit[]> {
  const c = await load()
  const byId = new Map(c.store.docs.map((d) => [d.id, d]))
  return c.index.search(query, limit).flatMap(({ id, score }) => {
    const [docId, idx] = id.split('#')
    const doc = byId.get(docId)
    const chunk = doc?.items[Number(idx)]
    if (!doc || !chunk) return []
    return [{ docId, title: doc.title, text: chunk.text, score, startLine: chunk.startLine, endLine: chunk.endLine }]
  })
}

export function formatKnowledgeHits(query: string, hits: KnowledgeHit[]): string {
  if (!hits.length) return `В базе знаний нет фрагментов по запросу «${query}».`
  return hits.map((h, i) => `[${i + 1}] ${h.title} (строки ${h.startLine}–${h.endLine})\n${h.text}`).join('\n\n---\n\n')
}
