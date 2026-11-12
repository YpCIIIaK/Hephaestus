import { NextResponse } from 'next/server'
import { getOpenRouterSpend } from '@/lib/server/openrouter-spend'

export const dynamic = 'force-dynamic'

/** Расходы ключа по данным OpenRouter — для сверки аналитики и лимитов */
export async function GET(req: Request) {
  return NextResponse.json({ openrouter: await getOpenRouterSpend(new URL(req.url).searchParams.has('refresh')) })
}
