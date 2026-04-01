'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useArenaStore } from '@/lib/store'
import { executePipeline } from '@/lib/executor'
import { Play, Loader2, CheckCircle2, AlertCircle, Trash2, Download, Table2, FileText } from 'lucide-react'
import { downloadBatchResultsCSV } from '@/lib/export-utils'

type BatchItem = {
  id: string
  input: string
  status: 'pending' | 'running' | 'done' | 'error'
  resultMap?: Record<string, string>
  error?: string
}

export function BatchRunnerModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [items, setItems] = useState<BatchItem[]>([])
  const [isRunning, setIsRunning] = useState(false)
  
  const nodes = useArenaStore(state => state.nodes)
  const edges = useArenaStore(state => state.edges)

  useEffect(() => {
    const handleOpen = () => setIsOpen(true)
    document.addEventListener('open-batch-runner', handleOpen)
    return () => document.removeEventListener('open-batch-runner', handleOpen)
  }, [])

  const startBatch = async () => {
    const lines = inputText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const newItems: BatchItem[] = lines.map((line, idx) => ({
      id: `batch-${Date.now()}-${idx}`,
      input: line,
      status: 'pending'
    }))

    setItems(newItems)
    setIsRunning(true)

    // Execute sequentially to avoid crushing rate limits
    for (let i = 0; i < newItems.length; i++) {
      if (!isOpen) break // Stop if modal closed early? Actually we should let it run unless we have an abort signal.
      
      const item = newItems[i]
      
      setItems(current => current.map((c, j) => j === i ? { ...c, status: 'running' } : c))
      
      try {
        const { results } = await executePipeline(nodes, edges, item.input, () => {})
        setItems(current => current.map((c, j) => j === i ? { ...c, status: 'done', resultMap: results } : c))
      } catch (err: any) {
        setItems(current => current.map((c, j) => j === i ? { ...c, status: 'error', error: err.message } : c))
      }
    }

    setIsRunning(false)
  }

  // Format the outputs nicely for the user
  const renderResults = (resultMap: Record<string, string>) => {
    const outputNodes = nodes.filter(n => ['model', 'aggregator', 'router'].includes(n.type))
    
    return (
      <div className="space-y-4">
        {outputNodes.map(node => {
          const res = resultMap[node.id]
          if (!res) return null
          
          return (
            <div key={node.id} className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground">{node.data.label}</h4>
              <div className="p-3 bg-muted rounded-md text-sm whitespace-pre-wrap font-mono text-foreground">
                {res}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Batch Runner</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4 mt-2">
          {items.length === 0 || !isRunning ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Paste a list of inputs (one per line). The pipeline will process them sequentially.
              </p>
              <Textarea
                placeholder="Query 1...\nQuery 2...\nQuery 3..."
                className="min-h-[150px] resize-none font-mono text-xs"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={isRunning}
              />
              <div className="flex justify-between items-center pt-2">
                <Button variant="ghost" size="sm" onClick={() => { setInputText(''); setItems([]) }} disabled={isRunning}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear
                </Button>
                <Button size="sm" onClick={startBatch} disabled={isRunning || !inputText.trim() || nodes.length === 0}>
                   <Play className="w-4 h-4 mr-2" />
                   Start Batch ({inputText.split('\n').filter(l => l.trim()).length} items)
                </Button>
              </div>
            </div>
          ) : null}

          {items.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Export buttons for batch results */}
              {!isRunning && items.some(i => i.status === 'done') && (
                <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
                  <span className="text-xs text-muted-foreground">
                    {items.filter(i => i.status === 'done').length} of {items.length} completed
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      const results = items
                        .filter(i => i.status === 'done' && i.resultMap)
                        .map(item => {
                          // Get the final output (prefer aggregator, then validator, then first model)
                          const outputNodes = nodes.filter(n => ['model', 'aggregator', 'validator'].includes(n.type))
                          const aggNode = outputNodes.find(n => n.type === 'aggregator')
                          const valNode = outputNodes.find(n => n.type === 'validator')
                          const modelNodes = outputNodes.filter(n => n.type === 'model')
                          
                          const finalOutput = aggNode && item.resultMap?.[aggNode.id] 
                            ? item.resultMap[aggNode.id]
                            : valNode && item.resultMap?.[valNode.id]
                            ? item.resultMap[valNode.id]
                            : modelNodes.length > 0 && item.resultMap?.[modelNodes[0].id]
                            ? item.resultMap[modelNodes[0].id]
                            : Object.values(item.resultMap || {})[0] || ''
                          
                          return {
                            input: item.input,
                            output: finalOutput,
                            modelId: 'pipeline',
                            latency: 0,
                            tokens: Math.ceil(finalOutput.length / 4)
                          }
                        })
                      
                      if (results.length > 0) {
                        downloadBatchResultsCSV(
                          results.map(r => r.input),
                          results,
                          `batch-results-${new Date().toISOString().slice(0, 10)}.csv`
                        )
                      }
                    }}
                  >
                    <Table2 className="w-4 h-4" />
                    Export CSV
                  </Button>
                </div>
              )}
              <Accordion type="single" collapsible className="w-full">
                {items.map((item, idx) => (
                  <AccordionItem value={item.id} key={item.id} className="border-b last:border-b-0">
                    <AccordionTrigger className="hover:no-underline hover:bg-muted/50 px-4 py-3">
                      <div className="flex items-center gap-3 w-full text-left pr-4">
                        <span className="text-xs text-muted-foreground w-6 font-mono">{idx + 1}.</span>
                        
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="text-sm font-medium truncate">{item.input}</p>
                        </div>

                        <div className="shrink-0 flex items-center justify-end w-24">
                          {item.status === 'pending' && <span className="text-xs text-muted-foreground w-full text-right">Pending...</span>}
                          {item.status === 'running' && (
                            <div className="flex items-center text-primary w-full justify-end text-xs">
                              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Running
                            </div>
                          )}
                          {item.status === 'done' && (
                            <div className="flex items-center text-emerald-500 w-full justify-end text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Done
                            </div>
                          )}
                          {item.status === 'error' && (
                            <div className="flex items-center text-destructive w-full justify-end text-xs">
                              <AlertCircle className="w-3.5 h-3.5 mr-1.5" /> Error
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    
                    {(item.status === 'done' || item.status === 'error') && (
                      <AccordionContent className="px-4 pb-4 pt-2 border-t border-border bg-background/50">
                        {item.status === 'error' ? (
                          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                            {item.error}
                          </div>
                        ) : (
                          item.resultMap && renderResults(item.resultMap)
                        )}
                      </AccordionContent>
                    )}
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
