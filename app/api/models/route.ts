import { NextResponse } from 'next/server'
import { getCatalog } from '@/lib/server/catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.has('refresh')
  return NextResponse.json(await getCatalog(refresh))
}
