'use client'

import { useState, useEffect, useRef } from 'react'
import { useArenaStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Send,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Bot,
  FileText,
  Folder,
  FolderOpen,
  X,
  Save,
  PanelRightClose,
  PanelRightOpen,
  StopCircle,
  RefreshCw,
  Paperclip,
  Monitor,
  Cloud,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
  isModified?: boolean
  content?: string
}

interface OpenFile {
  path: string
  name: string
  content: string
  isModified: boolean
  originalContent: string
}

interface AttachedFile {
  path: string
  name: string
  type: 'file' | 'folder'
}

export function IDEChatPanel() {
  const models = useArenaStore(state => state.models)
  const ideMessages = useArenaStore(state => state.ideMessages)
  const ideResponses = useArenaStore(state => state.ideResponses)
  const addIdeMessage = useArenaStore(state => state.addIdeMessage)
  const addIdeResponse = useArenaStore(state => state.addIdeResponse)
  const updateIdeResponse = useArenaStore(state => state.updateIdeResponse)
  const clearIdeChat = useArenaStore(state => state.clearIdeChat)
  const abortGeneration = useArenaStore(state => state.abortGeneration)

  const ideSelectedModel = useArenaStore(state => state.ideSelectedModel)
  const setIdeSelectedModel = useArenaStore(state => state.setIdeSelectedModel)
  const ideUseOllama = useArenaStore(state => state.ideUseOllama)
  const setIdeUseOllama = useArenaStore(state => state.setIdeUseOllama)

  const [selectedModel, setSelectedModel] = useState<string>(ideSelectedModel || models[0]?.id || '')
  const [showToolbar, setShowToolbar] = useState(true)
  const [showExplorer, setShowExplorer] = useState(true)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']))
  const [chatInput, setChatInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [useOllama, setUseOllama] = useState(ideUseOllama)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [modelSearch, setModelSearch] = useState('')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [allOpenRouterModels, setAllOpenRouterModels] = useState<any[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [sessionTokens, setSessionTokens] = useState({ prompt: 0, completion: 0, total: 0 })

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      const defaultModel = ideSelectedModel || models[0].id
      setSelectedModel(defaultModel)
    }
  }, [models])

  // Sync with store
  useEffect(() => { setIdeSelectedModel(selectedModel) }, [selectedModel, setIdeSelectedModel])
  useEffect(() => { setIdeUseOllama(useOllama) }, [useOllama, setIdeUseOllama])

  useEffect(() => {
    loadFileTree()
    loadOllamaModels()
    loadOpenRouterModels()
  }, [])

  const loadOpenRouterModels = async () => {
    setIsLoadingModels(true)
    try {
      const res = await fetch('/api/models')
      const data = await res.json()
      if (data.models && data.models.length > 0) {
        setAllOpenRouterModels(data.models)
      }
    } catch (e) {
      console.error('Failed to load OpenRouter models:', e)
    } finally {
      setIsLoadingModels(false)
    }
  }

  const loadOllamaModels = async () => {
    try {
      const res = await fetch('http://localhost:11434/api/tags')
      const data = await res.json()
      if (data.models) setOllamaModels(data.models.map((m: any) => m.name))
    } catch { /* ignore */ }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ideMessages, ideResponses])

  const loadFileTree = async () => {
    setIsLoadingFiles(true)
    try {
      const res = await fetch('/api/files')
      const data = await res.json()
      console.log('[IDE] API response:', data)
      // API returns { files } but we handle both { files } and { tree }
      const treeData = data.files || data.tree || []
      console.log('[IDE] Tree data:', treeData)
      if (treeData.length > 0) {
        const built = buildFileTree(treeData)
        console.log('[IDE] Built tree:', built)
        setFileTree(built)
      } else {
        console.warn('[IDE] No files returned from API')
      }
    } catch (e) { 
      console.error('[IDE] Failed to load file tree:', e)
    } finally {
      setIsLoadingFiles(false)
    }
  }

  const buildFileTree = (items: any[], path = ''): FileNode[] => {
    return items.map((item: any) => {
      const fullPath = path ? `${path}/${item.name}` : item.name
      const isFolder = item.type === 'directory' || item.children
      return {
        name: item.name, path: fullPath,
        type: isFolder ? 'folder' : 'file',
        children: item.children ? buildFileTree(item.children, fullPath) : undefined,
        isModified: false,
      }
    })
  }

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const openFile = async (file: FileNode) => {
    if (openFiles.find(f => f.path === file.path)) { setActiveFile(file.path); return }
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: file.path }),
      })
      const data = await res.json()
      setOpenFiles(prev => [...prev, { path: file.path, name: file.name, content: data.content || '', isModified: false, originalContent: data.content || '' }])
      setActiveFile(file.path)
    } catch (e) { console.error('Failed to open file:', e) }
  }

  const closeFile = (path: string) => {
    setOpenFiles(prev => prev.filter(f => f.path !== path))
    if (activeFile === path) setActiveFile(openFiles.length > 1 ? openFiles.find(f => f.path !== path)?.path || null : null)
  }

  const updateFileContent = (path: string, content: string) => {
    setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, content, isModified: content !== f.originalContent } : f))
  }

  const saveFile = async (path: string) => {
    const file = openFiles.find(f => f.path === path)
    if (!file) return
    try {
      const res = await fetch('/api/files/edit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: path, operation: 'write', content: file.content, createBackup: true }),
      })
      if (res.ok) {
        setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, isModified: false, originalContent: f.content } : f))
        setFileTree(prev => updateTreeModified(prev, path, false))
      }
    } catch (e) { console.error('Failed to save file:', e) }
  }

  const updateTreeModified = (tree: FileNode[], path: string, isModified: boolean): FileNode[] => {
    return tree.map(node => {
      if (node.path === path) return { ...node, isModified }
      if (node.children) return { ...node, children: updateTreeModified(node.children, path, isModified) }
      return node
    })
  }

  // Collect all files from a folder recursively
  const collectFilesFromFolder = (folder: FileNode): FileNode[] => {
    if (folder.type === 'file') return [folder]
    if (!folder.children) return []
    return folder.children.flatMap(child => collectFilesFromFolder(child))
  }

  // Collect ALL files from entire tree
  const collectAllFiles = (tree: FileNode[]): FileNode[] => {
    return tree.flatMap(node => {
      if (node.type === 'file') return [node]
      if (node.children) return [node, ...collectAllFiles(node.children)]
      return []
    })
  }

  const findNodeInTree = (nodes: FileNode[], path: string): FileNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.children) {
        const found = findNodeInTree(node.children, path)
        if (found) return found
      }
    }
    return null
  }

  const attachFile = (file: FileNode) => {
    if (!attachedFiles.find(f => f.path === file.path)) {
      setAttachedFiles(prev => [...prev, { path: file.path, name: file.name, type: file.type }])
    }
  }

  const attachFolder = (folder: FileNode) => {
    const files = collectFilesFromFolder(folder)
    const newFiles = files.filter(f => !attachedFiles.find(af => af.path === f.path))
    if (newFiles.length > 0) {
      // Add folder first, then all files
      setAttachedFiles(prev => [
        ...prev,
        { path: folder.path, name: folder.name, type: 'folder' as const },
        ...newFiles.map(f => ({ path: f.path, name: f.name, type: 'file' as const }))
      ])
    }
  }

  const detachFile = (path: string) => {
    setAttachedFiles(prev => prev.filter(f => f.path !== path))
  }

  const clearAllAttached = () => {
    setAttachedFiles([])
  }

  const handleSend = async () => {
    if (!chatInput.trim() || isStreaming) return

    let fileContext = ''
    if (attachedFiles.length > 0) {
      // Index attached files for RAG
      try {
        const filePaths = attachedFiles.filter(f => f.type === 'file').map(f => f.path)
        if (filePaths.length > 0) {
          await fetch('/api/rag/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths }),
          })
        }
      } catch (e) {
        console.error('Failed to index files for RAG:', e)
      }

      // Search for relevant chunks using RAG
      try {
        const searchRes = await fetch('/api/rag/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: chatInput.trim(), topK: 5 }),
        })
        const searchData = await searchRes.json()
        
        if (searchData.results && searchData.results.length > 0) {
          fileContext = `\n\n--- Relevant Context from Attached Files (RAG) ---\n`
          for (const result of searchData.results) {
            fileContext += `\n\n### ${result.source} (lines ${result.startLine}-${result.endLine}) [score: ${result.score.toFixed(2)}]\n\`\`\`\n${result.text}\n\`\`\`\n`
          }
        }
      } catch (e) {
        console.error('Failed to search RAG:', e)
        // Fallback to sending full files if RAG fails
        fileContext = `\n\n--- Attached Files/Folders Context (${attachedFiles.length} files) ---\n`
        for (const file of attachedFiles) {
          try {
            const res = await fetch('/api/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: file.path }),
            })
            const data = await res.json()
            if (data.content) {
              fileContext += `\n\n### ${file.path}\n\`\`\`\n${data.content}\n\`\`\`\n`
            }
          } catch { fileContext += `\n\n### ${file.path} - Failed to read\n` }
        }
      }
    }

    const userMessage = { id: Date.now().toString(), role: 'user' as const, content: chatInput.trim(), timestamp: new Date().toISOString() }
    addIdeMessage(userMessage)
    setChatInput('')
    setIsStreaming(true)

    const responseId = `resp-${Date.now()}`
    const modelId = useOllama ? `ollama/${selectedModel}` : selectedModel
    const modelName = useOllama ? selectedModel : (allOpenRouterModels.find(m => m.id === selectedModel)?.name || models.find(m => m.id === selectedModel)?.name || 'Unknown')

    addIdeResponse({ id: responseId, modelId, modelName, content: '', status: 'pending' })

    try {
      const controller = new AbortController()
      useArenaStore.getState().setAbortController(controller)

      const res = await fetch('/api/ide-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          modelId,
          webSearch: true, // Always enabled for IDE chat
          messages: [
            ...ideMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage.content + fileContext },
          ],
        }),
      })

      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      updateIdeResponse(responseId, { status: 'streaming' })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        
        // Check for usage stats marker
        const usageMatch = chunk.match(/\[USAGE:(.+?)\]/)
        if (usageMatch) {
          try {
            const usage = JSON.parse(usageMatch[1])
            setSessionTokens(prev => ({
              prompt: prev.prompt + (usage.prompt_tokens || 0),
              completion: prev.completion + (usage.completion_tokens || 0),
              total: prev.total + (usage.total_tokens || 0),
            }))
            // Remove usage marker from text
            text += chunk.replace(usageMatch[0], '')
          } catch {
            text += chunk
          }
        } else {
          text += chunk
        }
        
        updateIdeResponse(responseId, { content: text, status: 'streaming' })
      }
      
      // Clean up any remaining usage markers
      const cleanText = text.replace(/\[USAGE:.*?\]/g, '')
      updateIdeResponse(responseId, { 
        content: cleanText, 
        status: 'complete',
        tokens: sessionTokens.total
      })
    } catch (e: any) {
      if (e.name === 'AbortError') updateIdeResponse(responseId, { status: 'complete' })
      else updateIdeResponse(responseId, { content: `[Error] ${e.message}`, status: 'error' })
    } finally {
      setIsStreaming(false)
      useArenaStore.getState().setAbortController(null)
    }
  }

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedFolders.has(node.path)
      const isActive = activeFile === node.path
      const isOpen = openFiles.some(f => f.path === node.path)

      if (node.type === 'folder') {
        return (
          <div key={node.path}>
            <button onClick={() => toggleFolder(node.path)} className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-secondary/50 rounded transition-colors" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
              {isExpanded ? <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 rotate-90" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
              {isExpanded ? <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
              <span className="truncate">{node.name}</span>
            </button>
            {isExpanded && node.children && <div>{renderFileTree(node.children, depth + 1)}</div>}
          </div>
        )
      }

      return (
        <div key={node.path} className="flex items-center gap-1" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
          <button onClick={() => openFile(node)} className={cn("flex-1 flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-secondary/50 rounded transition-colors min-w-0", isActive && "bg-secondary/80")}>
            <FileText className={cn("w-3.5 h-3.5 shrink-0", node.isModified ? "text-amber-400" : "text-muted-foreground")} />
            <span className="truncate flex-1 text-left">{node.name}</span>
            {node.isModified && <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />}
            {isOpen && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
          </button>
          <button onClick={() => { if (node.children) attachFolder(node); else attachFile(node); }} className="p-1 hover:bg-secondary/50 rounded transition-colors shrink-0" title={node.children ? "Attach entire folder" : "Attach file"}>
            <Paperclip className={cn("w-3 h-3", node.children ? "text-violet-400" : "text-muted-foreground")} />
          </button>
        </div>
      )
    })
  }

  const activeFileData = openFiles.find(f => f.path === activeFile)
  const currentModelId = useOllama ? `ollama/${selectedModel}` : selectedModel

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Top Toolbar */}
      {showToolbar && (
        <div className="flex-shrink-0 border-b border-border bg-muted/30 px-3 py-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowToolbar(false)}><ChevronUp className="w-4 h-4" /></Button>
          <Separator orientation="vertical" className="h-5" />
          
          {/* Model Source Toggle */}
          <div className="flex items-center gap-1">
            <button onClick={() => { setUseOllama(false); setIdeUseOllama(false) }} className={cn("flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors", !useOllama ? "bg-violet-500/20 text-violet-400 border border-violet-500/30" : "text-muted-foreground hover:bg-secondary/50")}>
              <Cloud className="w-3 h-3" /> OpenRouter
            </button>
            <button onClick={() => { setUseOllama(true); setIdeUseOllama(true) }} className={cn("flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors", useOllama ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-muted-foreground hover:bg-secondary/50")}>
              <Monitor className="w-3 h-3" /> Ollama
            </button>
          </div>

          {/* Model Selector */}
          {useOllama ? (
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue placeholder="Select model..." /></SelectTrigger>
              <SelectContent>
                {ollamaModels.length > 0 ? ollamaModels.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>) : <SelectItem value="none" className="text-xs text-muted-foreground">No local models</SelectItem>}
              </SelectContent>
            </Select>
          ) : (
            <div className="relative">
              <button
                onClick={() => {
                  setShowModelDropdown(!showModelDropdown)
                  if (allOpenRouterModels.length === 0) loadOpenRouterModels()
                }}
                className="h-7 w-[200px] px-2 text-xs bg-background border border-input rounded-md flex items-center justify-between hover:border-ring transition-colors"
              >
                <span className="truncate">{allOpenRouterModels.find(m => m.id === selectedModel)?.name || models.find(m => m.id === selectedModel)?.name || 'Select model...'}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {showModelDropdown && (
                <div className="absolute top-full left-0 mt-1 w-80 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-96 flex flex-col">
                  <div className="p-2 border-b border-border">
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="Search models..."
                      className="w-full h-7 px-2 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto p-1">
                    {isLoadingModels ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <>
                        {(allOpenRouterModels.length > 0 ? allOpenRouterModels : models)
                          .filter(m => 
                            !modelSearch ||
                            m.name?.toLowerCase().includes(modelSearch.toLowerCase()) ||
                            m.id?.toLowerCase().includes(modelSearch.toLowerCase()) ||
                            m.provider?.toLowerCase().includes(modelSearch.toLowerCase())
                          )
                          .map(m => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSelectedModel(m.id)
                                setShowModelDropdown(false)
                                setModelSearch('')
                              }}
                              className={cn(
                                "w-full px-2 py-1.5 text-xs text-left rounded hover:bg-accent transition-colors flex items-center gap-2",
                                selectedModel === m.id && "bg-accent"
                              )}
                            >
                              <span className="font-medium truncate flex-1">{m.name || m.id}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{m.provider || ''}</span>
                            </button>
                          ))}
                        {(allOpenRouterModels.length > 0 ? allOpenRouterModels : models).filter(m => 
                          !modelSearch ||
                          m.name?.toLowerCase().includes(modelSearch.toLowerCase()) ||
                          m.id?.toLowerCase().includes(modelSearch.toLowerCase())
                        ).length === 0 && (
                          <div className="px-2 py-4 text-xs text-muted-foreground text-center">No models found</div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="p-2 border-t border-border text-[10px] text-muted-foreground text-center">
                    {allOpenRouterModels.length > 0 ? allOpenRouterModels.length : models.length} models available
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Usage Stats */}
          {sessionTokens.total > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 bg-primary/5 rounded text-[10px]">
              <Sparkles className="w-3 h-3 text-primary" />
              <span className="font-medium">{sessionTokens.total.toLocaleString()} tokens</span>
              <span className="text-muted-foreground">(P: {sessionTokens.prompt.toLocaleString()}, C: {sessionTokens.completion.toLocaleString()})</span>
            </div>
          )}

          <Separator orientation="vertical" className="h-5" />
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { clearIdeChat(); setSessionTokens({ prompt: 0, completion: 0, total: 0 }) }}><Trash2 className="w-3.5 h-3.5" /> Clear</Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setShowExplorer(!showExplorer)}>
            {showExplorer ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />} Explorer
          </Button>
        </div>
      )}

      {!showToolbar && (
        <div className="flex-shrink-0 border-b border-border bg-muted/30 px-3 py-1 flex items-center justify-between">
          <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-400" /><span className="text-xs font-medium">Hephaestus IDE</span></div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowToolbar(true)}><ChevronDown className="w-4 h-4" /></Button>
        </div>
      )}

      {/* Main Content - Split View: Chat | File Viewer | Explorer */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <div className={cn("flex flex-col overflow-hidden min-h-0 border-r border-border", activeFileData ? "w-1/2" : "flex-1")}>
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            <div className="space-y-4 max-w-4xl mx-auto">
              {ideMessages.map(msg => (
                <div key={msg.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0"><Bot className="w-4 h-4 text-violet-400" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-violet-400">You</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}
              {ideResponses.map(resp => (
                <div key={resp.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-emerald-400" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-emerald-400">{resp.modelName}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5">{resp.status === 'streaming' ? 'Typing...' : resp.status}</Badge>
                      <div className="ml-auto flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => copyToClipboard(resp.content, resp.id)}>
                          {copiedId === resp.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                    <div className="text-sm"><MarkdownRenderer content={resp.content || '_Waiting for response..._'} /></div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Attached Files */}
          {attachedFiles.length > 0 && (
            <div className="flex-shrink-0 border-t border-border px-3 py-2 bg-muted/10">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-muted-foreground font-medium">{attachedFiles.length} file(s) attached</span>
                  <button onClick={clearAllAttached} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">Clear all</button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
                  {attachedFiles.map(file => (
                    <Badge key={file.path} variant="secondary" className="text-[10px] gap-1 pr-1">
                      <FileText className="w-3 h-3" />
                      <span className="max-w-[120px] truncate" title={file.path}>{file.name}</span>
                      <button onClick={() => detachFile(file.path)} className="ml-0.5 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Chat Input */}
          <div className="flex-shrink-0 border-t border-border p-3 bg-muted/20">
            <div className="max-w-4xl mx-auto space-y-2">
              <Textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }} placeholder="Type a message... (Enter to send, Shift+Enter for new line)" className="min-h-[36px] max-h-[120px] resize-none text-sm" disabled={isStreaming} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {isStreaming ? (
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={abortGeneration}><StopCircle className="w-3.5 h-3.5 text-red-400" /> Stop</Button>
                  ) : (
                    <Button onClick={handleSend} disabled={!chatInput.trim() || isStreaming} size="sm" className="h-8 gap-1 text-xs"><Send className="w-3.5 h-3.5" /> Send</Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={clearIdeChat}><Trash2 className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => {
                    const allFiles = collectAllFiles(fileTree)
                    if (allFiles.length > 0) {
                      setAttachedFiles(allFiles.map(f => ({ path: f.path, name: f.name, type: f.type })))
                    } else {
                      loadFileTree().then(() => {
                        const files = collectAllFiles(fileTree)
                        if (files.length > 0) {
                          setAttachedFiles(files.map(f => ({ path: f.path, name: f.name, type: f.type })))
                        }
                      })
                    }
                  }}>
                    <Paperclip className="w-3.5 h-3.5" /> Attach All
                  </Button>
                </div>
                {attachedFiles.length > 0 && <span className="text-[10px] text-muted-foreground">{attachedFiles.length} file(s) attached</span>}
              </div>
            </div>
          </div>
        </div>

        {/* File Viewer - Split Screen (right of chat) */}
        {activeFileData && (
          <div className="flex flex-col overflow-hidden min-h-0 border-r border-border" style={{ width: showExplorer ? '25%' : '50%' }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-medium truncate max-w-[200px]">{activeFileData.name}</span>
                {activeFileData.isModified && <Badge variant="outline" className="text-[9px] h-4 px-1">Modified</Badge>}
              </div>
              <div className="flex items-center gap-1">
                {activeFileData.isModified && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => saveFile(activeFileData.path)}>
                    <Save className="w-3.5 h-3.5 text-green-400" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => closeFile(activeFileData.path)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-0">
              <div className="flex items-center justify-between px-3 py-1 bg-muted/20 border-b border-border">
                <span className="text-[10px] text-muted-foreground">{activeFileData.path}</span>
                <span className="text-[10px] text-muted-foreground">{activeFileData.content.length.toLocaleString()} chars</span>
              </div>
              <Textarea
                value={activeFileData.content}
                onChange={(e) => updateFileContent(activeFileData.path, e.target.value)}
                className="min-h-full h-full font-mono text-xs resize-none border-0 rounded-none bg-background"
                style={{ tabSize: 2 }}
              />
            </div>
          </div>
        )}

        {/* File Explorer */}
        {showExplorer && (
          <div className="flex-shrink-0 border-l border-border bg-muted/20 flex flex-col" style={{ width: 280 }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2"><FolderOpen className="w-4 h-4 text-amber-400" /><span className="text-xs font-medium">Explorer</span></div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => {
                  const allFiles = collectAllFiles(fileTree)
                  setAttachedFiles(allFiles.map(f => ({ path: f.path, name: f.name, type: f.type })))
                }}>
                  <Paperclip className="w-3 h-3" /> All
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadFileTree}><RefreshCw className="w-3 h-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowExplorer(false)}><X className="w-3 h-3" /></Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoadingFiles ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : fileTree.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground px-4 text-center">
                  <FolderOpen className="w-8 h-8 mb-2 opacity-30" />
                  <span className="text-xs mb-1">No files found</span>
                  <span className="text-[10px] opacity-50 mb-2">Click Refresh to load files</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={loadFileTree}>
                    <RefreshCw className="w-3 h-3" /> Load Files
                  </Button>
                </div>
              ) : (
                <div className="py-1">{renderFileTree(fileTree)}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function cn(...classes: (string | boolean | undefined)[]) { return classes.filter(Boolean).join(' ') }