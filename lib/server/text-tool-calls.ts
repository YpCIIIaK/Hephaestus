import { extractJson } from '../json'
import type { ToolCall } from '../types'

// Часть моделей (в том числе бесплатных на OpenRouter) вызывает инструменты
// не через tool_calls, а текстом в ответе:
//   <tool_call><function=web_search><parameter=query>…</parameter></function></tool_call>
//   <tool_call>{"name": "web_search", "arguments": {"query": "…"}}</tool_call>
// Такие вызовы распознаём и выполняем как обычные.

export const TEXT_TOOL_CALL_TAG = '<tool_call'

function paramValue(raw: string): unknown {
  const v = raw.trim()
  if (/^(-?\d+(\.\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(v)) {
    try {
      return JSON.parse(v)
    } catch {
      // не JSON — оставляем строкой
    }
  }
  return v
}

function parseBlock(body: string): { name: string; args: Record<string, unknown> } | null {
  const fn = body.match(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/)
  if (fn) {
    const args: Record<string, unknown> = {}
    for (const p of fn[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) args[p[1]] = paramValue(p[2])
    return { name: fn[1], args }
  }
  const j = extractJson<{ name?: unknown; arguments?: unknown; parameters?: unknown }>(body)
  if (!j || typeof j.name !== 'string') return null
  const rawArgs = j.arguments ?? j.parameters ?? {}
  const args = typeof rawArgs === 'string' ? (extractJson<Record<string, unknown>>(rawArgs) ?? {}) : (rawArgs as Record<string, unknown>)
  return { name: j.name, args }
}

/** Вызовы инструментов, записанные текстом; неизвестные инструменты пропускаются */
export function parseTextToolCalls(text: string, toolNames: string[]): ToolCall[] {
  const calls: ToolCall[] = []
  for (const m of text.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g)) {
    const call = parseBlock(m[1])
    if (!call || !toolNames.includes(call.name)) continue
    calls.push({ id: `call_text_${calls.length}_${Date.now()}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })
  }
  return calls
}

/** Сколько символов с конца может оказаться началом тега <tool_call — их придерживаем */
export function partialTagLength(text: string): number {
  for (let n = Math.min(TEXT_TOOL_CALL_TAG.length - 1, text.length); n > 0; n--) {
    if (TEXT_TOOL_CALL_TAG.startsWith(text.slice(-n))) return n
  }
  return 0
}
