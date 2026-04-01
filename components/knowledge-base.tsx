'use client'

import { useState, useEffect } from 'react'
import { useArenaStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { FileSelector } from './file-selector'
import { Badge } from '@/components/ui/badge'
import {
  FileBox,
  Plus,
  Trash2,
  FileText,
  Info,
  CheckCircle2,
  AlertCircle,
  Database,
  Search,
  Loader2,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface IndexStats {
  documentCount: number
  totalChunks: number
  totalTokens: number
  indexedDocuments: { source: string; chunks: number; totalTokens: number; indexedAt: string }[]
}

interface SearchResult {
  text: string
  score: number
  source: string
  lines: string
}

export function KnowledgeBase() {
  const { knowledgeBase, addKnowledgeFile, removeKnowledgeFile, activeConfigId } = useArenaStore()
  const [isSelectorOpen, setSelectorOpen] = useState(false)
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null)
  const [indexingFiles, setIndexingFiles] = useState<Set<string>>(new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/knowledge/stats')
      const data = await res.json()
      setIndexStats(data.stats)
    } catch (e) {
      console.error('Failed to fetch stats:', e)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  const indexFile = async (filePath: string) => {
    setIndexingFiles(prev => new Set(prev).add(filePath))
    try {
      const res = await fetch('/api/knowledge/index', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
      const data = await res.json()
      if (data.message) {
        fetchStats()
      }
    } catch (e) {
      console.error('Indexing failed:', e)
    } finally {
      setIndexingFiles(prev => {
        const next = new Set(prev)
        next.delete(filePath)
        return next
      })
    }
  }

  const indexAllFiles = async () => {
    for (const filePath of knowledgeBase) {
      if (!indexingFiles.has(filePath)) {
        await indexFile(filePath)
      }
    }
  }

  const performSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, topK: 5 }),
      })
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch (e) {
      console.error('Search failed:', e)
    } finally {
      setSearching(false)
    }
  }

  const isIndexed = (path: string) => {
    const fileName = path.split('/').pop() || ''
    return indexStats?.indexedDocuments.some(d => d.source === fileName)
  }

  return (
    <div className="flex flex-col h-full bg-card/30 rounded-xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-border/50 bg-secondary/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileBox className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Pipeline Knowledge</h3>
              <p className="text-xs text-muted-foreground whitespace-nowrap">Global files shared across all nodes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchOpen(true)
                setSearchResults([])
              }}
              className="gap-2"
            >
              <Search className="w-4 h-4" />
              RAG Search
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                indexAllFiles()
                fetchStats()
              }}
              disabled={knowledgeBase.length === 0 || indexingFiles.size > 0}
              className="gap-2"
            >
              {indexingFiles.size > 0 ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              Index All
            </Button>
            <Button
              onClick={() => setSelectorOpen(true)}
              size="sm"
              className="gap-2 shadow-lg shadow-primary/20"
            >
              <Plus className="w-4 h-4" />
              Add File
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {knowledgeBase.length > 0 ? (
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-3">
              {knowledgeBase.map((path) => {
                const indexed = isIndexed(path)
                const fileIndexing = indexingFiles.has(path)
                const info = indexStats?.indexedDocuments.find(d => d.source === (path.split('/').pop() || ''))

                return (
                  <div
                    key={path}
                    className={cn(
                      "group flex flex-col p-3 rounded-xl border border-border/50 hover:border-primary/30 transition-all hover:shadow-md bg-secondary/40",
                      indexed && "border-emerald-500/30 bg-emerald-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded bg-background border border-border/50">
                          <FileText className="w-4 h-4 text-amber-400" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate text-foreground">{path.split('/').pop()}</span>
                          <span className="text-[10px] text-muted-foreground truncate font-mono opacity-60">{path}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {indexed && info && (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                            {info.chunks} chunks
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10",
                            fileIndexing && "animate-pulse"
                          )}
                          onClick={() => indexFile(path)}
                          disabled={fileIndexing}
                          title={indexed ? "Re-index file" : "Index file for RAG search"}
                        >
                          {fileIndexing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : indexed ? (
                            <RefreshCw className="w-3.5 h-3.5" />
                          ) : (
                            <Zap className="w-3.5 h-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeKnowledgeFile(path)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
              <FileBox className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-1">No Knowledge Files</h4>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              Files added here will be automatically available for all nodes in this pipeline.
            </p>
          </div>
        )}

        {/* Global Settings / Info */}
        <div className="p-6 border-t border-border/50 bg-secondary/10">
          <div className="flex flex-col gap-4">
            {/* RAG Stats */}
            {indexStats && indexStats.documentCount > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <Database className="w-4 h-4 text-emerald-500 shrink-0" />
                <p className="text-[10px] leading-snug text-muted-foreground">
                  <span className="text-emerald-500 font-semibold">{indexStats.documentCount}</span> documents indexed •{' '}
                  <span className="text-emerald-500 font-semibold">{indexStats.totalChunks}</span> chunks •{' '}
                  <span className="text-emerald-500 font-semibold">{indexStats.totalTokens}</span> tokens total
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <Info className="w-4 h-4 text-primary shrink-0" />
              <p className="text-[10px] leading-snug text-muted-foreground">
                With RAG enabled, only{' '}
                <span className="text-primary font-semibold">relevant chunks</span> are sent to models instead of entire files.
                This can reduce token usage by{' '}
                <span className="text-primary font-semibold">10-100x</span> for large documents.
              </p>
            </div>

            {!activeConfigId && (
              <div className="flex items-center gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-500 font-medium">
                <AlertCircle className="w-3 h-3" />
                Save your pipeline to persist this Knowledge Base.
              </div>
            )}

            {activeConfigId && (
              <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-medium px-1">
                <CheckCircle2 className="w-3 h-3" />
                Changes are automatically saved to your active pipeline.
              </div>
            )}
          </div>
        </div>
      </div>

      <FileSelector
        open={isSelectorOpen}
        onOpenChange={setSelectorOpen}
        onSelect={addKnowledgeFile}
      />

      {/* RAG Search Dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5 text-primary" />
              RAG Search Test
            </DialogTitle>
            <DialogDescription>
              Test the BM25 search to see which chunks would be retrieved for your query.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter search query..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && performSearch()}
              />
              <Button onClick={performSearch} disabled={searching || !searchQuery.trim()}>
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
              </Button>
            </div>

            {searchResults.length > 0 ? (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {searchResults.map((r, i) => (
                    <div key={i} className="p-4 rounded-lg border bg-card/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                          <span className="text-[10px] text-muted-foreground">{r.lines}</span>
                        </div>
                        <Badge className="bg-primary/10 text-primary text-[10px]">Score: {r.score}</Badge>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap font-mono bg-secondary/50 p-3 rounded max-h-[200px] overflow-auto">
                        {r.text}
                      </pre>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : searchQuery && !searching ? (
              <div className="text-center text-muted-foreground py-8">
                No results found. Try indexing your files first.
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}