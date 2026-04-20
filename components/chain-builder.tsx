'use client'

import { useState, useCallback, useEffect } from 'react'
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  Handle,
  Position,
  Panel
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Play, 
  Save, 
  Trash2, 
  Plus, 
  Settings, 
  Mail, 
  Send, 
  Hash, 
  FileText, 
  Calendar, 
  Globe, 
  Rss, 
  Clock,
  FolderOpen,
  Webhook,
  Bot,
  GitBranch,
  Timer,
  Repeat
} from 'lucide-react'
import { Chain, ChainNode, ChainEdge } from '@/lib/chains'
import { Action } from '@/lib/actions'
import { Trigger, schedulePresets, fileWatchPresets } from '@/lib/triggers'

// Node types for visual editor
const nodeTypes = {
  action: ActionNode,
  agent: AgentNode,
  condition: ConditionNode,
  delay: DelayNode,
  trigger: TriggerNode,
}

// Action Node Component
function ActionNode({ data, selected }: { data: any; selected?: boolean }) {
  const icons: Record<string, any> = {
    'send-email': Mail,
    'send-telegram': Send,
    'send-slack': Hash,
    'create-notion-page': FileText,
    'create-calendar-event': Calendar,
    'fetch-rss': Rss,
    'web-scrape': Globe,
  }
  
  const Icon = icons[data.actionId] || Bot
  
  return (
    <div className={`p-3 rounded-lg border-2 bg-card min-w-[180px] ${selected ? 'border-primary' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-primary" />
        <span className="font-medium text-sm truncate">{data.label}</span>
      </div>
      {data.actionId && (
        <Badge variant="outline" className="text-[10px]">
          {data.actionId}
        </Badge>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3" />
    </div>
  )
}

// Agent Node Component
function AgentNode({ data, selected }: { data: any; selected?: boolean }) {
  return (
    <div className={`p-3 rounded-lg border-2 bg-card min-w-[180px] ${selected ? 'border-primary' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <Bot className="w-4 h-4 text-violet-500" />
        <span className="font-medium text-sm">{data.label}</span>
      </div>
      {data.role && (
        <Badge variant="secondary" className="text-[10px]">
          {data.role}
        </Badge>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3" />
    </div>
  )
}

// Condition Node Component
function ConditionNode({ data, selected }: { data: any; selected?: boolean }) {
  return (
    <div className={`p-3 rounded-lg border-2 bg-card min-w-[180px] ${selected ? 'border-primary' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="w-4 h-4 text-amber-500" />
        <span className="font-medium text-sm">{data.label}</span>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Yes →</span>
        <span>← No</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" className="!w-3 !h-3 !bg-green-500" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="false" className="!w-3 !h-3 !bg-red-500" style={{ left: '70%' }} />
    </div>
  )
}

// Delay Node Component
function DelayNode({ data, selected }: { data: any; selected?: boolean }) {
  return (
    <div className={`p-3 rounded-lg border-2 bg-card min-w-[140px] ${selected ? 'border-primary' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3" />
      <div className="flex items-center gap-2">
        <Timer className="w-4 h-4 text-cyan-500" />
        <span className="font-medium text-sm">{data.label}</span>
      </div>
      {data.delayMs && (
        <span className="text-[10px] text-muted-foreground">
          {data.delayMs >= 60000 
            ? `${Math.round(data.delayMs / 60000)}m` 
            : `${Math.round(data.delayMs / 1000)}s`}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3" />
    </div>
  )
}

// Trigger Node Component
function TriggerNode({ data, selected }: { data: any; selected?: boolean }) {
  const icons: Record<string, any> = {
    schedule: Clock,
    file_watch: FolderOpen,
    webhook: Webhook,
    manual: Play,
  }
  
  const Icon = icons[data.triggerType] || Play
  
  return (
    <div className={`p-3 rounded-lg border-2 bg-card min-w-[160px] ${selected ? 'border-primary' : 'border-border'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-emerald-500" />
        <span className="font-medium text-sm">{data.label}</span>
      </div>
      {data.triggerType && (
        <Badge variant="outline" className="text-[10px]">
          {data.triggerType}
        </Badge>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3" />
    </div>
  )
}

// Custom node/edge types for React Flow
type CustomNodeData = {
  label: string
  actionId?: string
  triggerType?: string
  role?: string
  delayMs?: number
  [key: string]: any
}

type CustomNode = Node<CustomNodeData>
type CustomEdge = Edge

interface ChainBuilderProps {
  initialChain?: Chain
  onSave?: (chain: Chain) => void
  onExecute?: (chain: Chain) => void
}

export function ChainBuilder({ initialChain, onSave, onExecute }: ChainBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CustomNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<CustomEdge>([])
  const [selectedNode, setSelectedNode] = useState<CustomNode | null>(null)
  const [chainName, setChainName] = useState(initialChain?.name || 'New Chain')
  const [chainDescription, setChainDescription] = useState(initialChain?.description || '')
  const [actions, setActions] = useState<Action[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState<any>(null)

  // Load available actions
  useEffect(() => {
    fetch('/api/actions')
      .then(res => res.json())
      .then(data => setActions(data.actions || []))
      .catch(console.error)
  }, [])

  // Load initial chain
  useEffect(() => {
    if (initialChain) {
      setChainName(initialChain.name)
      setChainDescription(initialChain.description)
      
      // Convert chain nodes to ReactFlow nodes
      const flowNodes: CustomNode[] = initialChain.nodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        position: { x: 100 + (index % 3) * 250, y: 100 + Math.floor(index / 3) * 150 },
        data: {
          label: node.name,
          ...node.config,
        },
      }))
      
      // Convert chain edges to ReactFlow edges
      const flowEdges: CustomEdge[] = initialChain.edges.map((edge, index) => ({
        id: edge.id || `e-${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
      }))
      
      setNodes(flowNodes)
      setEdges(flowEdges)
    }
  }, [initialChain, setNodes, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds: CustomEdge[]) => addEdge({ ...connection, animated: true }, eds))
  }, [setEdges])

  const onNodeClick = useCallback((_: React.MouseEvent, node: CustomNode) => {
    setSelectedNode(node)
  }, [])

  const addNode = (type: string, config: any = {}) => {
    const id = `${type}-${Date.now()}`
    const newNode: CustomNode = {
      id,
      type,
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 },
      data: { label: config.name || type, ...config },
    }
    setNodes((nds) => [...nds, newNode])
  }

  const updateNode = (nodeId: string, updates: any) => {
    setNodes((nds: CustomNode[]) =>
      nds.map((n: CustomNode) => {
        if (n.id === nodeId) {
          return { ...n, data: { ...n.data, ...updates } }
        }
        return n
      })
    )
    setSelectedNode(null)
  }

  const deleteNode = (nodeId: string) => {
    setNodes((nds: CustomNode[]) => nds.filter((n: CustomNode) => n.id !== nodeId))
    setEdges((eds: CustomEdge[]) => eds.filter((e: CustomEdge) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNode(null)
  }

  const buildChain = (): Chain => {
    const chainNodes: ChainNode[] = nodes.map((n: CustomNode) => ({
      id: n.id,
      type: n.type as ChainNode['type'],
      name: n.data.label,
      config: n.data,
      nextNodeId: edges.find((e) => e.source === n.id)?.target,
    }))

    const chainEdges: ChainEdge[] = edges.map((e: CustomEdge, index: number) => ({
      id: e.id || `edge-${index}`,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    }))

    return {
      id: initialChain?.id || `chain-${Date.now()}`,
      name: chainName,
      description: chainDescription,
      nodes: chainNodes,
      edges: chainEdges,
      triggerIds: [],
      enabled: true,
      createdAt: initialChain?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionCount: initialChain?.executionCount || 0,
    }
  }

  const saveChain = async () => {
    const chain = buildChain()
    
    const res = await fetch('/api/chains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chain),
    })

    if (res.ok) {
      onSave?.(chain)
    }
  }

  const executeChain = async () => {
    const chain = buildChain()
    setIsExecuting(true)
    setExecutionResult(null)

    try {
      const res = await fetch(`/api/chains/${chain.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: {} }),
      })

      const result = await res.json()
      setExecutionResult(result)
      onExecute?.(chain)
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Left Sidebar - Toolbox */}
      <div className="w-64 border-r border-border bg-muted/30 flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-sm">Chain Builder</h3>
          <p className="text-xs text-muted-foreground">Drag nodes to canvas</p>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-6">
            {/* Triggers */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">TRIGGERS</h4>
              <div className="space-y-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => addNode('trigger', { name: 'Schedule', triggerType: 'schedule' })}
                >
                  <Clock className="w-3 h-3 mr-2" />
                  Schedule
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => addNode('trigger', { name: 'File Watch', triggerType: 'file_watch' })}
                >
                  <FolderOpen className="w-3 h-3 mr-2" />
                  File Watch
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => addNode('trigger', { name: 'Webhook', triggerType: 'webhook' })}
                >
                  <Webhook className="w-3 h-3 mr-2" />
                  Webhook
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">ACTIONS</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {actions.slice(0, 10).map((action) => (
                  <Button 
                    key={action.id}
                    variant="outline" 
                    size="sm" 
                    className="w-full justify-start text-xs"
                    onClick={() => addNode('action', { name: action.name, actionId: action.id })}
                  >
                    <span className="truncate">{action.name}</span>
                  </Button>
                ))}
                {actions.length === 0 && (
                  <p className="text-xs text-muted-foreground">Loading actions...</p>
                )}
              </div>
            </div>

            {/* Flow Control */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">FLOW</h4>
              <div className="space-y-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => addNode('agent', { name: 'Agent', role: 'analyst' })}
                >
                  <Bot className="w-3 h-3 mr-2" />
                  AI Agent
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => addNode('condition', { name: 'Condition' })}
                >
                  <GitBranch className="w-3 h-3 mr-2" />
                  Condition
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => addNode('delay', { name: 'Delay', delayMs: 5000 })}
                >
                  <Timer className="w-3 h-3 mr-2" />
                  Delay
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Input
              value={chainName}
              onChange={(e) => setChainName(e.target.value)}
              className="w-64 font-semibold"
              placeholder="Chain name..."
            />
            <Input
              value={chainDescription}
              onChange={(e) => setChainDescription(e.target.value)}
              className="w-64 text-sm"
              placeholder="Description..."
            />
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={saveChain}
            >
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
            <Button 
              size="sm"
              onClick={executeChain}
              disabled={isExecuting}
            >
              <Play className="w-4 h-4 mr-2" />
              {isExecuting ? 'Running...' : 'Execute'}
            </Button>
          </div>
        </div>

        {/* Flow Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-right" className="m-4">
              <Card className="p-2">
                <div className="text-xs text-muted-foreground">
                  {nodes.length} nodes · {edges.length} connections
                </div>
              </Card>
            </Panel>
          </ReactFlow>
        </div>

        {/* Execution Result */}
        {executionResult && (
          <div className="p-4 border-t border-border bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">Execution Result:</span>
              <Badge variant={executionResult.success ? 'default' : 'destructive'}>
                {executionResult.success ? 'Success' : 'Failed'}
              </Badge>
            </div>
            {executionResult.error && (
              <p className="text-sm text-destructive">{executionResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Right Sidebar - Node Config */}
      {selectedNode && (
        <div className="w-80 border-l border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Node Settings</h3>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => deleteNode(selectedNode.id)}
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={String(selectedNode.data.label || '')}
                onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })}
              />
            </div>

            {selectedNode.type === 'action' && (
              <div>
                <Label>Action</Label>
                <Select
                  value={String(selectedNode.data.actionId || '')}
                  onValueChange={(v) => updateNode(selectedNode.id, { actionId: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {actions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedNode.type === 'trigger' && (
              <div>
                <Label>Trigger Type</Label>
                <Select
                  value={String(selectedNode.data.triggerType || '')}
                  onValueChange={(v) => updateNode(selectedNode.id, { triggerType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="schedule">Schedule (Cron)</SelectItem>
                    <SelectItem value="file_watch">File Watch</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedNode.type === 'delay' && (
              <div>
                <Label>Delay (ms)</Label>
                <Input
                  type="number"
                  value={Number(selectedNode.data.delayMs || 0)}
                  onChange={(e) => updateNode(selectedNode.id, { delayMs: parseInt(e.target.value) || 0 })}
                />
              </div>
            )}

            <Button 
              className="w-full"
              onClick={() => setSelectedNode(null)}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
