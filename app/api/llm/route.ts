import { z } from 'zod'
import { runLLM } from '@/lib/server/llm'
import { parseBody, rejectCrossSite } from '@/lib/server/http'
import type { LLMEvent } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

const message = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
})

const schema = z.object({
  model: z.string().min(1),
  messages: z.array(message).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(200_000).optional(),
  tools: z.array(z.enum(['web', 'files_read', 'files_write', 'knowledge', 'skills'])).optional(),
  jsonMode: z.boolean().optional(),
  maxToolSteps: z.number().int().min(0).max(20).optional(),
})

export async function POST(req: Request) {
  const denied = rejectCrossSite(req)
  if (denied) return denied
  const parsed = await parseBody(req, schema)
  if ('error' in parsed) return parsed.error

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: LLMEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
      try {
        for await (const event of runLLM(parsed.data, req.signal)) send(event)
      } catch (e) {
        if (!req.signal.aborted) send({ t: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        try {
          controller.close()
        } catch {
          // клиент уже отключился
        }
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
