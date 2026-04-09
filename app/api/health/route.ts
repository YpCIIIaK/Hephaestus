import { NextResponse } from 'next/server'
import { loadConfigs } from '@/lib/config-store'
import { getVectorStore } from '@/lib/simple-vector-store'

export async function GET() {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      openrouter: !!process.env.OPENROUTER_API_KEY,
      ollama: !!process.env.OLLAMA_BASE_URL,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      search: !!process.env.SEARCH_SEARXNG_URL,
    },
    stats: {
      configs: 0,
      indexedDocuments: 0,
    }
  }

  try {
    const configs = await loadConfigs()
    health.stats.configs = configs.length
  } catch {
    health.stats.configs = 0
  }

  try {
    const store = getVectorStore()
    health.stats.indexedDocuments = store.getStats().documentCount
  } catch {
    health.stats.indexedDocuments = 0
  }

  return NextResponse.json(health)
}