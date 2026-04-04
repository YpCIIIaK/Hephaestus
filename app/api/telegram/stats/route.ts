/**
 * GET /api/telegram/stats — Telegram bot statistics
 */

import { getStats } from '@/lib/telegram-store'

export async function GET() {
  try {
    const result = await getStats()
    return Response.json(result)
  } catch (error: any) {
    console.error('[Telegram Stats] Error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
