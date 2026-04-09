import { performSearch } from '@/lib/search-utils'
import { getVectorStore } from '@/lib/simple-vector-store'
import { skillLoader, createSkillTool } from '@/lib/skills'

// Ollama local configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

// Get base URL for internal API calls
function getBaseUrl(): string {
  const port = process.env.PORT || '3000'
  return `http://localhost:${port}`
}

// Check if modelId uses local Ollama
function isLocalModel(modelId: string): boolean {
  return modelId?.startsWith('ollama/') || modelId?.startsWith('local/')
}

function extractOllamaModel(modelId: string): string {
  return modelId?.replace(/^(ollama|local)\//, '')
}

export async function POST(req: Request) {
  try {
    const { messages, modelId, temperature, maxTokens, webSearch } = await req.json()
    
    console.log(`[API] Chat Request: model=${modelId}, messages=${messages?.length}, webSearch=${webSearch}`)

    // === LOCAL OLLAMA MODE ===
    if (isLocalModel(modelId)) {
      const ollamaModel = extractOllamaModel(modelId)
      console.log(`[Ollama] Using local model: ${ollamaModel}`)

      const ollamaPayload = {
        model: ollamaModel,
        messages: messages,
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
        return new Response(JSON.stringify({ 
          error: `Ollama Error: ${ollamaRes.statusText}`, 
          details: errorText 
        }), { 
          status: ollamaRes.status, 
          headers: { 'Content-Type': 'application/json' } 
        })
      }

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
                    if (data.done) {
                      console.log(`[Ollama] Complete. Total tokens: ~${data.eval_count || '?'}`)
                    }
                  } catch (e) {
                    // Skip malformed lines
                  }
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
      });
    }

    const makeRequest = async (currentMessages: any[], useTools: boolean, usePlugins: boolean) => {
      const dateString = new Date().toLocaleDateString('ru-RU', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Yekaterinburg'
      })
      const timeString = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })
      const dateContext = `Current date and time: ${dateString}, ${timeString}.`

      const msgs = [...currentMessages]
      if (msgs.length > 0 && msgs[0].role === 'system') {
        msgs[0] = { ...msgs[0], content: `${dateContext}\n\n${msgs[0].content}` }
      } else {
        msgs.unshift({ role: 'system', content: dateContext })
      }

      const payload: any = {
        model: modelId || 'openai/gpt-3.5-turbo',
        messages: msgs,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 4096,
        stream: true
      }

      // Base tools
      const baseTools = [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web for up-to-date information.",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
          }
        },
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read file contents.",
            parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] }
          }
        },
        {
          type: "function",
          function: {
            name: "write_file",
            description: "Create or overwrite file.",
            parameters: { 
              type: "object", 
              properties: { filePath: { type: "string" }, content: { type: "string" } }, 
              required: ["filePath", "content"] 
            }
          }
        },
        {
          type: "function",
          function: {
            name: "edit_file",
            description: "Edit existing file.",
            parameters: { 
              type: "object", 
              properties: { filePath: { type: "string" }, oldStr: { type: "string" }, newStr: { type: "string" } }, 
              required: ["filePath", "oldStr", "newStr"] 
            }
          }
        },
        {
          type: "function",
          function: {
            name: "delete_file",
            description: "Delete a file.",
            parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] }
          }
        },
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List project files.",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "rag_search",
            description: "Search indexed project files for relevant content.",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
          }
        }
      ]

      // Add skill tool if skills are available
      const skills = skillLoader.getAllMetadata()
      const skillTool = createSkillTool(skills)
      const tools = skillTool ? [...baseTools, skillTool] : baseTools

      if (useTools && webSearch) {
        payload.tools = tools
      } else if (usePlugins && webSearch) {
        payload.plugins = [{ id: "web", max_results: 5 }]
      }

      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://localhost:3000',
          'X-Title': 'AI Aggregator App',
        },
        body: JSON.stringify(payload),
      })
    };

    let res = await makeRequest(messages, true, false)

    if (!res.ok) {
      const errorText = await res.text()
      if ((res.status === 400 || res.status === 404) && errorText.toLowerCase().includes('tool')) {
        res = await makeRequest(messages, false, true)
        if (!res.ok) {
          return new Response(JSON.stringify({ error: `OpenRouter Error: ${res.statusText}` }), { status: res.status })
        }
      } else {
        return new Response(JSON.stringify({ error: `OpenRouter Error: ${res.statusText}` }), { 
          status: res.status, headers: { 'Content-Type': 'application/json' } 
        })
      }
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        const processStream = async (responseToRead: Response) => {
          if (!responseToRead.body) return null
          const reader = responseToRead.body.getReader()
          let buffer = ''
          let isToolCall = false
          let toolCalls: Array<{id: string, name: string, args: string}> = []
          let streamedContent = ''
          
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.slice(6))
                  const delta = data.choices?.[0]?.delta
                  
                  if (delta?.tool_calls) {
                    isToolCall = true
                    for (const tc of delta.tool_calls) {
                      const index = tc.index || 0
                      if (!toolCalls[index]) {
                        toolCalls[index] = { id: '', name: '', args: '' }
                      }
                      if (tc.id) toolCalls[index].id = tc.id
                      if (tc.function?.name) toolCalls[index].name = tc.function.name
                      if (tc.function?.arguments) toolCalls[index].args += tc.function.arguments
                    }
                  } else if (!isToolCall && delta?.content) {
                    controller.enqueue(encoder.encode(delta.content))
                    streamedContent += delta.content
                  }
                } catch (e) { }
              }
            }
          }
          
          if (isToolCall && toolCalls.length > 0) {
            return { toolCalls, streamedContent }
          }
          return null
        }

        // Recursive tool chain handler
        const handleToolChain = async (currentMessages: any[]): Promise<boolean> => {
          const apiRes = await makeRequest(currentMessages, true, false)
          
          if (!apiRes.ok) {
            controller.enqueue(encoder.encode(`\n\n[Error: ${apiRes.statusText}]`))
            return false
          }
          
          const toolCallInfo = await processStream(apiRes)
          
          if (!toolCallInfo || !toolCallInfo.toolCalls || toolCallInfo.toolCalls.length === 0) {
            return true
          }
          
          const toolResults: Array<{id: string, name: string, result: string, args: string}> = []
          
          for (const tc of toolCallInfo.toolCalls) {
            let parsedArgs: any
            try {
              const trimmedArgs = tc.args.trim()
              console.log('[Tool Debug] Raw args:', trimmedArgs)
              console.log('[Tool Debug] Tool name:', tc.name)
              
              if (!trimmedArgs.startsWith('{') || !trimmedArgs.endsWith('}')) {
                throw new Error(`Incomplete JSON: starts with "${trimmedArgs.slice(0, 10)}..."`)
              }
              parsedArgs = JSON.parse(trimmedArgs)
            } catch (jsonErr: any) {
              controller.enqueue(encoder.encode(`\n\n❌ [Invalid tool arguments for ${tc.name}: ${jsonErr.message}]`))
              console.error('[Tool Error] Raw args:', tc.args)
              continue
            }
            
            const toolName = tc.name || parsedArgs._toolName || 'unknown'
            
            try {
              let toolResult: string
              
              switch (toolName) {
                case 'web_search': {
                  controller.enqueue(encoder.encode(`\n\n🔍 \`[Search: ${parsedArgs.query}]\`...\n\n`))
                  let searchResults = await performSearch(parsedArgs.query)
                  toolResult = searchResults.startsWith('[Search') ? 'Search failed' : searchResults
                  break
                }
                
                case 'read_file': {
                  controller.enqueue(encoder.encode(`\n\n📄 \`[Read: ${parsedArgs.filePath}]\`...\n\n`))
                  const fileRes = await fetch(`${getBaseUrl()}/api/files`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: parsedArgs.filePath })
                  })
                  const fileData = await fileRes.json()
                  toolResult = fileRes.ok ? fileData.content : `Error: ${fileData.error}`
                  break
                }
                
                case 'write_file': {
                  controller.enqueue(encoder.encode(`\n\n✏️ \`[Write: ${parsedArgs.filePath}]\`...\n\n`))
                  const editRes = await fetch(`${getBaseUrl()}/api/files/edit`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: parsedArgs.filePath, operation: 'write', content: parsedArgs.content })
                  })
                  const result = await editRes.json()
                  toolResult = result.success ? `Wrote ${result.bytesWritten} bytes` : `Error: ${result.error}`
                  break
                }
                
                case 'edit_file': {
                  controller.enqueue(encoder.encode(`\n\n✏️ \`[Edit: ${parsedArgs.filePath}]\`...\n\n`))
                  const editRes = await fetch(`${getBaseUrl()}/api/files/edit`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: parsedArgs.filePath, operation: 'edit', oldStr: parsedArgs.oldStr, newStr: parsedArgs.newStr })
                  })
                  const result = await editRes.json()
                  toolResult = result.success ? 'Edited successfully' : `Error: ${result.error}`
                  break
                }
                
                case 'delete_file': {
                  controller.enqueue(encoder.encode(`\n\n🗑️ \`[Delete: ${parsedArgs.filePath}]\`...\n\n`))
                  const editRes = await fetch(`${getBaseUrl()}/api/files/edit`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: parsedArgs.filePath, operation: 'delete' })
                  })
                  const result = await editRes.json()
                  toolResult = result.success ? 'Deleted successfully' : `Error: ${result.error}`
                  break
                }
                
                case 'list_files': {
                  controller.enqueue(encoder.encode(`\n\n📁 \`[List files]\`...\n\n`))
                  const filesRes = await fetch(`${getBaseUrl()}/api/files`)
                  const filesData = await filesRes.json()
                  toolResult = filesRes.ok ? filesData.files.map((f: any) => f.path).join('\n') : 'Failed to list files'
                  break
                }
                
                case 'rag_search': {
                  controller.enqueue(encoder.encode(`\n\n🔍 \`[RAG Search: ${parsedArgs.query}]\`...\n\n`))
                  try {
                    const store = getVectorStore()
                    const searchResults = store.search(parsedArgs.query, 5)
                    if (searchResults.length === 0) {
                      toolResult = 'No indexed documents found. Use RAG indexing first.'
                    } else {
                      toolResult = searchResults.map((r, i) => 
                        `[${i+1}] ${r.document} (score: ${r.score.toFixed(2)}):\n${r.chunk.text.slice(0, 500)}`
                      ).join('\n\n---\n\n')
                    }
                  } catch (e: any) {
                    toolResult = `RAG search error: ${e.message}`
                  }
                  break
                }
                
                case 'skill': {
                  controller.enqueue(encoder.encode(`\n\n📚 \`[Load Skill: ${parsedArgs.skill_name}]\`...\n\n`))
                  const skill = skillLoader.getSkill(parsedArgs.skill_name)
                  if (skill) {
                    toolResult = `# ${skill.metadata.name}\n\n${skill.metadata.description}\n\n${skill.content}`
                  } else {
                    toolResult = `Error: Skill '${parsedArgs.skill_name}' not found. Available skills: ${skills.map(s => s.id).join(', ')}`
                  }
                  break
                }
                
                default: {
                  toolResult = `Unknown tool: ${toolName}`
                }
              }
              
              toolResults.push({ id: tc.id, name: toolName, result: toolResult, args: tc.args })
              
            } catch (e: any) {
              controller.enqueue(encoder.encode(`\n\n❌ [Error executing ${toolName}: ${e.message}]`))
              toolResults.push({ id: tc.id, name: toolName, result: `Error: ${e.message}`, args: tc.args })
            }
          }
          
          const updatedMessages = [
            ...currentMessages,
            { 
              role: 'assistant', 
              content: null, 
              tool_calls: toolResults.map(tr => ({ 
                id: tr.id, 
                type: 'function', 
                function: { name: tr.name, arguments: tr.args } 
              })) 
            },
            ...toolResults.map(tr => ({ 
              role: 'tool', 
              tool_call_id: tr.id, 
              name: tr.name, 
              content: tr.result 
            }))
          ]
          
          return await handleToolChain(updatedMessages)
        }

        await handleToolChain(messages)
        controller.close()
      }
    })

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (error: any) {
    console.error('Chat API Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}