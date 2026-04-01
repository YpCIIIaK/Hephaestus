'use client'

import { useState, useMemo } from 'react'
import { useArenaStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  Plus, 
  Play, 
  Save, 
  Download,
  Upload,
  Layers,
  GitBranch,
  Settings2,
  Sparkles,
  Zap,
  Settings,
  RefreshCw,
  Trash2,
  BookOpen,
  ChevronDown,
  Calculator,
  ShieldAlert
} from 'lucide-react'
import { FlowCanvas } from '@/components/flow-canvas'
import { NodeSettings } from '@/components/node-settings'
import { ModelLibrary } from './model-library'
import { ArenaStats } from './arena-stats'
import { KnowledgeBase } from './knowledge-base'
import { executePipeline } from '@/lib/executor'
import { BatchRunnerModal } from './batch-runner-modal'

export function ArenaPanel() {
  const nodes = useArenaStore(state => state.nodes)
  const edges = useArenaStore(state => state.edges)
  const selectedNodeId = useArenaStore(state => state.selectedNodeId)
  const setSelectedNodeId = useArenaStore(state => state.setSelectedNodeId)
  const updateNodeData = useArenaStore(state => state.updateNodeData)
  const configs = useArenaStore(state => state.configs)
  const activeConfigId = useArenaStore(state => state.activeConfigId)
  const saveConfig = useArenaStore(state => state.saveConfig)
  const loadConfig = useArenaStore(state => state.loadConfig)
  const [arenaTab, setArenaTab] = useState<'canvas' | 'models' | 'stats' | 'knowledge'>('canvas')
  const [pipelineInput, setPipelineInput] = useState('') // Added local state
  const [isExecuting, setIsExecuting] = useState(false) // Added local state
  const [showEstimateDialog, setShowEstimateDialog] = useState(false)
  const [estimateData, setEstimateData] = useState({ tokens: 0, cost: 0 })

  const { levelCount, modelCount } = useMemo(() => {
    if (nodes.length === 0) return { levelCount: 0, modelCount: 0 }

    const depths: Record<string, number> = {}
    nodes.forEach(n => depths[n.id] = 1)

    // Simple Bellman-Ford style depth propagation for small DAGs
    let changed = true
    for (let i = 0; i < nodes.length && changed; i++) {
      changed = false
      edges.forEach(edge => {
        if (depths[edge.source] && depths[edge.target] !== undefined) {
          const newDepth = depths[edge.source] + 1
          if (newDepth > depths[edge.target]) {
            depths[edge.target] = newDepth
            changed = true
          }
        }
      })
    }

    return {
      levelCount: nodes.length > 0 ? Math.max(...Object.values(depths)) : 0,
      modelCount: nodes.filter(n => n.type === 'model').length
    }
  }, [nodes, edges])

  const calculateEstimate = () => {
    const inputLength = pipelineInput.length
    const globalFilesLength = nodes
      .filter(n => n.type === 'file' && n.data.isGlobal && typeof n.data.result === 'string')
      .reduce((acc, n) => acc + (n.data.result as string).length, 0)
      
    const aiNodeCount = nodes.filter(n => ['model', 'validator', 'aggregator', 'router'].includes(n.type)).length
    const totalInputChars = (inputLength + globalFilesLength) * aiNodeCount
    const estimatedTokens = Math.ceil(totalInputChars / 3.5)
    
    // Rough average: $2.50 per 1M tokens
    const estimatedCost = (estimatedTokens / 1000000) * 2.50
    
    const data = { tokens: estimatedTokens, cost: estimatedCost }
    setEstimateData(data)
    return data
  }

  const handleRunPipeline = () => {
    const { tokens, cost } = calculateEstimate()
    if (tokens > 20000 || cost > 0.05) {
      setShowEstimateDialog(true)
    } else {
      executeNow()
    }
  }

  const executeNow = async (isDryRun = false) => {
    setShowEstimateDialog(false)
    setIsExecuting(true)
    try {
      await executePipeline(nodes, edges, pipelineInput, (id, status, result) => {
        updateNodeData(id, { status: status as any, result })
      }, {}, undefined, { isDryRun })
    } catch (error) {
      console.error("Pipeline execution failed:", error)
    } finally {
      setIsExecuting(false)
    }
  }

  const handleExport = () => {
    const data = JSON.stringify({ nodes, edges }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'arena-pipeline.json'
    a.click()
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (re) => {
           try {
             const data = JSON.parse(re.target?.result as string)
             if (data.nodes && data.edges) {
               useArenaStore.setState({ nodes: data.nodes, edges: data.edges })
             }
           } catch(err) {
             alert('Invalid pipeline JSON format.')
           }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }

  return (
    <div className="flex flex-col h-full bg-background w-full min-w-0 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-4 border-b border-border gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Arena Configuration</h1>
          <p className="text-sm text-muted-foreground hidden sm:block">
            Design and orchestrate your multi-model pipeline
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[10px] sm:text-xs">
            <Layers className="w-3 h-3" />
            {levelCount} <span className="hidden xs:inline">Levels</span>
          </Badge>
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[10px] sm:text-xs">
            <GitBranch className="w-3 h-3" />
            {modelCount} <span className="hidden xs:inline">Models</span>
          </Badge>
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[10px] sm:text-xs">
            <Zap className="w-3 h-3" />
            {edges.length} <span className="hidden xs:inline">Conns</span>
          </Badge>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between px-4 sm:px-6 py-3 border-b border-border bg-card/50 gap-4">
        <div className="flex items-center justify-between sm:justify-start gap-4 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          <Tabs value={arenaTab} onValueChange={(v) => setArenaTab(v as typeof arenaTab)}>
            <TabsList className="bg-secondary h-8">
              <TabsTrigger value="canvas" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
                <GitBranch className="w-3 h-3 sm:w-4 sm:h-4" />
                Pipeline
              </TabsTrigger>
              <TabsTrigger value="models" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
                <Sparkles className="w-3 h-3 sm:w-4 sm:h-4" />
                Models
              </TabsTrigger>
              <TabsTrigger value="stats" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
                <Settings2 className="w-3 h-3 sm:w-4 sm:h-4" />
                Stats
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
                <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
                Knowledge
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
             <Button variant="outline" size="sm" className="h-8 px-2 hidden sm:flex" onClick={handleImport}>
              <Upload className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 hidden sm:flex" onClick={handleExport}>
              <Download className="w-4 h-4" />
            </Button>
            <Button 
                variant="outline" 
                size="sm" 
                className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 hidden sm:flex"
                onClick={() => {
                  if (window.confirm('Are you sure you want to clear the canvas?')) {
                    useArenaStore.setState({ nodes: [], edges: [], activeConfigId: null })
                  }
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
          </div>
        </div>

        <div className="flex flex-col xs:flex-row items-center gap-3">
          <div className="flex items-center gap-2 w-full xs:w-auto">
            <Select 
              value={activeConfigId || "new"} 
              onValueChange={(val) => {
                if (val === "new") {
                  useArenaStore.setState({ nodes: [], edges: [], activeConfigId: null })
                } else {
                  loadConfig(val)
                }
              }}
            >
              <SelectTrigger className="flex-1 xs:w-[150px] h-9 sm:h-8 text-xs sm:text-sm">
                <SelectValue placeholder="Pipeline" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New Pipeline</SelectItem>
                {configs.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" className="h-9 sm:h-8" onClick={() => {
              const name = window.prompt('Enter name:', activeConfigId ? configs.find(c => c.id === activeConfigId)?.name : 'My Pipeline')
              if (name) {
                const id = activeConfigId || Date.now().toString()
                saveConfig({ id, name, description: '', nodes, edges, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
                useArenaStore.setState({ activeConfigId: id })
              }
            }}>
              <Save className="w-4 h-4 mr-2 hidden sm:inline" /> Save
            </Button>

            {activeConfigId && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-9 sm:h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (window.confirm('Are you sure you want to delete this pipeline preset?')) {
                    useArenaStore.getState().deleteConfig(activeConfigId)
                  }
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full xs:w-auto">
            <Input 
              placeholder="Input context..." 
              value={pipelineInput}
              onChange={(e) => setPipelineInput(e.target.value)}
              className="flex-1 xs:w-48 sm:w-64 h-9 sm:h-8 text-xs sm:text-sm"
              disabled={isExecuting}
            />
            {isExecuting ? (
              <Button 
                variant="destructive"
                size="sm" 
                className="gap-2 h-9 sm:h-8 animate-in zoom-in-95 duration-200" 
                onClick={() => useArenaStore.getState().abortGeneration()}
              >
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Stop</span>
              </Button>
            ) : (
              <div className="flex items-center">
                <Button size="sm" className="gap-2 h-9 sm:h-8 rounded-r-none" onClick={handleRunPipeline}>
                  <Play className="w-4 h-4" />
                  <span className="hidden xs:inline">Run Pipeline</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="default" className="h-9 sm:h-8 px-2 rounded-l-none border-l bg-primary hover:bg-primary/90">
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                       const data = calculateEstimate();
                       setShowEstimateDialog(true);
                    }}>
                      <Calculator className="w-4 h-4 mr-2" />
                      Estimate Tokens
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-amber-500 focus:text-amber-500 focus:bg-amber-500/10"
                      onClick={() => executeNow(true)}
                    >
                      <ShieldAlert className="w-4 h-4 mr-2" />
                      Dry Run (Preview Prompts)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => document.dispatchEvent(new CustomEvent('open-batch-runner'))}>
                      <Layers className="w-4 h-4 mr-2" />
                      Batch Run...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {arenaTab === 'canvas' && (
          <>
            <FlowCanvas />
            {selectedNodeId && (
              <div className="absolute lg:relative top-0 right-0 w-full sm:w-80 shrink-0 h-full border-l border-border bg-card shadow-2xl lg:shadow-none z-30 flex flex-col min-h-0 overflow-x-hidden">
                 <div className="lg:hidden p-2 border-b border-border flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedNodeId(null)}>
                    <Trash2 className="w-4 h-4 mr-2" /> Close Settings
                  </Button>
                </div>
                <NodeSettings />
              </div>
            )}
          </>
        )}
        {arenaTab === 'models' && <ModelLibrary />}
        {arenaTab === 'stats' && <ArenaStats />}
        {arenaTab === 'knowledge' && (
          <div className="flex-1 p-6 overflow-hidden min-h-0 bg-secondary/5">
            <KnowledgeBase />
          </div>
        )}
      </div>

      <AlertDialog open={showEstimateDialog} onOpenChange={setShowEstimateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pre-Flight Token Estimate</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4 pt-4 whitespace-normal">
              <div className="flex flex-col gap-2 p-4 bg-muted/50 rounded-lg">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-2"><Calculator className="w-4 h-4" /> Estimated Tokens:</span>
                  <span className="font-mono font-medium">{estimateData.tokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-2"><Zap className="w-4 h-4" /> Max Estimated Cost:</span>
                  <span className="font-mono font-medium text-amber-500">
                    ~${estimateData.cost.toFixed(4)}
                  </span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground border-l-2 border-amber-500/50 pl-3">
                This estimate calculates the sum of all input text and global files multiplied by the number of AI nodes. Overlapping outputs and pruned paths (routers) will typically result in lower real counts.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => executeNow(false)} className="gap-2 bg-amber-500 hover:bg-amber-600 text-white">
              <Play className="w-4 h-4 fill-white" />
              Run Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <BatchRunnerModal />
    </div>
  )
}
