'use client'

import { useState } from 'react'
import { useArenaStore } from '@/lib/store'
import { Model } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { 
  Plus, 
  Search, 
  Settings2, 
  Trash2,
  Check,
  Zap,
  Layers,
  Globe
} from 'lucide-react'

const providerInfo: Record<string, { name: string; color: string; bg: string }> = {
  openai: { name: 'OpenAI', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  anthropic: { name: 'Anthropic', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  google: { name: 'Google', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  meta: { name: 'Meta', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  mistral: { name: 'Mistral', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  custom: { name: 'Custom', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
}

const fallbackModels = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Latest multimodal GPT model' },
  { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic', description: 'Most capable Claude' },
  { id: 'google/gemini-pro', name: 'Gemini Pro', provider: 'google', description: 'Advanced Google model' },
  { id: 'meta-llama/llama-3-70b', name: 'Llama 3 70B', provider: 'meta', description: 'Large open-source model' },
]

export function ModelLibrary() {
  const { models, addModel, updateModel, removeModel } = useArenaStore()
  const [availableModels, setAvailableModels] = useState<any[]>(fallbackModels)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProvider, setFilterProvider] = useState<string>('all')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newModel, setNewModel] = useState<Partial<Model>>({
    provider: 'openai',
    level: 1,
    temperature: 0.7,
    maxTokens: 4096,
    enabled: true,
    webSearch: false,
  })

  // Fetch real OpenRouter models on mount
  useState(() => {
    setIsLoadingModels(true)
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && Array.isArray(data.models)) {
          setAvailableModels(data.models)
        }
      })
      .catch(err => console.error("Failed to load models:", err))
      .finally(() => setIsLoadingModels(false))
  })

  const filteredModels = models.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
                         m.description.toLowerCase().includes(search.toLowerCase())
    const matchesProvider = filterProvider === 'all' || m.provider === filterProvider
    return matchesSearch && matchesProvider
  })

  const handleAddModel = () => {
    if (!newModel.name) return
    
    const model: Model = {
      id: `model-${Date.now()}`,
      name: newModel.name,
      provider: newModel.provider as Model['provider'],
      description: newModel.description || '',
      enabled: newModel.enabled ?? true,
      level: newModel.level ?? 1,
      temperature: newModel.temperature ?? 0.7,
      maxTokens: newModel.maxTokens ?? 4096,
      webSearch: newModel.webSearch ?? false,
    }
    
    addModel(model)
    setShowAddDialog(false)
    setNewModel({
      provider: 'openai',
      level: 1,
      temperature: 0.7,
      maxTokens: 4096,
      enabled: true,
      webSearch: false,
    })
  }

  const handleQuickAdd = (modelTemplate: typeof availableModels[0]) => {
    const model: Model = {
      id: `model-${Date.now()}`,
      name: modelTemplate.name,
      provider: modelTemplate.provider as Model['provider'],
      description: modelTemplate.description,
      enabled: true,
      level: 1,
      temperature: 0.7,
      maxTokens: 4096,
      webSearch: false,
    }
    addModel(model)
  }

  const modelsByLevel = {
    1: filteredModels.filter(m => m.level === 1),
    2: filteredModels.filter(m => m.level === 2),
    3: filteredModels.filter(m => m.level === 3),
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Model Library</h2>
            <p className="text-sm text-muted-foreground">
              Configure and manage your AI models
            </p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Add Model
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Model</DialogTitle>
                <DialogDescription>
                  Configure a new model for your pipeline
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select
                    value={newModel.provider}
                    onValueChange={(v) => setNewModel({ ...newModel, provider: v as Model['provider'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(providerInfo).map(([id, info]) => (
                        <SelectItem key={id} value={id}>
                          {info.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Model Name</Label>
                  <Input
                    value={newModel.name || ''}
                    onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                    placeholder="e.g., GPT-4 Turbo"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={newModel.description || ''}
                    onChange={(e) => setNewModel({ ...newModel, description: e.target.value })}
                    placeholder="Brief description"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pipeline Level</Label>
                  <Select
                    value={String(newModel.level)}
                    onValueChange={(v) => setNewModel({ ...newModel, level: parseInt(v) })}
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
                <div className="flex items-center justify-between py-2">
                  <Label className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-400" />
                    Web Search
                  </Label>
                  <Switch
                    checked={newModel.webSearch || false}
                    onCheckedChange={(v) => setNewModel({ ...newModel, webSearch: v })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddModel}>Add Model</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search and filter */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="pl-9"
            />
          </div>
          <Select value={filterProvider} onValueChange={setFilterProvider}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              {Object.entries(providerInfo).map(([id, info]) => (
                <SelectItem key={id} value={id}>
                  {info.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 space-y-8">
          {/* Quick Add Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Quick Add
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {availableModels
                .filter(m => !models.some(existing => existing.name === m.name))
                .slice(0, 16)
                .map((model) => {
                  const info = providerInfo[model.provider] || providerInfo['custom']
                  return (
                    <button
                      key={model.id}
                      onClick={() => handleQuickAdd(model)}
                      className={cn(
                        'p-3 rounded-lg border border-border text-left transition-all hover:border-primary/50',
                        info.bg
                      )}
                    >
                      <div className={cn('text-sm font-medium', info.color)}>{model.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">{model.description}</div>
                    </button>
                  )
                })}
            </div>
          </div>

          {/* Models by Level */}
          {[1, 2, 3].map((level) => {
            const levelModels = modelsByLevel[level as 1 | 2 | 3]
            if (levelModels.length === 0 && level > 1) return null

            return (
              <div key={level} className="space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-foreground">
                    Level {level} - {level === 1 ? 'Primary Models' : level === 2 ? 'Verification' : 'Final Review'}
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    {levelModels.length} models
                  </Badge>
                </div>

                {levelModels.length > 0 ? (
                  <div className="grid gap-3">
                    {levelModels.map((model) => {
                      const info = providerInfo[model.provider]
                      return (
                        <div
                          key={model.id}
                          className={cn(
                            'flex items-center justify-between p-4 rounded-lg border border-border transition-all',
                            model.enabled ? 'bg-card' : 'bg-card/50 opacity-60'
                          )}
                        >
                          <div className="flex items-center gap-4">
                            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', info.bg)}>
                              <span className={cn('text-lg font-bold', info.color)}>
                                {model.name[0]}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{model.name}</span>
                                <Badge variant="outline" className={cn('text-xs', info.color)}>
                                  {info.name}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{model.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right text-xs text-muted-foreground mr-2 border-r pr-3 border-border">
                              <div>Temp: {model.temperature}</div>
                              <div>Tokens: {model.maxTokens}</div>
                            </div>
                            <Button
                              variant={model.webSearch ? "secondary" : "ghost"}
                              size="icon"
                              className={cn("h-8 w-8", model.webSearch ? "text-blue-400 bg-blue-500/10 hover:bg-blue-500/20" : "text-muted-foreground")}
                              onClick={() => updateModel(model.id, { webSearch: !model.webSearch })}
                              title={model.webSearch ? "Web Search Enabled" : "Enable Web Search"}
                            >
                              <Globe className="w-4 h-4" />
                            </Button>
                            <Switch
                              checked={model.enabled}
                              onCheckedChange={(v) => updateModel(model.id, { enabled: v })}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => removeModel(model.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="p-8 rounded-lg border border-dashed border-border text-center">
                    <p className="text-sm text-muted-foreground">
                      No models at this level yet. Add a model to get started.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
