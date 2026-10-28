import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'

// Приложение рассчитано на локальный запуск, но браузер пользователя может
// открыть чужой сайт, который попробует дёрнуть http://localhost:3000/api/...
// Поэтому запросы с чужих источников отклоняем.
export function rejectCrossSite(req: Request): Response | null {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'Запрос с чужого сайта отклонён' }, { status: 403 })
  }
  const origin = req.headers.get('origin')
  if (origin) {
    const host = req.headers.get('host')
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: 'Запрос с чужого сайта отклонён' }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: 'Некорректный Origin' }, { status: 403 })
    }
  }
  return null
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { error: Response }> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { error: jsonError('Тело запроса должно быть JSON') }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: jsonError(`Некорректный запрос: ${issue?.path.join('.') || 'body'} — ${issue?.message}`) }
  }
  return { data: parsed.data }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
