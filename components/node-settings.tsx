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
  Clock
} from 'lucide-react'
import { FileSelector } from './file-selector'

const nodeTypeConfig = {
  model: { icon: Bot, color: 'text-emerald-400', label: 'Model Node' },
  prompt: { icon: MessageSquare, color: 'text-blue-400', label: 'Prompt Node' },
  validator: { icon: Shield, color: 'text-orange-400', label: 'Validator Node' },
  aggregator: { icon: Combine, color: 'text-purple-400', label: 'Aggregator Node' },
  search: { icon: Globe, color: 'text-cyan-400', label: 'Search Node' },
  file: { icon: FileText, color: 'text-amber-400', label: 'File Node' },
  router: { icon: Split, color: 'text-indigo-400', label: 'Router Node' },
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
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-5 h-5', config.color)} />
          <span className="font-medium text-foreground">{config.label}</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8"
          onClick={() => setSelectedNodeId(null)}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 w-full custom-scrollbar">
        <div className="p-4 space-y-6 w-full min-w-0">
          {/* Basic Settings */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Settings2 className="w-4 h-4" />
              Basic Settings
            </div>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="label">Node Name</Label>
                <Input
                  id="label"
                  value={node.data.label}
                  onChange={(e) => handleUpdateLabel(e.target.value)}
                  placeholder="Enter node name"
                />
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
                    <Select
                      value={node.data.model?.provider || 'openai'}
                      onValueChange={(v) => handleUpdateModel('provider', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providerList.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Model</Label>
                    <Select
                      value={node.data.model?.id && !node.data.model.id.startsWith('model-') ? node.data.model.id : ''}
                      onValueChange={(v) => {
                        const selectedModel = providerList
                          .find(p => p.id === (node.data.model?.provider || 'openai'))
                          ?.models.find((m: any) => m.id === v);
                        
                        const model = node.data.model || {
                          id: v,
                          name: selectedModel ? selectedModel.name : v,
                          provider: 'openai' as const,
                          description: '',
                          enabled: true,
                          level: 1,
                          temperature: 0.7,
                          maxTokens: 4096,
                        };
                        updateNode(node.id, { 
                          data: { 
                            ...node.data, 
                            model: { ...model, id: v, name: selectedModel ? selectedModel.name : v } 
                          } 
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {providerList
                          .find(p => p.id === (node.data.model?.provider || 'openai'))
                          ?.models.map((m: any) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Pipeline Level</Label>
                    <Select
                      value={String(node.data.model?.level || 1)}
                      onValueChange={(v) => handleUpdateModel('level', parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Level 1 - Primary</SelectItem>
                        <SelectItem value="2">Level 2 - Verification</SelectItem>
                        <SelectItem value="3">Level 3 - Final Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="enabled">Enabled</Label>
                    <Switch
                      id="enabled"
                      checked={node.data.model?.enabled ?? true}
                      onCheckedChange={(v) => handleUpdateModel('enabled', v)}
                    />
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <Label htmlFor="webSearch" className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-400" />
                      Web Search
                    </Label>
                    <Switch
                      id="webSearch"
                      checked={node.data.model?.webSearch ?? false}
                      onCheckedChange={(v) => handleUpdateModel('webSearch', v)}
                    />
                  </div>

                  {/* Context Compression */}
                  <div className="flex flex-col p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20 shadow-inner w-full min-w-0 mt-4">
                    <div className="flex items-center justify-between mb-2 gap-2 w-full min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Minimize2 className="w-4 h-4 text-cyan-500 shrink-0" />
                        <Label className="text-sm font-semibold text-cyan-500 truncate min-w-0 overflow-hidden">Context Compression</Label>
                      </div>
                      <Switch 
                        checked={node.data.contextCompression?.enabled ?? false} 
                        onCheckedChange={(checked) => updateNode(node.id, { 
                          data: { 
                            ...node.data, 
                            contextCompression: { 
                              ...node.data.contextCompression,
                              enabled: checked,
                              thresholdTokens: node.data.contextCompression?.thresholdTokens ?? 1000,
                              targetRatio: node.data.contextCompression?.targetRatio ?? 0.5,
                              modelId: node.data.contextCompression?.modelId ?? 'google/gemma-2-2b-it:free'
                            } 
                          } 
                        })}
                        className="data-[state=checked]:bg-cyan-500 shrink-0"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-normal w-full overflow-hidden break-words mb-3">
                      Auto-compress long contexts before sending to expensive models. Uses cheap AI to summarize large inputs (saves up to 75% tokens).
                    </p>
                    
                    {node.data.contextCompression?.enabled && (
                      <div className="space-y-3 pt-2 border-t border-cyan-500/20">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-cyan-600">Compress if &gt; tokens</Label>
                            <span className="text-xs text-muted-foreground">{node.data.contextCompression?.thresholdTokens ?? 1000}</span>
                          </div>
                          <Slider
                            value={[node.data.contextCompression?.thresholdTokens ?? 1000]}
                            min={500}
                            max={5000}
                            step={100}
                            onValueChange={([v]) => updateNode(node.id, { 
                              data: { 
                                ...node.data, 
                                contextCompression: { 
                                  ...node.data.contextCompression, 
                                  enabled: node.data.contextCompression?.enabled ?? true,
                                  thresholdTokens: v 
                                } 
                              } 
                            })}
                            className="w-full"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-cyan-600">Target compression</Label>
                            <span className="text-xs text-muted-foreground">{Math.round((node.data.contextCompression?.targetRatio ?? 0.5) * 100)}%</span>
                          </div>
                          <Slider
                            value={[node.data.contextCompression?.targetRatio ?? 0.5]}
                            min={0.3}
                            max={0.8}
                            step={0.1}
                            onValueChange={([v]) => updateNode(node.id, { 
                              data: { 
                                ...node.data, 
                                contextCompression: { 
                                  ...node.data.contextCompression, 
                                  enabled: node.data.contextCompression?.enabled ?? true,
                                  targetRatio: v 
                                } 
                              } 
                            })}
                            className="w-full"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-cyan-600">Compression Model (cheap)</Label>
                          <Select
                            value={node.data.contextCompression?.modelId || 'google/gemma-2-2b-it:free'}
                            onValueChange={(v) => updateNode(node.id, { 
                              data: { 
                                ...node.data, 
                                contextCompression: { 
                                  ...node.data.contextCompression, 
                                  enabled: node.data.contextCompression?.enabled ?? true,
                                  modelId: v 
                                } 
                              } 
                            })}
                          >
                            <SelectTrigger className="text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="google/gemma-2-2b-it:free">Gemma 2B (Free)</SelectItem>
                              <SelectItem value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</SelectItem>
                              <SelectItem value="qwen/qwen-2.5-7b-instruct:free">Qwen 2.5 7B (Free)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Smart Fallback Chain */}
                  <div className="flex flex-col p-4 rounded-xl bg-red-500/5 border border-red-500/20 shadow-inner w-full min-w-0 mt-4">
                    <div className="flex items-center justify-between mb-2 gap-2 w-full min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                        <Label className="text-sm font-semibold text-red-500 truncate min-w-0 overflow-hidden">Smart Fallback Chain</Label>
                      </div>
                      <Switch 
                        checked={(node.data.model?.fallbackModels?.length ?? 0) > 0} 
                        onCheckedChange={(checked) => {
                          if (checked) {
                            handleUpdateModel('fallbackModels', ['meta-llama/llama-3.3-70b-instruct:free'])
                            handleUpdateModel('fallbackMode', 'timeout')
                            handleUpdateModel('fallbackTimeoutMs', 5000)
                          } else {
                            handleUpdateModel('fallbackModels', undefined)
                            handleUpdateModel('fallbackMode', undefined)
                            handleUpdateModel('fallbackTimeoutMs', undefined)
                          }
                        }}
                        className="data-[state=checked]:bg-red-500 shrink-0"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-normal w-full overflow-hidden break-words mb-3">
                      Auto-switch to backup models if primary doesn't respond within timeout. Perfect for critical pipelines.
                    </p>
                    
                    {(node.data.model?.fallbackModels?.length ?? 0) > 0 && (
                      <div className="space-y-3 pt-2 border-t border-red-500/20">
                        {/* Fallback Mode Selection */}
                        <div className="space-y-2">
                          <Label className="text-xs text-red-600">Trigger Mode</Label>
                          <Select
                            value={node.data.model?.fallbackMode || 'timeout'}
                            onValueChange={(v: 'timeout' | 'on_error') => {
                              handleUpdateModel('fallbackMode', v)
                            }}
                          >
                            <SelectTrigger className="text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="timeout">
                                ⏱️ Timeout (switch if slow)
                              </SelectItem>
                              <SelectItem value="on_error">
                                ⚠️ On Error (switch only if fails)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">
                            {node.data.model?.fallbackMode === 'on_error' 
                              ? "Model can take its time. Fallback only activates if the model actually errors out."
                              : "Fallback activates if model doesn't respond within the timeout. Good for fast responses."}
                          </p>
                        </div>

                        {/* Timeout slider - only show in timeout mode */}
                        {node.data.model?.fallbackMode !== 'on_error' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-red-600 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Timeout before fallback (ms)
                              </Label>
                              <span className="text-xs text-muted-foreground">{node.data.model?.fallbackTimeoutMs ?? 5000}ms</span>
                            </div>
                            <Slider
                              value={[node.data.model?.fallbackTimeoutMs ?? 5000]}
                              min={1000}
                              max={60000}
                              step={1000}
                              onValueChange={([v]) => handleUpdateModel('fallbackTimeoutMs', v)}
                              className="w-full"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Allow {Math.round((node.data.model?.fallbackTimeoutMs ?? 5000) / 1000)} seconds for complex questions before switching
                            </p>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label className="text-xs text-red-600">Fallback Models (in order)</Label>
                          <div className="space-y-1.5">
                            {node.data.model?.fallbackModels?.map((modelId, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground w-4">{index + 1}.</span>
                                <Select
                                  value={modelId}
                                  onValueChange={(v) => {
                                    const newModels = [...(node.data.model?.fallbackModels || [])]
                                    newModels[index] = v
                                    handleUpdateModel('fallbackModels', newModels)
                                  }}
                                >
                                  <SelectTrigger className="text-xs flex-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {providerList.flatMap(p => p.models).map((m: any) => (
                                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => {
                                    const newModels = node.data.model?.fallbackModels?.filter((_, i) => i !== index) || []
                                    handleUpdateModel('fallbackModels', newModels.length > 0 ? newModels : undefined)
                                  }}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs mt-2"
                            onClick={() => {
                              const current = node.data.model?.fallbackModels || []
                              handleUpdateModel('fallbackModels', [...current, 'meta-llama/llama-3.3-70b-instruct:free'])
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add Fallback Model
                          </Button>
                        </div>

                        <div className="p-2 rounded bg-red-500/10 text-[10px] text-red-600">
                          Chain: Primary → {node.data.model?.fallbackModels?.map((_, i) => `Fallback ${i + 1}`).join(' → ')}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="params" className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Temperature</Label>
                      <span className="text-xs text-muted-foreground">
                        {node.data.model?.temperature ?? 0.7}
                      </span>
                    </div>
                    <Slider
                      value={[node.data.model?.temperature ?? 0.7]}
                      min={0}
                      max={2}
                      step={0.1}
                      onValueChange={([v]) => handleUpdateModel('temperature', v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxTokens">Max Tokens</Label>
                    <Input
                      id="maxTokens"
                      type="number"
                      min={1}
                      value={node.data.model?.maxTokens ?? 4096}
                      onChange={(e) => handleUpdateModel('maxTokens', parseInt(e.target.value) || 0)}
                      placeholder="e.g., 8192, 128000"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>System Prompt</Label>
                    <Textarea
                      value={node.data.model?.systemPrompt || ''}
                      onChange={(e) => handleUpdateModel('systemPrompt', e.target.value)}
                      placeholder="Enter system prompt..."
                      className="min-h-[100px] resize-none"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {node.type === 'prompt' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Code className="w-4 h-4" />
                Prompt Template
              </div>

              <Textarea
                value={node.data.prompt || ''}
                onChange={(e) => handleUpdatePrompt(e.target.value)}
                placeholder="Enter prompt template. Use {{input}} for variables..."
                className="min-h-[200px] resize-none font-mono text-sm"
              />

              <div className="p-3 rounded-lg bg-secondary">
                <p className="text-xs text-muted-foreground">
                  Available variables: {'{{input}}'}, {'{{context}}'}, {'{{history}}'}
                </p>
              </div>
            </div>
          )}

          {node.type === 'validator' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Shield className="w-4 h-4" />
                Validation Settings
              </div>

              <div className="space-y-2">
                <Label>Validation Type</Label>
                <Select
                  value={node.data.validationType || 'consensus'}
                  onValueChange={handleUpdateValidationType}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consensus">Consensus Voting</SelectItem>
                    <SelectItem value="scoring">Quality Scoring</SelectItem>
                    <SelectItem value="custom">Custom Logic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-3 rounded-lg bg-secondary space-y-2">
                <p className="text-xs font-medium text-foreground">How it works:</p>
                <p className="text-xs text-muted-foreground">
                  {node.data.validationType === 'consensus' && 
                    'Compares outputs from multiple models and selects the most agreed-upon response.'}
                  {node.data.validationType === 'scoring' && 
                    'Assigns quality scores to each response and selects the highest-rated output.'}
                  {node.data.validationType === 'custom' && 
                    'Uses custom validation logic defined in the prompt template.'}
                </p>
              </div>

              {node.data.validationType === 'custom' && (
                <div className="space-y-2 mt-4">
                  <Label>Custom Validation Prompt</Label>
                  <Textarea
                    value={node.data.prompt || ''}
                    onChange={(e) => handleUpdatePrompt(e.target.value)}
                    placeholder="Enter custom validation instructions..."
                    className="min-h-[100px] resize-none text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    This prompt will be sent as the system prompt to the validation model.
                  </p>
                </div>
              )}
            </div>
          )}

          {node.type === 'search' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Globe className="w-4 h-4" />
                Search Configuration
              </div>

              <div className="space-y-2">
                <Label htmlFor="searchQuery">Search Query Template</Label>
                <Textarea
                  id="searchQuery"
                  value={node.data.searchQuery || ''}
                  onChange={(e) => handleUpdateSearch('searchQuery', e.target.value)}
                  placeholder="e.g., Latest news about {{input}}..."
                  className="min-h-[100px] resize-none text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  Use {'{{input}}'} to insert content from parent nodes.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxResults">Max Results</Label>
                <Input
                  id="maxResults"
                  type="number"
                  min={1}
                  max={20}
                  value={node.data.maxResults || 5}
                  onChange={(e) => handleUpdateSearch('maxResults', parseInt(e.target.value) || 1)}
                />
              </div>

              <div className="p-3 rounded-lg bg-secondary space-y-2">
                <p className="text-xs font-medium text-foreground">Note:</p>
                <p className="text-xs text-muted-foreground">
                  This node performs a real-time web search and returns snippets to downstream nodes.
                </p>
              </div>
            </div>
          )}

          {node.type === 'router' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Split className="w-4 h-4 text-indigo-400" />
                Router Configuration
              </div>

              <div className="space-y-2">
                <Label>Classification Prompt</Label>
                <Textarea
                  value={node.data.routingPrompt || ''}
                  onChange={(e) => updateNode(node.id, { data: { ...node.data, routingPrompt: e.target.value } })}
                  placeholder="e.g. Classify this input exactly as CODE or TEXT. Output only the word."
                  className="min-h-[100px] resize-none text-sm"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  The model uses this prompt to analyze input. Its response determines which path to activate.
                </p>
              </div>

              <div className="space-y-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
                <Label className="text-xs font-semibold text-indigo-400">Path Mapping</Label>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  Assign a matching word to each connected output. If the model's output matches, that path executes. Unmatched paths are skipped.
                </p>
                
                {outputEdges.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic p-2 rounded bg-background/50 border border-border/50 text-center">
                    Connect this router to other nodes to create paths.
                  </div>
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
                            <span className="font-medium truncate">{targetNode.data.label} (ID: {targetNode.id.slice(-6)})</span>
                          </div>
                          <Input 
                            placeholder="e.g. CODE"
                            className="h-7 text-xs bg-muted/50 focus:bg-background"
                            value={currentCondition}
                            onChange={(e) => {
                              const updatedMap = { ...(node.data.routingMap || {}) }
                              updatedMap[targetNode.id] = e.target.value.trim().toUpperCase()
                              updateNode(node.id, { data: { ...node.data, routingMap: updatedMap } })
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {node.type === 'file' && (
            <div className="space-y-4 w-full min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                <span>File Selection</span>
              </div>

              <div className="space-y-3 p-4 rounded-xl bg-secondary/30 border border-border/50 w-full min-w-0">
                <div className="flex flex-col gap-2 min-w-0">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground w-full truncate">Chosen Workspace Path</Label>
                  <div className="flex items-center gap-2 w-full min-w-0">
                    <code className="flex-1 min-w-0 p-2 rounded bg-background border border-border/50 text-xs font-mono truncate overflow-hidden">
                      {node.data.filePath || 'None selected'}
                    </code>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary py-1 h-8 shrink-0"
                      onClick={() => setSelectorOpen(true)}
                    >
                      Browse
                    </Button>
                  </div>
                </div>

                {node.data.result && (
                  <div className="space-y-2 mt-4 w-full min-w-0">
                    <div className="flex items-center justify-between w-full min-w-0">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Last Read Content</Label>
                      <span className="text-[10px] text-muted-foreground shrink-0 pl-2">{node.data.result.length} chars</span>
                    </div>
                    <ScrollArea className="h-40 w-full rounded border border-border/30 bg-background/50 p-2 overflow-hidden">
                      <pre className="text-[10px] font-mono leading-tight whitespace-pre-wrap opacity-70 break-all break-words max-w-full">
                        {node.data.result.slice(0, 1000)}
                        {node.data.result.length > 1000 && '...'}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </div>

              <div className="flex flex-col p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 shadow-inner w-full min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2 w-full min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                    <Label className="text-sm font-semibold text-amber-500 truncate min-w-0 overflow-hidden">Global Knowledge</Label>
                  </div>
                  <Switch 
                    checked={node.data.isGlobal} 
                    onCheckedChange={(checked) => updateNode(node.id, { data: { ...node.data, isGlobal: checked } })}
                    className="data-[state=checked]:bg-amber-500 shrink-0"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground leading-normal w-full overflow-hidden break-words">
                  Make this file available to **all models** in the pipeline without connection lines.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-primary/5 space-y-2 border border-primary/10">
                <div className="flex items-center gap-2 text-[10px] font-medium text-primary uppercase">
                  <Radio className="w-3.5 h-3.5" />
                  Behavior:
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {node.data.isGlobal 
                    ? "This file is now broadcasting to all nodes in the pipeline automatically."
                    : "This node only passes the file content to nodes that are directly connected to it."}
                </p>
              </div>

              {/* Smart File Reader Mode */}
              <div className="flex flex-col p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 shadow-inner w-full min-w-0 mt-4">
                <div className="flex items-center justify-between mb-2 gap-2 w-full min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Code className="w-4 h-4 text-emerald-500 shrink-0" />
                    <Label className="text-sm font-semibold text-emerald-500 truncate min-w-0 overflow-hidden">Smart Read (IDE Mode)</Label>
                  </div>
                  <Switch 
                    checked={node.data.isSmartRead} 
                    onCheckedChange={(checked) => updateNode(node.id, { data: { ...node.data, isSmartRead: checked } })}
                    className="data-[state=checked]:bg-emerald-500 shrink-0"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground leading-normal w-full overflow-hidden break-words mb-3">
                  AI reads only relevant sections like in IDE. Instead of loading entire file, it analyzes your query and reads specific line ranges.
                </p>
                
                {node.data.isSmartRead && (
                  <div className="space-y-3 pt-2 border-t border-emerald-500/20">
                    <div className="space-y-2">
                      <Label className="text-xs text-emerald-600">What to find? (Query Template)</Label>
                      <Textarea
                        value={node.data.smartQuery || ''}
                        onChange={(e) => updateNode(node.id, { data: { ...node.data, smartQuery: e.target.value } })}
                        placeholder="e.g., Find functions related to {{input}}, or 'read error handling code'..."
                        className="min-h-[80px] resize-none text-xs bg-background border-emerald-500/30"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Use {'{{input}}'} for context from previous nodes. AI will plan which lines to read.
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-emerald-600">Max Lines to Read</Label>
                        <span className="text-xs text-muted-foreground">{node.data.maxLines || 500}</span>
                      </div>
                      <Slider
                        value={[node.data.maxLines || 500]}
                        min={50}
                        max={2000}
                        step={50}
                        onValueChange={([v]) => updateNode(node.id, { data: { ...node.data, maxLines: v } })}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>

              <FileSelector 
                open={isSelectorOpen} 
                onOpenChange={setSelectorOpen} 
                onSelect={(path) => updateNode(node.id, { data: { ...node.data, filePath: path } })}
              />
            </div>
          )}

          <Separator />

          {/* Connections */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Layers className="w-4 h-4" />
              Connections
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Inputs ({inputEdges.length})</Label>
                {inputEdges.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {inputEdges.map((edge) => {
                      const sourceNode = nodes.find(n => n.id === edge.source)
                      return (
                        <div key={edge.id} className="flex items-center justify-between p-2 rounded bg-secondary">
                          <span className="text-xs">{sourceNode?.data.label || edge.source}</span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6"
                            onClick={() => removeEdge(edge.id)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">No inputs connected</p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Outputs ({outputEdges.length})</Label>
                {outputEdges.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {outputEdges.map((edge) => {
                      const targetNode = nodes.find(n => n.id === edge.target)
                      return (
                        <div key={edge.id} className="flex items-center justify-between p-2 rounded bg-secondary">
                          <span className="text-xs">{targetNode?.data.label || edge.target}</span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6"
                            onClick={() => removeEdge(edge.id)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">No outputs connected</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <Button 
          variant="destructive" 
          className="w-full" 
          onClick={handleDelete}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Node
        </Button>
      </div>
    </div>
  )
}
