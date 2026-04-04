import { NextRequest, NextResponse } from 'next/server'
import { performSearch } from '@/lib/search-utils'
import fs from 'fs/promises'
import path from 'path'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const EXCLUDED_DIRS = ['node_modules', '.next', '.git', 'out', 'dist', '.vercel']

// Internal file operations (no HTTP needed)
async function readFileContent(filePath: string): Promise<{ content?: string; error?: string }> {
  try {
    const root = process.cwd()
    const normalizedPath = filePath.replace(/\\/g, '/')
    const fullPath = path.resolve(root, normalizedPath)
    
    if (!fullPath.startsWith(path.resolve(root))) {
      return { error: 'Access denied: Path outside workspace' }
    }
    
    const content = await fs.readFile(fullPath, 'utf-8')
    return { content }
  } catch (e: any) {
    return { error: e.message }
  }
}

async function writeFileContent(filePath: string, content: string): Promise<{ success?: boolean; bytesWritten?: number; error?: string }> {
  try {
    const root = process.cwd()
    const normalizedPath = filePath.replace(/\\/g, '/')
    const fullPath = path.resolve(root, normalizedPath)
    
    if (!fullPath.startsWith(path.resolve(root))) {
      return { error: 'Access denied: Path outside workspace' }
    }
    
    await fs.writeFile(fullPath, content, 'utf-8')
    const stats = await fs.stat(fullPath)
    return { success: true, bytesWritten: stats.size }
  } catch (e: any) {
    return { error: e.message }
  }
}

async function editFileContent(filePath: string, oldStr: string, newStr: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const readResult = await readFileContent(filePath)
    if (readResult.error) return { error: readResult.error }
    
    const content = readResult.content!
    if (!content.includes(oldStr)) {
      return { error: 'String not found in file' }
    }
    
    const newContent = content.replace(oldStr, newStr)
    const writeResult = await writeFileContent(filePath, newContent)
    return writeResult.error ? { error: writeResult.error } : { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

async function deleteFile(filePath: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const root = process.cwd()
    const normalizedPath = filePath.replace(/\\/g, '/')
    const fullPath = path.resolve(root, normalizedPath)
    
    if (!fullPath.startsWith(path.resolve(root))) {
      return { error: 'Access denied: Path outside workspace' }
    }
    
    await fs.unlink(fullPath)
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

async function listProjectFiles(): Promise<{ files?: any[]; error?: string }> {
  try {
    const root = process.cwd()
    
    async function getFiles(dir: string, rootDir: string): Promise<any[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(rootDir, fullPath)
        
        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.includes(entry.name)) return null
          const children = await getFiles(fullPath, rootDir)
          return { name: entry.name, path: relativePath, type: 'directory', children: children.filter(Boolean) }
        }
        
        return { name: entry.name, path: relativePath, type: 'file', size: (await fs.stat(fullPath)).size }
      }))
      
      return files.filter(Boolean)
    }
    
    const files = await getFiles(root, root)
    return { files }
  } catch (e: any) {
    return { error: e.message }
  }
}

function isLocalModel(modelId: string): boolean {
  return modelId?.startsWith('ollama/') || modelId?.startsWith('local/')
}

function extractOllamaModel(modelId: string): string {
  return modelId?.replace(/^(ollama|local)\//, '')
}

export async function POST(req: NextRequest) {
  try {
    const { messages, modelId, temperature, maxTokens, webSearch } = await req.json()
    
    console.log(`[IDE Chat] Request: model=${modelId}, messages=${messages?.length}, webSearch=${webSearch}`)

    // === LOCAL OLLAMA MODE ===
    if (isLocalModel(modelId)) {
      const ollamaModel = extractOllamaModel(modelId)
      const ollamaPayload = {
        model: ollamaModel,
        messages: messages,
        stream: true,
        options: {
          temperature: temperature ?? 0.7,
          num_predict: maxTokens ?? 8192,
        }
      }

      const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaPayload),
      })

      if (!ollamaRes.ok) {
        return NextResponse.json({ error: `Ollama Error: ${ollamaRes.statusText}` }, { status: ollamaRes.status })
      }

      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      
      const stream = new ReadableStream({
        async start(controller) {
          if (!ollamaRes.body) { controller.close(); return }
          const reader = ollamaRes.body.getReader()
          let buffer = ''
          let totalTokens = 0

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
                    if (data.eval_count) totalTokens = data.eval_count
                    if (data.done) {
                      controller.enqueue(encoder.encode(`\n\n[USAGE:{"prompt_tokens":${data.prompt_eval_count || 0},"completion_tokens":${totalTokens},"total_tokens":${(data.prompt_eval_count || 0) + totalTokens}}]`))
                    }
                  } catch { /* skip */ }
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
      return NextResponse.json({ error: 'OPENROUTER_API_KEY is missing' }, { status: 401 })
    }

    const makeRequest = async (currentMessages: any[], useTools: boolean) => {
      // Add date context to system message
      const dateString = new Date().toLocaleDateString('ru-RU', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Qyzylorda'
      })
      const timeString = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Qyzylorda' })
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
        max_tokens: maxTokens ?? 8192,
        stream: true,
      }

      if (useTools && webSearch) {
        payload.tools = [
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
          }
        ]
      }

      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://localhost:3000',
          'X-Title': 'Hephaestus IDE',
        },
        body: JSON.stringify(payload),
      })
    }

    // Handle tool calls chain
    const handleToolChain = async (currentMessages: any[], controller: ReadableStreamDefaultController, encoder: TextEncoder): Promise<any> => {
      let res = await makeRequest(currentMessages, true)
      
      if (!res.ok) {
        let errorDetails = ''
        try {
          const errorBody = await res.text()
          errorDetails = `\n\nDetails: ${errorBody}`
        } catch {}
        controller.enqueue(encoder.encode(`\n\n❌ [API Error: ${res.status} ${res.statusText}]${errorDetails}`))
        return null
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let isToolCall = false
      let toolCalls: Array<{id: string, name: string, args: string}> = []
      let streamedContent = ''
      let usageData: any = null

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
                  if (!toolCalls[index]) toolCalls[index] = { id: '', name: '', args: '' }
                  if (tc.id) toolCalls[index].id = tc.id
                  if (tc.function?.name) toolCalls[index].name = tc.function.name
                  if (tc.function?.arguments) toolCalls[index].args += tc.function.arguments
                }
              } else if (!isToolCall && delta?.content) {
                controller.enqueue(encoder.encode(delta.content))
                streamedContent += delta.content
              }
              
              if (data.usage) usageData = data.usage
            } catch { /* skip */ }
          }
        }
      }
      reader.releaseLock()

      // If tool calls, execute them and continue chain
      if (isToolCall && toolCalls.length > 0) {
        const toolResults: Array<{id: string, name: string, result: string, args: string}> = []
        
        for (const tc of toolCalls) {
          let parsedArgs: any
          try {
            parsedArgs = JSON.parse(tc.args.trim())
          } catch {
            controller.enqueue(encoder.encode(`\n\n[Invalid tool arguments for ${tc.name}]`))
            continue
          }
          
          const toolName = tc.name || parsedArgs._toolName || 'unknown'
          
          try {
            let toolResult: string
            
            switch (toolName) {
              case 'web_search': {
                controller.enqueue(encoder.encode(`\n\n🔍 \`[Search: ${parsedArgs.query}]\`...\n\n`))
                try {
                  let searchResults = await performSearch(parsedArgs.query)
                  toolResult = searchResults.startsWith('[Search') ? `Search failed: ${searchResults}` : searchResults
                } catch (searchErr: any) {
                  toolResult = `Search error: ${searchErr.message}`
                }
                break
              }
              
              case 'read_file': {
                controller.enqueue(encoder.encode(`\n\n📄 \`[Read: ${parsedArgs.filePath}]\`...\n\n`))
                try {
                  const result = await readFileContent(parsedArgs.filePath)
                  if (result.error) {
                    toolResult = `❌ Failed to read file: ${parsedArgs.filePath}\nError: ${result.error}`
                  } else {
                    toolResult = result.content!
                  }
                } catch (fileErr: any) {
                  toolResult = `❌ Failed to read file: ${parsedArgs.filePath}\nError: ${fileErr.message}`
                }
                break
              }
              
              case 'write_file': {
                controller.enqueue(encoder.encode(`\n\n✏️ \`[Write: ${parsedArgs.filePath}]\`...\n\n`))
                try {
                  const result = await writeFileContent(parsedArgs.filePath, parsedArgs.content)
                  if (result.error) {
                    toolResult = `❌ Failed to write file: ${parsedArgs.filePath}\nError: ${result.error}`
                  } else {
                    toolResult = `✅ Wrote ${result.bytesWritten} bytes to ${parsedArgs.filePath}`
                  }
                } catch (writeErr: any) {
                  toolResult = `❌ Failed to write file: ${parsedArgs.filePath}\nError: ${writeErr.message}`
                }
                break
              }
              
              case 'edit_file': {
                controller.enqueue(encoder.encode(`\n\n✏️ \`[Edit: ${parsedArgs.filePath}]\`...\n\n`))
                try {
                  const result = await editFileContent(parsedArgs.filePath, parsedArgs.oldStr, parsedArgs.newStr)
                  if (result.error) {
                    toolResult = `❌ Failed to edit file: ${parsedArgs.filePath}\nError: ${result.error}`
                  } else {
                    toolResult = `✅ Edited ${parsedArgs.filePath} successfully`
                  }
                } catch (editErr: any) {
                  toolResult = `❌ Failed to edit file: ${parsedArgs.filePath}\nError: ${editErr.message}`
                }
                break
              }
              
              case 'delete_file': {
                controller.enqueue(encoder.encode(`\n\n🗑️ \`[Delete: ${parsedArgs.filePath}]\`...\n\n`))
                try {
                  const result = await deleteFile(parsedArgs.filePath)
                  if (result.error) {
                    toolResult = `❌ Failed to delete file: ${parsedArgs.filePath}\nError: ${result.error}`
                  } else {
                    toolResult = `✅ Deleted ${parsedArgs.filePath}`
                  }
                } catch (deleteErr: any) {
                  toolResult = `❌ Failed to delete file: ${parsedArgs.filePath}\nError: ${deleteErr.message}`
                }
                break
              }
              
              case 'list_files': {
                controller.enqueue(encoder.encode(`\n\n📁 \`[List files]\`...\n\n`))
                try {
                  const result = await listProjectFiles()
                  if (result.error) {
                    toolResult = `❌ Failed to list files\nError: ${result.error}`
                  } else {
                    toolResult = result.files!.map((f: any) => f.path).join('\n')
                  }
                } catch (listErr: any) {
                  toolResult = `❌ Failed to list files\nError: ${listErr.message}`
                }
                break
              }
              
              default: {
                toolResult = `❌ Unknown tool: ${toolName}\nAvailable tools: web_search, read_file, write_file, edit_file, delete_file, list_files`
              }
            }
            
            toolResults.push({ id: tc.id, name: toolName, result: toolResult, args: tc.args })
          } catch (e: any) {
            const fullError = `❌ Error executing ${toolName}:\n${e.message}\nStack: ${e.stack || 'N/A'}`
            controller.enqueue(encoder.encode(`\n\n${fullError}`))
            toolResults.push({ id: tc.id, name: toolName, result: fullError, args: tc.args })
          }
        }
        
        // Build messages with tool results and continue chain
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
        
        return await handleToolChain(updatedMessages, controller, encoder)
      }

      return { usageData, streamedContent }
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await handleToolChain(messages, controller, encoder)
          if (result?.usageData) {
            controller.enqueue(encoder.encode(`\n\n[USAGE:${JSON.stringify(result.usageData)}]`))
          }
        } catch (e: any) {
          const fullError = `❌ Fatal Error:\n${e.message}\nStack: ${e.stack || 'N/A'}`
          controller.enqueue(encoder.encode(`\n\n${fullError}`))
          console.error('[IDE Chat] Fatal error:', e)
        }
        controller.close()
      }
    })

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (error: any) {
    console.error('IDE Chat API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}