/**
 * POST /api/pipeline/step — выполнить один шаг интерактивного пайплайна
 * 
 * Request body:
 * {
 *   pipelineId: string,
 *   nodeId: string,
 *   context: string,
 *   modelId: string,
 *   systemPrompt: string,
 *   temperature: number,
 *   maxTokens: number
 * }
 * 
 * Response: streaming text или JSON с результатом
 */

import { getTokenCount } from '@/lib/tokenizer'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

function isLocalModel(modelId: string): boolean {
  return modelId?.startsWith('ollama/') || modelId?.startsWith('local/')
}

function extractOllamaModel(modelId: string): string {
  return modelId?.replace(/^(ollama|local)\//, '')
}

export async function POST(req: Request) {
  try {
    const { modelId, systemPrompt, userPrompt, temperature, maxTokens } = await req.json()

    console.log(`[Pipeline Step] model=${modelId}, promptLen=${userPrompt?.length || 0}`)

    // === LOCAL OLLAMA MODE ===
    if (isLocalModel(modelId)) {
      const ollamaModel = extractOllamaModel(modelId)

      const ollamaPayload = {
        model: ollamaModel,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt }
        ],
        stream: true,
        options: {
          temperature: temperature ?? 0.7,
          num_predict: maxTokens ?? 4096,
        }
      }

      const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaPayload),
      })

      if (!ollamaRes.ok) {
        const errorText = await ollamaRes.text()
        return new Response(JSON.stringify({ error: errorText }), {
          status: ollamaRes.status,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Stream response
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()

      const stream = new ReadableStream({
        async start(controller) {
          if (!ollamaRes.body) {
            controller.close()
            return
          }
          const reader = ollamaRes.body.getReader()
          let buffer = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (line.trim()) {
                  try {
                    const data = JSON.parse(line)
                    if (data.message?.content) {
                      controller.enqueue(encoder.encode(data.message.content))
                    }
                  } catch (e) { /* skip */ }
                }
              }
            }
          } finally {
            reader.releaseLock()
          }
          controller.close()
        }
      })

      return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    // === OPENROUTER MODE ===
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is missing' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const payload = {
      model: modelId || 'openai/gpt-3.5-turbo',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
      ],
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: true
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost:3000',
        'X-Title': 'AI Aggregator App',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errorText = await res.text()
      return new Response(JSON.stringify({ error: errorText }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Stream OpenRouter response
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        if (!res.body) {
          controller.close()
          return
        }
        const reader = res.body.getReader()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            const lines = text.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.slice(6))
                  const delta = data.choices?.[0]?.delta
                  if (delta?.content) {
                    controller.enqueue(encoder.encode(delta.content))
                  }
                } catch (e) { /* skip */ }
              }
            }
          }
        } finally {
          reader.releaseLock()
        }
        controller.close()
      }
    })

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (error: any) {
    console.error('Pipeline Step Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}