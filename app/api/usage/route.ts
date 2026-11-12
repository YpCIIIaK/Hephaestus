import { NextResponse } from 'next/server'
import { getOpenRouterSpend } from '@/lib/server/openrouter-spend'
import { getSubscriptionLimits } from '@/lib/server/sub-limits'
import { subscriptionConfig } from '@/lib/server/subscriptions'

export const dynamic = 'force-dynamic'

/** Расходы ключа по данным OpenRouter и лимиты включённых подписок — для сверки и живых лимитов */
export async function GET(req: Request) {
  const [openrouter, limits, claude, codex] = await Promise.all([
    getOpenRouterSpend(new URL(req.url).searchParams.has('refresh')),
    getSubscriptionLimits(),
    subscriptionConfig('claude-code'),
    subscriptionConfig('codex'),
  ])
  const enabled = { 'claude-code': claude.enabled, codex: codex.enabled }
  return NextResponse.json({ openrouter, subscriptions: (['claude-code', 'codex'] as const).filter((id) => enabled[id]).map((id) => limits.find((l) => l.id === id) ?? { id, windows: [], updatedAt: 0 }) })
}
