'use client'

import { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react'
import { useArenaStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { 
  Send, 
  Trash2, 
  Copy, 
  Check,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Sparkles,
  Zap,
  Clock,
  User,
  Plus,
  Network,
  Bot,
  MessageSquare,
  Shield,
  Combine,
  X,
  History,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  StopCircle,
  FileText,
  Table2,
  Download,
  Paperclip,
  File
} from 'lucide-react'
import { downloadCSV, downloadPDF } from '@/lib/export-utils'
import { ModelResponse, ArenaConfig } from '@/lib/types'
import { executePipeline, getTopologicalOrder } from '@/lib/executor'
import { MarkdownRenderer } from '@/components/markdown-renderer'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(type: string, name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const isImage = type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)
  const isPdf = ext === 'pdf'
  const isCode = ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'css', 'html', 'json', 'yaml', 'xml', 'sql'].includes(ext)
  
  if (isImage) return '🖼️'
  if (isPdf) return '📄'
  if (isCode) return '💻'
  return '📎'
}

const providerColors: Record<string, string> = {
  openai: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  anthropic: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  google: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  meta: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  mistral: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  custom: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
}

const providerIcons: Record<string, string> = {
  openai: '◆',
  anthropic: '◇',
  google: '●',
  meta: '◈',
  mistral: '◉',
  custom: '○',
}

export function ChatPanel() {
  const models = useArenaStore(state => state.models)
  const configs = useArenaStore(state => state.configs)
  const messages = useArenaStore(state => state.messages)
  const responses = useArenaStore(state => state.responses)
  const addMessage = useArenaStore(state => state.addMessage)
  const addResponse = useArenaStore(state => state.addResponse)
  const updateResponse = useArenaStore(state => state.updateResponse)
  const removeResponse = useArenaStore(state => state.removeResponse)
  const clearChat = useArenaStore(state => state.clearChat)
  const startNewChat = useArenaStore(state => state.startNewChat)
  const historicalChats = useArenaStore(state => state.historicalChats)
  const loadHistoricalChat = useArenaStore(state => state.loadHistoricalChat)
  const deleteHistoricalChat = useArenaStore(state => state.deleteHistoricalChat)
  
  const activeConfigId = useArenaStore(state => state.activeConfigId)
  const abortGeneration = useArenaStore(state => state.abortGeneration)
  const setAbortController = useArenaStore(state => state.setAbortController)
  const messageQueue = useArenaStore(state => state.messageQueue)
  const enqueueMessage = useArenaStore(state => state.enqueueMessage)
  const dequeueMessage = useArenaStore(state => state.dequeueMessage)

  interface AttachedFile {
    name: string
    size: number
    type: string
    text: string
    isProcessing: boolean
    error?: string
  }

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadingFiles, setUploadingFiles] = useState<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaContainerRef = useRef<HTMLDivElement>(null)
  const chatMode = useArenaStore(state => state.chatMode)
  const setChatMode = useArenaStore(state => state.setChatMode)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const enabledModels = useMemo(() => models.filter(m => m.enabled && m.level === 1), [models])

  const handleFileUpload = async (files: FileList | File[]) => {
    const fileList = Array.from(files)
    const newFiles: AttachedFile[] = fileList.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      text: '',
      isProcessing: true
    }))
    
    setAttachedFiles(prev => [...prev, ...newFiles])
    setUploadingFiles(true)
    
    try {
      const formData = new FormData()
      fileList.forEach(file => formData.append('files', file))
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Upload failed')
      }
      
      const data = await res.json()
      
      setAttachedFiles(prev => 
        prev.map(f => {
          const uploaded = data.files.find((u: any) => u.filename === f.name)
          if (uploaded) {
            return {
              ...f,
              text: uploaded.text,
              isProcessing: false,
              error: uploaded.error
            }
          }
          return f
        })
      )
    } catch (error: any) {
      console.error('File upload error:', error)
      setAttachedFiles(prev => 
        prev.map(f => ({
          ...f,
          isProcessing: false,
          error: error.message || 'Upload failed'
        }))
      )
    } finally {
      setUploadingFiles(false)
    }
  }

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleSubmit = async (overrideInput?: string) => {
    const textToSubmit = overrideInput || input
    
    // Build context from attached files
    const filesContext = attachedFiles
      .filter(f => f.text && !f.isProcessing)
      .map(f => `--- FILE: ${f.name} (${formatFileSize(f.size)}) ---\n${f.text}`)
      .join('\n\n')
    
    const fullInput = filesContext 
      ? `${textToSubmit}\n\n--- ATTACHED FILES CONTEXT ---\n${filesContext}` 
      : textToSubmit
    
    if (!textToSubmit.trim() && attachedFiles.length === 0) return

    if (isLoading) {
      enqueueMessage(fullInput)
      setInput('')
      setAttachedFiles([])
      return
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: textToSubmit || `[Attached ${attachedFiles.length} file(s)]`,
      timestamp: new Date().toISOString(),
      attachedFiles: attachedFiles.map(f => ({ name: f.name, size: f.size, text: f.text }))
    }
    const msgId = userMessage.id
    
    addMessage(userMessage)
    if (!overrideInput) setInput('')
    setAttachedFiles([])
    setIsLoading(true)

    if (chatMode === 'models') {
      const activeControllers: AbortController[] = []
      enabledModels.forEach((model) => {
        const respId = `resp-${model.id}-${Date.now()}`
        addResponse({
          id: respId,
          modelId: model.id,
          modelName: model.name,
          messageId: msgId,
          content: '',
          status: 'pending',
        })
        // Use fullInput which includes attached files context
        simulateModelResponse(respId, model.id, fullInput)
      })
    } else if (chatMode.startsWith('pipeline:')) {
      const configId = chatMode.split(':')[1]
      const config = configs.find(c => c.id === configId)
      if (config) {
        // Use fullInput which includes attached files context
        runPipelineInChat(config, fullInput, msgId)
      } else {
        setIsLoading(false)
      }
    }
  }

  const runPipelineInChat = async (config: ArenaConfig, userPrompt: string, msgId: string, existingResponseId?: string) => {
    const runId = existingResponseId || `run-${Date.now()}`
    
    const topoOrder = getTopologicalOrder(config.nodes, config.edges)
    
    // Collect existing completed results if we are resuming
    const existingResp = existingResponseId ? useArenaStore.getState().responses.find(r => r.id === existingResponseId) : null
    const initialResults: Record<string, string> = {}
    if (existingResp?.pipelineSteps) {
      existingResp.pipelineSteps.forEach(s => {
        if (s.status === 'completed' && s.result) {
          initialResults[s.nodeId] = s.result
        }
      })
    }

    const initialSteps = topoOrder.map((nodeId: string) => {
      const node = config.nodes.find(n => n.id === nodeId)!
      const existingStep = existingResp?.pipelineSteps?.find(s => s.nodeId === nodeId)
      
      return { 
        nodeId, 
        label: node.data.label, 
        type: node.type, 
        modelId: node.data.model?.id,
        modelName: node.data.model?.name || node.data.model?.id,
        status: (existingStep?.status === 'completed') ? 'completed' as const : 'idle' as const,
        result: existingStep?.result,
        tokens: existingStep?.tokens,
        latencyMs: existingStep?.latencyMs,
        promptTokens: existingStep?.promptTokens,
        completionTokens: existingStep?.completionTokens,
        promptCost: existingStep?.promptCost,
        completionCost: existingStep?.completionCost
      }
    })

    if (!existingResponseId) {
      addResponse({
        id: runId,
        modelId: runId,
        modelName: `Pipeline: ${config.name}`,
        messageId: msgId,
        content: '',
        status: 'streaming',
        pipelineSteps: initialSteps
      })
    } else {
      updateResponse(runId, { status: 'streaming', pipelineSteps: initialSteps, content: '' })
    }

    const startTime = Date.now()
    const abortController = new AbortController()
    setAbortController(abortController)

    try {
      const { results } = await executePipeline(config.nodes, config.edges, userPrompt, (nodeId, status, nodeResult, tokens, latencyMs, promptTokens, completionTokens, promptCost, completionCost, startTime, endTime) => {
        const currentResp = useArenaStore.getState().responses.find(r => r.id === runId)
        if (!currentResp) return

        const newSteps = (currentResp.pipelineSteps || []).map(s =>
          s.nodeId === nodeId
            ? {
                ...s,
                status: status as any,
                result: nodeResult,
                tokens,
                latencyMs,
                promptTokens,
                completionTokens,
                promptCost,
                completionCost,
                startTime,
                endTime,
              }
            : s
        )
        useArenaStore.getState().updateResponse(runId, { pipelineSteps: newSteps })
      }, initialResults, abortController.signal)

      const aggNode = config.nodes.find(n => n.type === 'aggregator')
      const valNode = config.nodes.find(n => n.type === 'validator')
      const mNodes = config.nodes.filter(n => n.type === 'model')

      const getResult = (nodeId: string | undefined) =>
        nodeId && results[nodeId] && !results[nodeId].startsWith('[Error]') ? results[nodeId] : null

      const finalResult =
        getResult(aggNode?.id) ??
        getResult(valNode?.id) ??
        mNodes.map(n => getResult(n.id)).find(Boolean) ??
        Object.values(results).join('\n\n') ??
        'Pipeline finished with no output.'

      // Sum all tokens from all nodes in the results
      const totalTokens = Object.values(results).reduce((acc, text) => {
        // Simple heuristic for nodes that don't report tokens directly
        return acc + Math.ceil((text?.length || 0) / 3.5)
      }, 0)
      
      useArenaStore.getState().updateResponse(runId, {
        status: 'complete',
        content: finalResult,
        tokens: totalTokens,
        latency: Date.now() - startTime
      })
    } catch (err: any) {
      useArenaStore.getState().updateResponse(runId, {
        status: 'error',
        content: `Pipeline error: ${err.message}`
      })
    } finally {
      setIsLoading(false)
      setAbortController(null)
    }
  }

  const simulateModelResponse = useCallback(async (respId: string, modelId: string, prompt: string) => {
    updateResponse(respId, { status: 'streaming' })
    const abortController = new AbortController()
    setAbortController(abortController)
    
    try {
      const startTime = Date.now()
      const model = useArenaStore.getState().models.find(m => m.id === modelId)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          modelId,
          messages: [{ role: 'user', content: prompt }],
          webSearch: model?.webSearch
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'API Error')
      }
      if (!res.body) throw new Error('No body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let currentText = ''
      let lastUpdate = 0
      const THROTTLE_MS = 100

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        currentText += decoder.decode(value, { stream: true })
        const now = Date.now()
        if (now - lastUpdate > THROTTLE_MS) {
          updateResponse(respId, { content: currentText })
          lastUpdate = now
        }
      }

      const latency = Date.now() - startTime
      const tokens = Math.floor(currentText.length / 4)
      
      updateResponse(respId, { 
        status: 'complete',
        latency,
        tokens,
        content: currentText
      })
    } catch (err) {
      updateResponse(respId, { 
        status: 'error', 
        content: 'Error: Failed to fetch response. Please check API settings.' 
      })
    } finally {
      setIsLoading(false)
      setAbortController(null)
    }
  }, [updateResponse, setAbortController])

  const handleCopy = useCallback(async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [responses])

  // Process message queue
  useEffect(() => {
    if (!isLoading && messageQueue.length > 0) {
      const nextMessage = dequeueMessage()
      if (nextMessage) {
        handleSubmit(nextMessage)
      }
    }
  }, [isLoading, messageQueue.length, dequeueMessage])

  const userMessages = useMemo(() => messages.filter(m => m.role === 'user'), [messages])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Multi-Model Chat</h1>
          <p className="text-sm text-muted-foreground">
            Get responses from {enabledModels.length} models simultaneously
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={chatMode} onValueChange={setChatMode}>
            <SelectTrigger className="w-[200px] h-8 text-sm">
              <SelectValue placeholder="Select target" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="models">
                <div className="flex items-center">
                  <Sparkles className="w-3 h-3 mr-2" />
                  All Enabled Models
                </div>
              </SelectItem>
              {configs.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Saved Pipelines</SelectLabel>
                  {configs.map(c => (
                    <SelectItem key={`pipeline:${c.id}`} value={`pipeline:${c.id}`}>
                      <div className="flex items-center">
                        <Network className="w-3 h-3 mr-2" />
                        {c.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>

          <Badge variant="outline" className="gap-1">
            <Sparkles className="w-3 h-3" />
            {enabledModels.length} Active
          </Badge>
          <Button variant="outline" size="sm" onClick={startNewChat}>
            <Plus className="w-4 h-4 mr-2" />
            New
          </Button>

          <Button variant="outline" size="sm" onClick={clearChat}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <History className="w-4 h-4 mr-2" />
                History
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[400px] sm:w-[540px]">
              <SheetHeader>
                <SheetTitle>Chat History</SheetTitle>
                <SheetDescription>
                  Your previously saved multi-model chats and pipeline executions.
                </SheetDescription>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-120px)] mt-6 pr-4">
                {historicalChats.length === 0 ? (
                  <div className="text-center text-muted-foreground mt-10">
                    <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    No saved chats yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {historicalChats.map((chat) => (
                      <div key={chat.id} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors group relative">
                        <div 
                          className="cursor-pointer"
                          onClick={() => loadHistoricalChat(chat.id)}
                        >
                          <h4 className="font-medium text-foreground line-clamp-1 pr-8">{chat.title}</h4>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span>{new Date(chat.date).toLocaleString()}</span>
                            <span>{chat.messages.length} messages</span>
                            <span>{chat.responses.length} responses</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute top-2 right-2 h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteHistoricalChat(chat.id)
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Chat Area */}
      <ScrollArea className="flex-1 px-6 py-4 min-h-0" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-20">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Start a conversation</h2>
            <p className="text-muted-foreground text-center max-w-md">
              Ask a question and receive responses from multiple AI models simultaneously. 
              Compare their answers and find the best solution.
            </p>
            <div className="flex flex-wrap gap-2 mt-6 justify-center">
              {['Explain quantum computing', 'Write a poem', 'Debug my code', 'Compare frameworks'].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => setInput(suggestion)}
                  className="text-xs"
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {userMessages.map((msg) => {
              const msgResponses = responses.filter(r => r.messageId === msg.id)
              return (
                <div key={msg.id} className="space-y-4">
                  {/* User bubble */}
                  <div className="flex gap-3 justify-end">
                    <div className="max-w-[80%] bg-primary/10 border border-primary/20 rounded-2xl rounded-tr-sm px-4 py-3">
                      <div className="text-xs font-medium text-primary mb-1">You</div>
                      <div className="text-sm text-foreground">{msg.content}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 text-right">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                  </div>

                  {/* AI Responses for this message */}
                  {msgResponses.length > 0 && (
                    <div className="grid gap-4 grid-cols-1">
                      {msgResponses.map((response, idx) => {
                        const model = models.find(m => m.id === response.modelId)
                        const provider = model?.provider || 'custom'
                        return (
                          <ModelResponseCard
                            key={response.id || `legacy-${response.modelId}-${idx}`}
                            response={response}
                            provider={provider}
                            onCopy={() => handleCopy(response.content, response.id)}
                            onDelete={() => removeResponse(response.id)}
                            onToggleCollapse={() => updateResponse(response.id, { isCollapsed: !response.isCollapsed })}
                            onRetry={() => {
                              const configId = response.status === 'error' && response.pipelineSteps ? response.modelName.split(': ')[1] : null
                              const config = configs.find(c => c.name === configId || c.id === response.modelId)
                              const userMsg = messages.find(m => m.id === response.messageId)
                              if (config && userMsg) {
                                runPipelineInChat(config, userMsg.content, userMsg.id, response.id)
                              } else if (userMsg) {
                                simulateModelResponse(response.id, response.modelId, userMsg.content)
                              }
                            }}
                            copied={copiedId === response.id}
                          />
                        )
                      })}
                    </div>
                  )}

                  {/* Responses still loading for this message */}
                  {msgResponses.length === 0 && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm pl-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Waiting for responses...
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div 
        className="p-4 border-t border-border"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Attached Files Preview */}
        {attachedFiles.length > 0 && (
          <div className="max-w-4xl mx-auto mb-3">
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, index) => (
                <div 
                  key={index}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-lg border bg-card/50 min-w-[150px] max-w-[250px]",
                    file.isProcessing && "opacity-60"
                  )}
                >
                  <div className="text-lg flex-shrink-0">
                    {getFileIcon(file.type, file.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{file.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {file.isProcessing 
                        ? 'Processing...' 
                        : file.error 
                          ? 'Error' 
                          : formatFileSize(file.size)
                      }
                    </div>
                  </div>
                  <button 
                    onClick={() => removeAttachedFile(index)}
                    className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-destructive flex-shrink-0"
                    title="Remove file"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative max-w-4xl mx-auto" ref={textareaContainerRef}>
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={attachedFiles.length > 0 ? "Add a message (optional)..." : "Send a message to all models..."}
              className="min-h-[80px] pr-24 pl-12 resize-none bg-secondary border-0 focus-visible:ring-1 focus-visible:ring-primary"
              disabled={false}
            />
            {/* File Attach Button (Inside Textarea) */}
            <div className="absolute left-3 bottom-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFiles}
                title="Attach file"
              >
                <Paperclip className={cn("w-4 h-4", attachedFiles.length > 0 && "text-primary")} />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="*/*"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              />
            </div>
          </div>
          <div className="absolute top-3 right-14 flex flex-col items-end gap-1 pointer-events-none">
            {messageQueue.length > 0 && (
              <Badge variant="secondary" className="text-[10px] py-0 h-4 animate-bounce flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> {messageQueue.length} in queue
              </Badge>
            )}
          </div>
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">
              {input.length} / 4000
            </span>
            {isLoading ? (
              <Button 
                onClick={abortGeneration} 
                variant="destructive"
                size="sm"
                className="gap-2 animate-in zoom-in-95 duration-200"
              >
                <StopCircle className="w-4 h-4" />
                Stop
              </Button>
            ) : (
              <Button 
                onClick={() => handleSubmit()} 
                disabled={!input.trim()}
                size="sm"
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const ModelResponseCard = memo(function ModelResponseCard({ 
  response, 
  provider,
  onCopy,
  onDelete,
  onToggleCollapse,
  onRetry,
  copied 
}: { 
  response: ModelResponse
  provider: string
  onCopy: () => void
  onDelete: () => void
  onToggleCollapse: () => void
  onRetry: () => void
  copied: boolean
}) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const toggleStepCollapse = useCallback((nodeId: string) => {
    const current = response.collapsedStepIds || []
    const next = current.includes(nodeId)
      ? current.filter(id => id !== nodeId)
      : [...current, nodeId]
    
    useArenaStore.getState().updateResponse(response.id, { collapsedStepIds: next })
  }, [response.id, response.collapsedStepIds])
  
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground mr-1"
            onClick={onToggleCollapse}
            title={response.isCollapsed ? "Expand" : "Collapse"}
          >
            {response.isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </Button>
          <span className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold border",
            providerColors[provider]
          )}>
            {providerIcons[provider]}
          </span>
          <span className="font-medium text-foreground">{response.modelName}</span>
          {response.status === 'streaming' && (
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse delay-100" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse delay-200" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-xs", providerColors[provider])}>
            {provider}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Remove response"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!response.isCollapsed ? (
        <div className="text-sm mb-3 min-h-[100px]">
          {response.pipelineSteps ? (
            <div className="space-y-4">
              {response.status === 'complete' && response.content && (
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 text-foreground">
                  <div className="font-semibold text-xs text-primary mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Final Aggregated Output
                  </div>
                  <MarkdownRenderer content={response.content} />
                </div>
              )}
              
              <div className="space-y-3 mt-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 mb-3">
                  <Network className="w-4 h-4" /> Execution Log
                </div>
                <div className="relative border-l-2 border-border ml-3 pl-4 py-2 space-y-4">
                  {response.pipelineSteps.map(step => (
                    <div key={step.nodeId} className="relative">
                      <div className={cn(
                        "absolute -left-[25px] w-4 h-4 rounded-full border-2 bg-background flex items-center justify-center",
                        step.status === 'completed' ? 'border-emerald-500' :
                        step.status === 'running' ? 'border-primary animate-pulse' :
                        step.status === 'error' ? 'border-destructive' : 'border-border'
                      )}>
                        {step.status === 'completed' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                        {step.status === 'running' && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                      </div>
                      
                      <div className={cn(
                        "rounded-lg border p-3 bg-card transition-all",
                        step.status === 'running' ? 'border-primary/50 shadow-[0_0_10px_rgba(59,130,246,0.1)]' : 'border-border',
                        (response.collapsedStepIds || []).includes(step.nodeId) && "p-2 opacity-80"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="w-5 h-5 text-muted-foreground mr-0.5"
                                onClick={() => toggleStepCollapse(step.nodeId)}
                                title={(response.collapsedStepIds || []).includes(step.nodeId) ? "Expand step" : "Collapse step"}
                              >
                                {(response.collapsedStepIds || []).includes(step.nodeId) ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                )}
                              </Button>
                              <span className="font-medium text-foreground text-sm flex items-center gap-1.5">
                                {step.type === 'model' && <Bot className="w-3.5 h-3.5 text-emerald-400" />}
                                {step.type === 'prompt' && <MessageSquare className="w-3.5 h-3.5 text-blue-400" />}
                                {step.type === 'validator' && <Shield className="w-3.5 h-3.5 text-orange-400" />}
                                {step.type === 'aggregator' && <Combine className="w-3.5 h-3.5 text-purple-400" />}
                                {step.label}
                              </span>
                          </div>
                          <div className="flex items-center gap-3">
                            {step.tokens !== undefined && step.tokens > 0 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Zap className="w-3 h-3 text-yellow-500" />
                                {step.tokens} tokens
                              </span>
                            )}
                            <Badge variant="outline" className={cn(
                              "text-[10px] px-1.5 py-0 h-4 font-normal",
                              step.status === 'completed' ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" :
                              step.status === 'running' ? "text-primary border-primary/30 bg-primary/10" :
                              step.status === 'error' ? "text-destructive border-destructive/30 bg-destructive/10" : ""
                            )}>
                              {step.status}
                            </Badge>
                            {step.status === 'error' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-4 p-0 px-1 text-[9px] text-primary hover:text-primary/80"
                                onClick={onRetry}
                              >
                                <RefreshCw className="w-2.5 h-2.5 mr-1" />
                                Retry
                              </Button>
                            )}
                          </div>
                        </div>
                        
                        {step.result && !(response.collapsedStepIds || []).includes(step.nodeId) && (
                          <div className="mt-3 bg-secondary/30 p-2.5 rounded border border-border/50 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                            <MarkdownRenderer content={step.result} compact />
                            {step.status === 'running' && (
                              <span className="inline-block w-1.5 h-3.5 ml-1 bg-primary animate-pulse align-middle" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            response.content
              ? <MarkdownRenderer content={response.content} />
              : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating response...
                </div>
              )
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic bg-muted/30 px-3 py-2 rounded-lg mb-3 flex items-center gap-2">
          <MessageCircle className="w-3.5 h-3.5" />
          {response.content ? (
            response.content.length > 60 
              ? response.content.slice(0, 60) + '...' 
              : response.content
          ) : "Response collapsed"}
        </div>
      )}

      {/* Footer */}
      {(response.status === 'complete' || response.status === 'error') && (
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {response.tokens !== undefined && (
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {response.tokens} tokens
              </span>
            )}
            {response.latency !== undefined && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {(response.latency! / 1000).toFixed(2)}s
              </span>
            )}
            {response.status === 'error' && (
               <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 text-[10px] border-primary/30 text-primary hover:bg-primary/10"
                onClick={onRetry}
              >
                <RefreshCw className="w-3 h-3" />
                Resume Pipeline
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Export Buttons for Pipeline Results */}
            {response.pipelineSteps && response.status === 'complete' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    downloadCSV({
                      title: response.modelName,
                      timestamp: new Date().toISOString(),
                      pipelineSteps: response.pipelineSteps,
                      totalCost: response.pipelineSteps?.reduce((acc, s) => acc + (s.promptCost || 0) + (s.completionCost || 0), 0) || 0,
                      totalTokens: response.pipelineSteps?.reduce((acc, s) => acc + (s.tokens || 0), 0) || 0,
                      latency: response.latency || 0
                    })
                  }}
                  title="Export as CSV"
                >
                  <Table2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    downloadPDF({
                      title: `${response.modelName} - Execution Report`,
                      timestamp: new Date().toISOString(),
                      pipelineSteps: response.pipelineSteps,
                      totalCost: response.pipelineSteps?.reduce((acc, s) => acc + (s.promptCost || 0) + (s.completionCost || 0), 0) || 0,
                      totalTokens: response.pipelineSteps?.reduce((acc, s) => acc + (s.tokens || 0), 0) || 0,
                      latency: response.latency || 0
                    })
                  }}
                  title="Export as PDF"
                >
                  <FileText className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", feedback === 'up' && "text-emerald-500")}
              onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", feedback === 'down' && "text-red-500")}
              onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCopy}>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
})
