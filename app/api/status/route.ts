import { NextResponse } from 'next/server'
import { getServerStatus } from '@/lib/server/status'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getServerStatus())
}
