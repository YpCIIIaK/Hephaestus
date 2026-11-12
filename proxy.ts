import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedHost } from './lib/host-check'

export function proxy(req: NextRequest) {
  if (!isAllowedHost(req.headers.get('host'), process.env.HEPHAESTUS_ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Hephaestus принимает запросы только с localhost (см. HEPHAESTUS_ALLOWED_HOSTS)' }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
