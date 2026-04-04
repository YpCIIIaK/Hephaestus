'use client'

import { useState, useEffect } from 'react'
import { useArenaStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { 
  X, 
  Trash2, 
  Bot, 
  MessageSquare, 
  Shield, 
  Combine,
  Zap,
  Globe,
  Settings2,
  Code,
  Layers,
  FileText,
  FolderOpen,
  Radio,
  Share2,
  Split,
  Minimize2,
  ShieldAlert,
  Plus,
  Clock,
  Target,
  BarChart3,
  Microscope,
  Puzzle,
  FileSpreadsheet
} from 'lucide-react'
import { FileSelector } from './file-selector'
import { getAllAgentPresets, getOllamaPresets, roleCategories, domainLabels, presetToArenaNodeData } from '@/lib/agent-config'

const nodeTypeConfig: Record<string, { icon: any, color: string, label: string }> = {
  model: { icon: Bot, color: 'text-emerald-400', label: 'Model Node' },
  prompt: { icon: MessageSquare, color: 'text-blue-400', label: 'Prompt Node' },
  validator: { icon: Shield, color: 'text-orange-400', label: 'Validator Node' },
  aggregator: { icon: Combine, color: 'text-purple-400', label: 'Aggregator Node' },
  search: { icon: Globe, color: 'text-cyan-400', label: 'Search Node' },
  file: { icon: FileText, color: 'text-amber-400', label: 'File Node' },
  router: { icon: Split, color: 'text-indigo-400', label: 'Router Node' },
  code: { icon: Code, color: 'text-stone-400', label: 'Code Node' },
  classifier: { icon: Target, color: 'text-green-400', label: 'Classifier Agent' },
  analyst: { icon: BarChart3, color: 'text-yellow-400', label: 'Analyst Agent' },
  researcher: { icon: Microscope, color: 'text-violet-400', label: 'Researcher Agent' },
  synthesizer: { icon: Puzzle, color: 'text-red-400', label: 'Synthesizer Agent' },
  summarizer: { icon: FileSpreadsheet, color: 'text-lime-400', label: 'Summarizer Agent' },
}

const defaultProviders = [
  { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
  { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-3-opus', name: 'Claude 3 Opus' }] },
]

export function NodeSettings() {
  const { nodes, edges, selectedNodeId, setSelectedNodeId, updateNode, removeNode, removeEdge } = useArenaStore()
  const [providerList, setProviderList] = useState<any[]>(defaultProviders)
  const [isSelectorOpen, setSelectorOpen] = useState(false)

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && Array.isArray(data.models)) {
          const grouped = data.models.reduce((acc: any, model: any) => {
            if (!acc[model.provider]) {
              acc[model.provider] = {
                id: model.provider,
                name: model.provider.charAt(0).toUpperCase() + model.provider.slice(1),
                models: []
              }
            }
            acc[model.provider].models.push({ id: model.id, name: model.name })
            return acc
          }, {})
          setProviderList(Object.values(grouped))
        }
      })
      .catch(err => console.error("Failed to load models:", err))
  }, [])
  
  const node = nodes.find(n => n.id === selectedNodeId)
  if (!node) return null

  const config = nodeTypeConfig[node.type]
  const Icon = config.icon

  const connectedEdges = edges.filter(e => e.source === node.id || e.target === node.id)
  const inputEdges = edges.filter(e => e.target === node.id)
  const outputEdges = edges.filter(e => e.source === node.id)

  const handleUpdateLabel = (label: string) => {
    updateNode(node.id, { data: { ...node.data, label } })
  }

  const handleUpdateModel = (field: string, value: unknown) => {
    const model = node.data.model || {
      id: `model-${Date.now()}`,
      name: 'New Model',
      provider: 'openai' as const,
      description: '',
      enabled: true,
      level: 1,
      temperature: 0.7,
      maxTokens: 4096,
    }
    updateNode(node.id, { 
      data: { 
        ...node.data, 
        model: { ...model, [field]: value } 
      } 
    })
  }

  const handleUpdatePrompt = (prompt: string) => {
    updateNode(node.id, { data: { ...node.data, prompt } })
  }

  const handleUpdateValidationType = (validationType: 'consensus' | 'scoring' | 'custom') => {
    updateNode(node.id, { data: { ...node.data, validationType } })
  }

  const handleUpdateSearch = (field: string, value: any) => {
    updateNode(node.id, { data: { ...node.data, [field]: value } })
  }

  const handleDelete = () => {
    removeNode(node.id)
    setSelectedNodeId(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-5 h-5', config.color)} />
          <span className="font-medium text-foreground">{config.label}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedNodeId(null)}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 w-full custom-scrollbar">
        <div className="p-4 space-y-6 w-full min-w-0">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Settings2 className="w-4 h-4" />
              Basic Settings
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="label">Node Name</Label>
                <Input id="label" value={node.data.label} onChange={(e) => handleUpdateLabel(e.target.value)} placeholder="Enter node name" />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>ID: {node.id}</span>
                <Badge variant="outline" className="text-xs">{node.type}</Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Type-specific settings */}
          {['model', 'validator', 'aggregator', 'router'].includes(node.type) && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Bot className="w-4 h-4" />
                Model Configuration
              </div>
              <Tabs defaultValue="model" className="w-full">
                <TabsList className="w-full bg-secondary">
                  <TabsTrigger value="model" className="flex-1">Model</TabsTrigger>
                  <TabsTrigger value="params" className="flex-1">Parameters</TabsTrigger>
                </TabsList>
                <TabsContent value="model" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select value={node.data.model?.provider || 'openai'} onValueChange={(v) => handleUpdateModel('provider', v)}>
                      <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                      <SelectContent>
                        {providerList.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <Select
                      value={node.data.model?.id && !node.data.model.id.startsWith('model-') ? node.data.model.id : ''}
                      onValueChange={(v) => {
                        const selectedModel = providerList.find(p => p.id === (node.data.model?.provider || 'openai'))?.models.find((m: any) => m.id === v);
                        const model = node.data.model || { id: v, name: selectedModel ? selectedModel.name : v, provider: 'openai' as const, description: '', enabled: true, level: 1, temperature: 0.7, maxTokens: 4096 };
                        updateNode(node.id, { data: { ...node.data, model: { ...model, id: v, name: selectedModel ? selectedModel.name : v } } });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                      <SelectContent>
                        {providerList.find(p => p.id === (node.data.model?.provider || 'openai'))?.models.map((m: any) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="enabled">Enabled</Label>
                    <Switch id="enabled" checked={node.data.model?.enabled ?? true} onCheckedChange={(v) => handleUpdateModel('enabled', v)} />
                  </div>
                </TabsContent>
                <TabsContent value="params" className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Temperature</Label>
                      <span className="text-xs text-muted-foreground">{node.data.model?.temperature ?? 0.7}</span>
                    </div>
                    <Slider value={[node.data.model?.temperature ?? 0.7]} min={0} max={2} step={0.1} onValueChange={([v]) => handleUpdateModel('temperature', v)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxTokens">Max Tokens</Label>
                    <Input id="maxTokens" type="number" min={1} value={node.data.model?.maxTokens ?? 4096} onChange={(e) => handleUpdateModel('maxTokens', parseInt(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-2">
                    <Label>System Prompt</Label>
                    <Textarea value={node.data.model?.systemPrompt || ''} onChange={(e) => handleUpdateModel('systemPrompt', e.target.value)} placeholder="Enter system prompt..." className="min-h-[100px] resize-none" />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {node.type === 'prompt' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Code className="w-4 h-4" />Prompt Template</div>
              <Textarea value={node.data.prompt || ''} onChange={(e) => handleUpdatePrompt(e.target.value)} placeholder="Enter prompt template. Use {'{{input}}'} for variables..." className="min-h-[200px] resize-none font-mono text-sm" />
            </div>
          )}

          {node.type === 'validator' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Shield className="w-4 h-4" />Validation Settings</div>
              <div className="space-y-2">
                <Label>Validation Type</Label>
                <Select value={node.data.validationType || 'consensus'} onValueChange={(v: any) => updateNode(node.id, { data: { ...node.data, validationType: v } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consensus">Consensus Voting</SelectItem>
                    <SelectItem value="scoring">Quality Scoring</SelectItem>
                    <SelectItem value="custom">Custom Logic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {node.type === 'search' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Globe className="w-4 h-4 text-cyan-400" />Multi-Source Search Configuration</div>
              
              {/* Search Query Template */}
              <div className="space-y-2">
                <Label htmlFor="searchQuery">Search Query Template</Label>
                <Textarea id="searchQuery" value={node.data.searchQuery || ''} onChange={(e) => handleUpdateSearch('searchQuery', e.target.value)} placeholder="e.g., Latest news about {{input}}..." className="min-h-[80px] resize-none text-sm" />
              </div>
              
              {/* Search Sources */}
              <div className="space-y-2">
                <Label>Search Sources</Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'duckduckgo', name: 'DuckDuckGo', free: true },
                    { id: 'searxng', name: 'SearXNG', free: true },
                    { id: 'google', name: 'Google CSE', free: false },
                    { id: 'bing', name: 'Bing', free: false },
                  ].map(source => {
                    const sources = node.data.searchSources || ['duckduckgo', 'searxng']
                    const isSelected = sources.includes(source.id as any)
                    return (
                      <button
                        key={source.id}
                        onClick={() => {
                          const current = node.data.searchSources || ['duckduckgo', 'searxng']
                          const updated = isSelected ? current.filter(s => s !== source.id) : [...current, source.id]
                          updateNode(node.id, { data: { ...node.data, searchSources: updated as ('duckduckgo' | 'searxng' | 'google' | 'bing' | 'rss')[] } })
                        }}
                        className={`flex items-center gap-2 p-2 rounded-lg border transition-colors text-xs ${
                          isSelected ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-background border-border/50 text-muted-foreground hover:border-border'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded border ${isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-border'}`} />
                        <span>{source.name}</span>
                        {source.free && <span className="text-[9px] text-green-500 ml-auto">Free</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
              
              {/* Web Scraping Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={node.data.scrapeContent ?? false} onChange={(e) => handleUpdateSearch('scrapeContent', e.target.checked)} id="scrapeContent" className="accent-cyan-500" />
                  <Label htmlFor="scrapeContent" className="text-xs">Scrape Full Page Content</Label>
                </div>
                <span className="text-[10px] text-muted-foreground">Fetches page content, not just snippets</span>
              </div>
              
              {/* Language */}
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={node.data.searchLanguage || 'en'} onValueChange={(v) => handleUpdateSearch('searchLanguage', v)}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ru">Russian</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* RSS Feeds */}
              <div className="space-y-2">
                <Label>RSS/News Feeds (one per line)</Label>
                <Textarea 
                  value={(node.data.rssFeeds || []).join('\n')} 
                  onChange={(e) => handleUpdateSearch('rssFeeds', e.target.value.split('\n').filter(Boolean))} 
                  placeholder="https://feeds.reuters.com/reuters/topNews&#10;https://rss.nytimes.com/services/xml/rss/nyt/World.xml" 
                  className="min-h-[60px] resize-none text-xs font-mono" 
                />
              </div>
              
              {/* Max Results */}
              <div className="space-y-2">
                <Label htmlFor="maxResults">Max Results</Label>
                <Input id="maxResults" type="number" min={1} max={50} value={node.data.maxResults || 10} onChange={(e) => handleUpdateSearch('maxResults', parseInt(e.target.value) || 10)} />
              </div>
            </div>
          )}

          {node.type === 'router' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Split className="w-4 h-4 text-indigo-400" />Router Configuration</div>
              <div className="space-y-2">
                <Label>Classification Prompt</Label>
                <Textarea value={node.data.routingPrompt || ''} onChange={(e) => updateNode(node.id, { data: { ...node.data, routingPrompt: e.target.value } })} placeholder="e.g. Classify this input exactly as CODE or TEXT. Output only the word." className="min-h-[100px] resize-none text-sm" />
              </div>
              <div className="space-y-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
                <Label className="text-xs font-semibold text-indigo-400">Path Mapping</Label>
                {outputEdges.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic p-2 rounded bg-background/50 border border-border/50 text-center">Connect this router to other nodes to create paths.</div>
                ) : (
                  <div className="space-y-2">
                    {outputEdges.map(edge => {
                      const targetNode = nodes.find(n => n.id === edge.target)
                      if (!targetNode) return null
                      const currentCondition = node.data.routingMap?.[targetNode.id] || ''
                      return (
                        <div key={targetNode.id} className="flex flex-col gap-1.5 p-2 rounded-lg bg-background border border-border/50">
                          <div className="flex items-center gap-2 text-xs truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                            <span className="font-medium truncate">{targetNode.data.label}</span>
                          </div>
                          <Input placeholder="e.g. CODE" className="h-7 text-xs bg-muted/50 focus:bg-background" value={currentCondition} onChange={(e) => { const updatedMap = { ...(node.data.routingMap || {}) }; updatedMap[targetNode.id] = e.target.value.trim().toUpperCase(); updateNode(node.id, { data: { ...node.data, routingMap: updatedMap } }) }} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Specialized Agent Nodes */}
          {['classifier', 'analyst', 'researcher', 'synthesizer', 'summarizer'].includes(node.type) && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Bot className="w-4 h-4" />Agent Configuration</div>

              {/* Agent Preset Selector */}
              <div className="flex flex-col p-4 rounded-xl bg-violet-500/5 border border-violet-500/20 shadow-inner w-full min-w-0">
                <div className="flex items-center gap-2 mb-2 w-full min-w-0">
                  <Target className="w-4 h-4 text-violet-500 shrink-0" />
                  <Label className="text-sm font-semibold text-violet-500 truncate min-w-0 overflow-hidden">Agent Preset</Label>
                </div>
                <Select value={node.data.agentPresetId || ''} onValueChange={(v) => {
                  const presets = getAllAgentPresets()
                  const preset = presets.find(p => p.id === v)
                  if (preset) {
                    const nodeData = presetToArenaNodeData(preset)
                    updateNode(node.id, { data: { ...node.data, agentPresetId: v, agentRole: preset.role, agentDomain: preset.domain, label: nodeData.label, model: nodeData.model, contextCompression: nodeData.contextCompression } })
                  }
                }}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Select agent preset..." /></SelectTrigger>
                  <SelectContent>
                    {getAllAgentPresets().filter(p => p.role === node.type).map(preset => (
                      <SelectItem key={preset.id} value={preset.id}>{preset.name} - {preset.modelName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {node.data.agentPresetId && (
                  <div className="mt-2 p-2 rounded bg-violet-500/10 border border-violet-500/20">
                    <p className="text-[10px] text-violet-600 leading-relaxed">{getAllAgentPresets().find(p => p.id === node.data.agentPresetId)?.description}</p>
                  </div>
                )}
              </div>

              {/* Ollama Local Models */}
              <div className="flex flex-col p-4 rounded-xl bg-orange-500/5 border border-orange-500/20 shadow-inner w-full min-w-0">
                <div className="flex items-center gap-2 mb-2 w-full min-w-0">
                  <Bot className="w-4 h-4 text-orange-500 shrink-0" />
                  <Label className="text-sm font-semibold text-orange-500 truncate min-w-0 overflow-hidden">Local Models (Ollama)</Label>
                </div>
                <p className="text-[10px] text-muted-foreground mb-3">Free local models via Ollama. Works offline, private, on your GPU.</p>
                <Select value={node.data.agentPresetId?.startsWith('ollama') ? node.data.agentPresetId : ''} onValueChange={(v) => {
                  const presets = getOllamaPresets()
                  const preset = presets.find(p => p.id === v)
                  if (preset) {
                    const nodeData = presetToArenaNodeData(preset)
                    updateNode(node.id, { data: { ...node.data, agentPresetId: v, agentRole: preset.role, agentDomain: preset.domain, label: nodeData.label, model: nodeData.model, contextCompression: nodeData.contextCompression } })
                  }
                }}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Select local model..." /></SelectTrigger>
                  <SelectContent>
                    {getOllamaPresets().filter(p => p.role === node.type).map(preset => (
                      <SelectItem key={preset.id} value={preset.id}>{preset.modelName} - {preset.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="mt-2 p-2 rounded bg-orange-500/10 border border-orange-500/20 text-[10px] text-orange-600">
                  <p className="font-medium mb-1">Install Ollama:</p>
                  <code className="bg-background px-1 rounded text-[9px]">1. ollama.ai/install | sh{'\n'}2. ollama pull llama3.1:8b{'\n'}3. ollama pull phi4:latest</code>
                </div>
              </div>

              {/* Model Override */}
              <div className="space-y-2">
                <Label>Model Override (optional)</Label>
                <Select value={node.data.model?.id || ''} onValueChange={(v) => {
                  const selectedModel = providerList.find(p => p.id === (node.data.model?.provider || 'openai'))?.models.find((m: any) => m.id === v);
                  if (selectedModel) {
                    updateNode(node.id, { data: { ...node.data, model: { ...node.data.model, provider: node.data.model?.provider || 'openai', description: node.data.model?.description || '', id: v, name: selectedModel.name, enabled: node.data.model?.enabled ?? true, level: node.data.model?.level ?? 1 } } })
                  }
                }}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Override model..." /></SelectTrigger>
                  <SelectContent>
                    {providerList.flatMap(p => p.models).map((m: any) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              {/* Temperature */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Temperature</Label>
                  <span className="text-xs text-muted-foreground">{node.data.model?.temperature ?? 0.3}</span>
                </div>
                <Slider value={[node.data.model?.temperature ?? 0.3]} min={0} max={2} step={0.1} onValueChange={([v]) => handleUpdateModel('temperature', v)} />
              </div>

              {/* Max Tokens */}
              <div className="space-y-2">
                <Label htmlFor="maxTokens">Max Tokens</Label>
                <Input id="maxTokens" type="number" min={1} value={node.data.model?.maxTokens ?? 500} onChange={(e) => handleUpdateModel('maxTokens', parseInt(e.target.value) || 0)} placeholder="500, 1000, 2000" />
              </div>

              {/* System Prompt */}
              <div className="space-y-2">
                <Label>System Prompt</Label>
                <Textarea value={node.data.model?.systemPrompt || ''} onChange={(e) => handleUpdateModel('systemPrompt', e.target.value)} placeholder="Override system prompt..." className="min-h-[120px] resize-none text-xs font-mono" />
              </div>

              {/* Context Compression */}
              <div className="flex flex-col p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20 shadow-inner w-full min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2 w-full min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Minimize2 className="w-4 h-4 text-cyan-500 shrink-0" />
                    <Label className="text-sm font-semibold text-cyan-500 truncate min-w-0 overflow-hidden">Context Compression</Label>
                  </div>
                  <Switch checked={node.data.contextCompression?.enabled ?? false} onCheckedChange={(checked) => updateNode(node.id, { data: { ...node.data, contextCompression: { ...node.data.contextCompression, enabled: checked, thresholdTokens: node.data.contextCompression?.thresholdTokens ?? 1000, targetRatio: node.data.contextCompression?.targetRatio ?? 0.5 } } })} className="data-[state=checked]:bg-cyan-500 shrink-0" />
                </div>
                {node.data.contextCompression?.enabled && (
                  <div className="space-y-2 pt-2 border-t border-cyan-500/20">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-cyan-600">Threshold</Label>
                      <span className="text-xs text-muted-foreground">{node.data.contextCompression?.thresholdTokens ?? 1000}</span>
                    </div>
                    <Slider value={[node.data.contextCompression?.thresholdTokens ?? 1000]} min={500} max={5000} step={100} onValueChange={([v]) => updateNode(node.id, { data: { ...node.data, contextCompression: { ...node.data.contextCompression, enabled: true, thresholdTokens: v, targetRatio: node.data.contextCompression?.targetRatio ?? 0.5 } } })} />
                  </div>
                )}
              </div>

              {/* Info panel */}
              <div className="p-3 rounded-lg bg-primary/5 space-y-2 border border-primary/10">
                <div className="flex items-center gap-2 text-[10px] font-medium text-primary uppercase"><Zap className="w-3.5 h-3.5" />Token Efficiency Tips:</div>
                <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed">
                  <li>Classifiers: Use maxTokens 20-50, temperature 0.1</li>
                  <li>Analysts: Use compression for context over 1000 tokens</li>
                  <li>Researchers: Enable compression, maxTokens 2000+</li>
                  <li>Synthesizers: Use expensive models only for final report</li>
                  <li>Ollama: 100% free, local execution</li>
                </ul>
              </div>
            </div>
          )}

          {node.type === 'file' && (
            <div className="space-y-4 w-full min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground"><FolderOpen className="w-4 h-4 text-amber-400 shrink-0" /><span>File Selection</span></div>
              <div className="space-y-3 p-4 rounded-xl bg-secondary/30 border border-border/50 w-full min-w-0">
                <div className="flex flex-col gap-2 min-w-0">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground w-full truncate">Chosen Workspace Path</Label>
                  <div className="flex items-center gap-2 w-full min-w-0">
                    <code className="flex-1 min-w-0 p-2 rounded bg-background border border-border/50 text-xs font-mono truncate overflow-hidden">{node.data.filePath || 'None selected'}</code>
                    <Button variant="outline" size="sm" className="bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary py-1 h-8 shrink-0" onClick={() => setSelectorOpen(true)}>Browse</Button>
                  </div>
                </div>
              </div>
              <FileSelector open={isSelectorOpen} onOpenChange={setSelectorOpen} onSelect={(path) => updateNode(node.id, { data: { ...node.data, filePath: path } })} />
            </div>
          )}

          <Separator />

          {/* Connections */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Layers className="w-4 h-4" />Connections</div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Inputs ({inputEdges.length})</Label>
                {inputEdges.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {inputEdges.map((edge) => { const sourceNode = nodes.find(n => n.id === edge.source); return (<div key={edge.id} className="flex items-center justify-between p-2 rounded bg-secondary"><span className="text-xs">{sourceNode?.data.label || edge.source}</span><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeEdge(edge.id)}><X className="w-3 h-3" /></Button></div>); })}
                  </div>
                ) : (<p className="text-xs text-muted-foreground mt-2">No inputs connected</p>)}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Outputs ({outputEdges.length})</Label>
                {outputEdges.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {outputEdges.map((edge) => { const targetNode = nodes.find(n => n.id === edge.target); return (<div key={edge.id} className="flex items-center justify-between p-2 rounded bg-secondary"><span className="text-xs">{targetNode?.data.label || edge.target}</span><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeEdge(edge.id)}><X className="w-3 h-3" /></Button></div>); })}
                  </div>
                ) : (<p className="text-xs text-muted-foreground mt-2">No outputs connected</p>)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <Button variant="destructive" className="w-full" onClick={handleDelete}>
          <Trash2 className="w-4 h-4 mr-2" />Delete Node
        </Button>
      </div>
    </div>
  )
}