'use client'

import { useCallback, useState, useRef, useEffect } from 'react'
import { useArenaStore } from '@/lib/store'
import { ArenaNode, ArenaEdge } from '@/lib/types'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { 
  Plus, 
  Trash2, 
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Bot,
  MessageSquare,
  Shield,
  Combine,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Search,
  FileText,
  Radio,
  Split
} from 'lucide-react'

const nodeTypeColors: Record<string, { bg: string; border: string; icon: string }> = {
  model: { 
    bg: 'bg-emerald-500/10', 
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    icon: 'text-emerald-400'
  },
  prompt: { 
    bg: 'bg-blue-500/10', 
    border: 'border-blue-500/30 hover:border-blue-500/60',
    icon: 'text-blue-400'
  },
  validator: { 
    bg: 'bg-orange-500/10', 
    border: 'border-orange-500/30 hover:border-orange-500/60',
    icon: 'text-orange-400'
  },
  aggregator: { 
    bg: 'bg-purple-500/10', 
    border: 'border-purple-500/30 hover:border-purple-500/60',
    icon: 'text-purple-400'
  },
  search: { 
    bg: 'bg-cyan-500/10', 
    border: 'border-cyan-500/30 hover:border-cyan-500/60',
    icon: 'text-cyan-400'
  },
  file: { 
    bg: 'bg-amber-500/10', 
    border: 'border-amber-500/30 hover:border-amber-500/60',
    icon: 'text-amber-400'
  },
  router: {
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30 hover:border-indigo-500/60',
    icon: 'text-indigo-400'
  }
}

const nodeTypeIcons = {
  model: Bot,
  prompt: MessageSquare,
  validator: Shield,
  aggregator: Combine,
  search: Search,
  file: FileText,
  router: Split,
}

export function FlowCanvas() {
  const nodes = useArenaStore(state => state.nodes)
  const edges = useArenaStore(state => state.edges)
  const addNode = useArenaStore(state => state.addNode)
  const updateNode = useArenaStore(state => state.updateNode)
  const removeNode = useArenaStore(state => state.removeNode)
  const addEdge = useArenaStore(state => state.addEdge)
  const removeEdge = useArenaStore(state => state.removeEdge)
  const setSelectedNodeId = useArenaStore(state => state.setSelectedNodeId)
  const selectedNodeId = useArenaStore(state => state.selectedNodeId)
  
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragNodeId, setDragNodeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [connecting, setConnecting] = useState<{ nodeId: string; type: 'output' | 'input' } | null>(null)
  const [hoveredConnector, setHoveredConnector] = useState<{ nodeId: string; type: 'output' | 'input' } | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = (e.clientX - rect.left - pan.x) / zoom
    const y = (e.clientY - rect.top - pan.y) / zoom
    setMousePos({ x, y })

    if (dragNodeId) {
      updateNode(dragNodeId, {
        position: {
          x: x - dragOffset.x,
          y: y - dragOffset.y,
        },
      })
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
    }
  }, [dragNodeId, dragOffset, pan, zoom, updateNode, isPanning, panStart])

  const handleMouseUp = useCallback(() => {
    if (connecting && hoveredConnector && connecting.nodeId !== hoveredConnector.nodeId) {
      const source = connecting.type === 'output' ? connecting.nodeId : hoveredConnector.nodeId
      const target = connecting.type === 'output' ? hoveredConnector.nodeId : connecting.nodeId
      
      const exists = edges.some(e => e.source === source && e.target === target)
      if (!exists) {
        addEdge({
          id: `e-${Date.now()}`,
          source,
          target,
          type: 'data',
        })
      }
    }
    setDragNodeId(null)
    setConnecting(null)
    setIsPanning(false)
  }, [connecting, hoveredConnector, edges, addEdge])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left click
    setIsPanning(true)
    setPanStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    })
  }

  const handleNodeMouseDown = (e: React.MouseEvent, node: ArenaNode) => {
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = (e.clientX - rect.left - pan.x) / zoom
    const y = (e.clientY - rect.top - pan.y) / zoom

    setDragNodeId(node.id)
    setDragOffset({
      x: x - node.position.x,
      y: y - node.position.y,
    })
    setSelectedNodeId(node.id)
  }

  const handleConnectorMouseDown = (e: React.MouseEvent, nodeId: string, type: 'output' | 'input') => {
    e.stopPropagation()
    setConnecting({ nodeId, type })
  }

  const handleAddNode = (type: ArenaNode['type']) => {
    const newNode: ArenaNode = {
      id: `node-${Date.now()}`,
      type,
      position: { x: mousePos.x, y: mousePos.y },
      data: { 
        label: type === 'model' ? 'New Model' : 
               type === 'prompt' ? 'New Prompt' :
               type === 'validator' ? 'New Validator' : 
               type === 'search' ? 'New Search' : 
               type === 'file' ? 'New File' : 'New Aggregator'
      },
    }
    addNode(newNode)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.min(Math.max(z * delta, 0.25), 2))
  }

  const renderEdge = (edge: ArenaEdge) => {
    const sourceNode = nodes.find(n => n.id === edge.source)
    const targetNode = nodes.find(n => n.id === edge.target)
    if (!sourceNode || !targetNode) return null

    const startX = sourceNode.position.x + 140
    const startY = sourceNode.position.y + 35
    const endX = targetNode.position.x
    const endY = targetNode.position.y + 35

    const controlX1 = startX + (endX - startX) * 0.5
    const controlX2 = startX + (endX - startX) * 0.5

    const edgeColor = edge.type === 'validation' ? '#f97316' : 
                      edge.type === 'feedback' ? '#8b5cf6' : '#ffffff'

    const isActive = targetNode.data.status === 'running' || sourceNode.data.status === 'running'

    return (
      <g key={edge.id}>
        <path
          d={`M ${startX} ${startY} C ${controlX1} ${startY}, ${controlX2} ${endY}, ${endX} ${endY}`}
          stroke={isActive ? '#10b981' : edgeColor}
          strokeWidth={isActive ? 4 : 3}
          fill="none"
          strokeDasharray={isActive ? "8,8" : "none"}
          opacity={isActive ? 1 : 0.6}
          className={cn(
            "transition-all duration-300", 
            !isActive && "hover:opacity-100"
          )}
        >
          {isActive && (
            <animate
              attributeName="stroke-dashoffset"
              values="16;0"
              dur="0.8s"
              repeatCount="indefinite"
            />
          )}
        </path>
        <circle cx={endX} cy={endY} r={5} fill={isActive ? '#10b981' : edgeColor} className="transition-colors duration-300" />
      </g>
    )
  }

  const renderConnectionLine = () => {
    if (!connecting) return null
    
    const sourceNode = nodes.find(n => n.id === connecting.nodeId)
    if (!sourceNode) return null

    const startX = connecting.type === 'output' 
      ? sourceNode.position.x + 140 
      : sourceNode.position.x
    const startY = sourceNode.position.y + 35

    return (
      <path
        d={`M ${startX} ${startY} L ${mousePos.x} ${mousePos.y}`}
        stroke="#ffffff"
        strokeWidth={3}
        strokeDasharray="5,5"
        fill="none"
        opacity={0.8}
      />
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div 
          ref={canvasRef}
          className={cn(
            "flex-1 relative overflow-hidden bg-background select-none",
            isPanning ? "cursor-grabbing" : "cursor-grab"
          )}
          onMouseMove={handleMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* Grid background */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(to right, hsl(var(--border) / 0.3) 1px, transparent 1px),
                linear-gradient(to bottom, hsl(var(--border) / 0.3) 1px, transparent 1px)
              `,
              backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          />

          {/* Canvas content */}
          <div
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Edges */}
            <svg className="absolute inset-0 w-full h-full overflow-visible">
              {edges.map(renderEdge)}
              {renderConnectionLine()}
            </svg>

            {/* Nodes */}
            <div className="absolute inset-0 pointer-events-auto">
            {nodes.map((node) => {
              const colors = nodeTypeColors[node.type]
              const Icon = nodeTypeIcons[node.type]
              const isSelected = selectedNodeId === node.id

              return (
                <div
                  key={node.id}
                  className={cn(
                    'absolute w-36 rounded-lg border-2 cursor-pointer transition-all group/node',
                    node.data.isGlobal ? 'bg-amber-500/5 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : colors.bg,
                    node.data.isGlobal ? 'hover:border-amber-400' : colors.border,
                    isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    node.data.status === 'skipped' && 'opacity-50 grayscale'
                  )}
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedNodeId(node.id)
                  }}
                >
                  {/* Input connector */}
                  <div
                    className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background border-2 border-border hover:border-primary hover:bg-primary/20 transition-colors cursor-crosshair z-10"
                    onMouseDown={(e) => handleConnectorMouseDown(e, node.id, 'input')}
                    onMouseEnter={() => setHoveredConnector({ nodeId: node.id, type: 'input' })}
                    onMouseLeave={() => setHoveredConnector(null)}
                  />

                  {/* Node content */}
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('w-4 h-4', colors.icon)} />
                        <span className="text-xs font-medium text-foreground truncate">
                          {node.data.label}
                        </span>
                      </div>
                      
                      {/* Status indicator */}
                      {node.data.isGlobal && <Radio className="w-3 h-3 text-amber-500 animate-pulse" />}
                      {node.type === 'file' && node.data.isSmartRead && <Code className="w-3 h-3 text-emerald-500" />}
                      {node.data.status === 'running' && <RefreshCw className="w-3 h-3 text-primary animate-spin" />}
                      {node.data.status === 'completed' && <CheckCircle className="w-3 h-3 text-emerald-500" />}
                      {node.data.status === 'error' && <AlertCircle className="w-3 h-3 text-destructive" />}
                    </div>
                    
                    <div className="text-[10px] text-muted-foreground capitalize">
                      {node.type}
                    </div>

                    {/* Result preview */}
                    {node.data.result && (
                      <div 
                        className="mt-2 text-[10px] text-muted-foreground border-t border-border/50 pt-2 cursor-pointer hover:text-foreground transition-all max-h-48 overflow-y-auto overflow-x-hidden break-words custom-scrollbar"
                      >
                        {['model', 'aggregator'].includes(node.type) && node.data.status === 'completed' ? (
                          <div className="prose prose-invert prose-xs max-w-none text-[10px] leading-tight">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({node, ...props}) => <h1 className="text-sm font-bold mt-2 mb-1" {...props} />,
                                h2: ({node, ...props}) => <h2 className="text-xs font-bold mt-2 mb-1" {...props} />,
                                h3: ({node, ...props}) => <h3 className="text-[10px] font-bold mt-1 mb-1" {...props} />,
                                p: ({node, ...props}) => <p className="mb-1" {...props} />,
                                ul: ({node, ...props}) => <ul className="list-disc pl-3 mb-1 space-y-0.5" {...props} />,
                                ol: ({node, ...props}) => <ol className="list-decimal pl-3 mb-1 space-y-0.5" {...props} />,
                                li: ({node, ...props}) => <li className="" {...props} />,
                                code: ({node, className, children, ...props}) => {
                                  const match = /language-(\w+)/.exec(className || '')
                                  return (
                                    <code className={`font-mono text-[9px] bg-secondary px-1 py-0.5 rounded ${className || ''}`} {...props}>
                                      {children}
                                    </code>
                                  )
                                },
                                pre: ({node, ...props}) => (
                                  <pre className="bg-secondary/50 border border-border rounded p-1.5 overflow-x-auto mb-1 font-mono text-[9px]" {...props} />
                                ),
                                a: ({node, ...props}) => <a className="text-primary underline hover:text-primary/80" {...props} />
                              }}
                            >
                              {node.data.result as string}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <>
                            {node.data.result.slice(0, 150)}{node.data.result.length > 150 ? '...' : ''}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Output connector */}
                  <div
                    className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background border-2 border-border hover:border-primary hover:bg-primary/20 transition-colors cursor-crosshair z-10"
                    onMouseDown={(e) => handleConnectorMouseDown(e, node.id, 'output')}
                    onMouseEnter={() => setHoveredConnector({ nodeId: node.id, type: 'output' })}
                    onMouseLeave={() => setHoveredConnector(null)}
                  />
                </div>
              )
            })}
            </div>
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-card border border-border rounded-lg p-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setZoom(z => Math.min(z * 1.2, 2))}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setZoom(z => Math.max(z * 0.8, 0.25))}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <div className="w-px h-4 bg-border" />
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>

          {/* Add node toolbar */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-card border border-border rounded-lg p-1">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('model')}
            >
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              Model
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('prompt')}
            >
              <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
              Prompt
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('validator')}
            >
              <Shield className="w-3.5 h-3.5 text-orange-400" />
              Validator
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('aggregator')}
            >
              <Combine className="w-3.5 h-3.5 text-purple-400" />
              Aggregator
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('search')}
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              Search
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('file')}
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              File
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 gap-1.5 text-xs"
              onClick={() => handleAddNode('router')}
            >
              <Split className="w-3.5 h-3.5 text-indigo-400" />
              Router
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => handleAddNode('model')}>
          <Bot className="w-4 h-4 mr-2 text-emerald-400" />
          Add Model Node
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleAddNode('prompt')}>
          <MessageSquare className="w-4 h-4 mr-2 text-blue-400" />
          Add Prompt Node
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleAddNode('validator')}>
          <Shield className="w-4 h-4 mr-2 text-orange-400" />
          Add Validator Node
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleAddNode('aggregator')}>
          <Combine className="w-4 h-4 mr-2 text-purple-400" />
          Add Aggregator Node
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleAddNode('search')}>
          <Search className="w-4 h-4 mr-2 text-cyan-400" />
          Add Search Node
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleAddNode('file')}>
          <FileText className="w-4 h-4 mr-2 text-amber-400" />
          Add File Node
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>
          <Maximize2 className="w-4 h-4 mr-2" />
          Reset View
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
