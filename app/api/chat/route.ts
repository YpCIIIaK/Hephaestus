import { performSearch } from '@/lib/search-utils'

export async function POST(req: Request) {
  try {
    const { messages, modelId, temperature, maxTokens, webSearch } = await req.json();
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is missing' }), { 
        status: 401, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    console.log(`[API] Chat Request: model=${modelId}, messages=${messages?.length}, webSearch=${webSearch}`);

    const makeRequest = async (currentMessages: any[], useTools: boolean, usePlugins: boolean) => {
      const dateString = new Date().toLocaleDateString('ru-RU', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Yekaterinburg'
      });
      const timeString = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Yekaterinburg' });
      const dateContext = `Current date and time: ${dateString}, ${timeString}.`;

      const msgs = [...currentMessages];
      if (msgs.length > 0 && msgs[0].role === 'system') {
        msgs[0] = { ...msgs[0], content: `${dateContext}\n\n${msgs[0].content}` };
      } else {
        msgs.unshift({ role: 'system', content: dateContext });
      }

      const payload: any = {
        model: modelId || 'openai/gpt-3.5-turbo',
        messages: msgs,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 4096,
        stream: true
      };

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
        ];
      } else if (usePlugins && webSearch) {
        payload.plugins = [{ id: "web", max_results: 5 }];
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
      });
    };

    let res = await makeRequest(messages, true, false);

    if (!res.ok) {
      const errorText = await res.text();
      if ((res.status === 400 || res.status === 404) && errorText.toLowerCase().includes('tool')) {
        res = await makeRequest(messages, false, true);
        if (!res.ok) {
          return new Response(JSON.stringify({ error: `OpenRouter Error: ${res.statusText}` }), { status: res.status });
        }
      } else {
        return new Response(JSON.stringify({ error: `OpenRouter Error: ${res.statusText}` }), { 
          status: res.status, headers: { 'Content-Type': 'application/json' } 
        });
      }
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const processStream = async (responseToRead: Response) => {
          if (!responseToRead.body) return null;
          const reader = responseToRead.body.getReader();
          let buffer = '';
          let isToolCall = false;
          let toolCallId = '';
          let toolArgs = '';
          let toolName = '';
          let streamedContent = '';
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.slice(6));
                  const delta = data.choices?.[0]?.delta;
                  
                  if (delta?.tool_calls) {
                    isToolCall = true;
                    const tc = delta.tool_calls[0];
                    if (tc.id) toolCallId = tc.id;
                    if (tc.function?.name) toolName = tc.function.name;
                    if (tc.function?.arguments) toolArgs += tc.function.arguments;
                  } else if (!isToolCall && delta?.content) {
                    controller.enqueue(encoder.encode(delta.content));
                    streamedContent += delta.content;
                  }
                } catch (e) { }
              }
            }
          }
          
          if (isToolCall) return { toolCallId, toolArgs, toolName, streamedContent };
          return null;
        };

        // Recursive tool chain handler - supports multi-step workflows
        const handleToolChain = async (currentMessages: any[]): Promise<boolean> => {
          const apiRes = await makeRequest(currentMessages, true, false);
          
          if (!apiRes.ok) {
            controller.enqueue(encoder.encode(`\n\n[Error: ${apiRes.statusText}]`));
            return false;
          }
          
          const toolCallInfo = await processStream(apiRes);
          
          if (!toolCallInfo || !toolCallInfo.toolArgs) {
            return true; // Conversation complete
          }
          
          // Validate JSON before parsing
          let parsedArgs: any;
          try {
            const trimmedArgs = toolCallInfo.toolArgs.trim();
            console.log('[Tool Debug] Raw args:', trimmedArgs);
            console.log('[Tool Debug] Tool name:', toolCallInfo.toolName);
            
            // Check if looks like complete JSON object
            if (!trimmedArgs.startsWith('{') || !trimmedArgs.endsWith('}')) {
              throw new Error(`Incomplete JSON: starts with "${trimmedArgs.slice(0, 10)}...", ends with "...${trimmedArgs.slice(-10)}"`);
            }
            parsedArgs = JSON.parse(trimmedArgs);
          } catch (jsonErr: any) {
            controller.enqueue(encoder.encode(`\n\n❌ [Invalid tool arguments: ${jsonErr.message}]`));
            console.error('[Tool Error] Raw args:', toolCallInfo.toolArgs);
            console.error('[Tool Error] Parse error:', jsonErr);
            return false;
          }
          
          const toolName = toolCallInfo.toolName || parsedArgs._toolName || 'unknown';
          
          try {
            let toolResult: string;
            
            switch (toolName) {
              case 'web_search': {
                controller.enqueue(encoder.encode(`\n\n🔍 \`[Search: ${parsedArgs.query}]\`...\n\n`));
                let searchResults = await performSearch(parsedArgs.query);
                toolResult = searchResults.startsWith('[Search') ? 'Search failed' : searchResults;
                break;
              }
              
              case 'read_file': {
                controller.enqueue(encoder.encode(`\n\n📄 \`[Read: ${parsedArgs.filePath}]\`...\n\n`));
                const fileRes = await fetch(`http://localhost:3000/api/files`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: parsedArgs.filePath })
                });
                const fileData = await fileRes.json();
                toolResult = fileRes.ok ? fileData.content : `Error: ${fileData.error}`;
                break;
              }
              
              case 'write_file': {
                controller.enqueue(encoder.encode(`\n\n✏️ \`[Write: ${parsedArgs.filePath}]\`...\n\n`));
                const editRes = await fetch(`http://localhost:3000/api/files/edit`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: parsedArgs.filePath, operation: 'write', content: parsedArgs.content })
                });
                const result = await editRes.json();
                toolResult = result.success ? `Wrote ${result.bytesWritten} bytes` : `Error: ${result.error}`;
                break;
              }
              
              case 'edit_file': {
                controller.enqueue(encoder.encode(`\n\n✏️ \`[Edit: ${parsedArgs.filePath}]\`...\n\n`));
                const editRes = await fetch(`http://localhost:3000/api/files/edit`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: parsedArgs.filePath, operation: 'edit', oldStr: parsedArgs.oldStr, newStr: parsedArgs.newStr })
                });
                const result = await editRes.json();
                toolResult = result.success ? 'Edited successfully' : `Error: ${result.error}`;
                break;
              }
              
              case 'delete_file': {
                controller.enqueue(encoder.encode(`\n\n🗑️ \`[Delete: ${parsedArgs.filePath}]\`...\n\n`));
                const editRes = await fetch(`http://localhost:3000/api/files/edit`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: parsedArgs.filePath, operation: 'delete' })
                });
                const result = await editRes.json();
                toolResult = result.success ? 'Deleted successfully' : `Error: ${result.error}`;
                break;
              }
              
              case 'list_files': {
                controller.enqueue(encoder.encode(`\n\n📁 \`[List files]\`...\n\n`));
                const filesRes = await fetch(`http://localhost:3000/api/files`);
                const filesData = await filesRes.json();
                toolResult = filesRes.ok ? filesData.files.map((f: any) => f.path).join('\n') : 'Failed to list files';
                break;
              }
              
              default: {
                toolResult = `Unknown tool: ${toolName}`;
              }
            }
            
            const updatedMessages = [
              ...currentMessages,
              { role: 'assistant', content: null, tool_calls: [{ id: toolCallInfo.toolCallId, type: 'function', function: { name: toolName, arguments: toolCallInfo.toolArgs } }] },
              { role: 'tool', tool_call_id: toolCallInfo.toolCallId, name: toolName, content: toolResult }
            ];
            
            // Continue chain - ИИ может захотеть сделать ещё один tool call
            return await handleToolChain(updatedMessages);
            
          } catch (e: any) {
            controller.enqueue(encoder.encode(`\n\n❌ [Error: ${e.message}]`));
            return false;
          }
        };

        await handleToolChain(messages);
        controller.close();
      }
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error: any) {
    console.error('Chat API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
