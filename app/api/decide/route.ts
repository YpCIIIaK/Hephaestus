import { NextResponse } from 'next/server'
import { z } from 'zod'
import { decide, DecisionError } from '@/lib/server/decisions'
import { errorMessage, jsonError, parseBody, rejectCrossSite } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

// Модели решений: выбор варианта, да/нет, оценка по шкале — с вероятностями
const text = z.string().max(4000)
const question = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), instructions: text.optional(), criteria: z.record(z.string().min(1).max(100), text).refine((c) => Object.keys(c).length >= 2, 'нужно минимум два варианта') }),
  z.object({ type: z.literal('noul'), instructions: text.optional(), criteria: z.object({ true: text.optional(), false: text.optional() }).optional() }),
  z.object({ type: z.literal('score'), instructions: text.optional(), criteria: z.array(text).min(2).max(20) }),
])

const schema = z.object({
  model: z.string().regex(/^~?[\w.-]+\/[\w.:-]+$/, 'некорректный id модели'),
  state: z.union([z.string().max(1_000_000), z.record(z.string(), z.unknown())]),
  questions: z.record(z.string().min(1).max(64), question).refine((q) => Object.keys(q).length >= 1 && Object.keys(q).length <= 20, 'от 1 до 20 вопросов'),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error
  try {
    return NextResponse.json(await decide(parsed.data, req.signal))
  } catch (e) {
    return jsonError(errorMessage(e), e instanceof DecisionError && e.status ? e.status : 500)
  }
}
