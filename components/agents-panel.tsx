'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { 
  Bot, 
  Puzzle, 
  Plus, 
  Trash2, 
  Save, 
  Sparkles, 
  FolderOpen, 
  Edit2,
  RotateCcw,
  Play,
  Download,
  Upload,
  Workflow,
  Link
} from 'lucide-react'
import { ChainBuilder } from './chain-builder'
import type { Chain as ChainType } from '@/lib/chains'

// Types for Agent Constructor
interface AgentStep {
  id: string
  name: string
  description: string
  role: 'classifier' | 'router' | 'analyst' | 'researcher' | 'synthesizer' | 'summarizer' | 'validator' | 'custom'
  modelId: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  skills: string[]
  contextCompression: {
    enabled: boolean
    thresholdTokens: number
    targetRatio: number
  }
  fallbackModels: string[]
  fallbackMode: 'timeout' | 'on_error'
  fallbackTimeoutMs: number
}

interface AgentPipeline {
  id: string
  name: string
  description: string
  steps: AgentStep[]
  globalSkills: string[]
  createdAt: string
  updatedAt: string
}

// Types for Skill Manager
interface Skill {
  id: string
  name: string
  description: string
  category?: string
  updatedAt: string
}

export function AgentsPanel() {
  const [activeTab, setActiveTab] = useState<'constructor' | 'skills' | 'chains'>('constructor')
  
  // Agent Constructor state
  const [pipelines, setPipelines] = useState<AgentPipeline[]>([])
  const [currentPipeline, setCurrentPipeline] = useState<AgentPipeline | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [models, setModels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Skill Manager state
  const [createSkillOpen, setCreateSkillOpen] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', description: '', category: '', content: '' })

  // Chains state
  const [chains, setChains] = useState<ChainType[]>([])
  const [selectedChain, setSelectedChain] = useState<ChainType | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [skillsRes, modelsRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/models')
      ])
      const skillsData = await skillsRes.json()
      const modelsData = await modelsRes.json()
      setSkills(skillsData.skills || [])
      setModels(modelsData.models || [])
      
      // Auto-select first pipeline if none selected
      if (!currentPipeline && pipelines.length > 0) {
        setCurrentPipeline(pipelines[0])
      }
    } catch (e) {
      console.error('Failed to load data:', e)
    } finally {
      setLoading(false)
    }
  }

  // Agent Constructor functions
  const createPipeline = (preset?: 'simple' | 'analysis' | 'research') => {
    let pipeline: AgentPipeline
    
    if (preset === 'simple') {
      // Simple pipeline with the default skill
      pipeline = {
        id: `pipeline-${Date.now()}`,
        name: 'Simple Summary Pipeline',
        description: 'Quick text summarization using the Simple Summary skill',
        steps: [
          {
            id: `step-${Date.now()}-1`,
            name: 'Summarizer Agent',
            description: 'Summarize the input text',
            role: 'summarizer',
            modelId: models[0]?.id || 'openai/gpt-3.5-turbo',
            temperature: 0.3,
            maxTokens: 500,
            systemPrompt: `You are a concise summarizer. Follow the Simple Summary skill format:

1. Extract key points (3-5 maximum)
2. Identify the main idea in one sentence
3. Keep it clear and actionable

Focus on the most important information and skip details.`,
            skills: ['simple-summary'],
            contextCompression: { enabled: false, thresholdTokens: 1000, targetRatio: 0.5 },
            fallbackModels: [],
            fallbackMode: 'timeout',
            fallbackTimeoutMs: 5000,
          }
        ],
        globalSkills: ['simple-summary'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    } else if (preset === 'analysis') {
      // Analysis pipeline
      pipeline = {
        id: `pipeline-${Date.now()}`,
        name: 'Quick Analysis Pipeline',
        description: 'Analyze content and provide insights',
        steps: [
          {
            id: `step-${Date.now()}-1`,
            name: 'Classifier',
            description: 'Classify the content type',
            role: 'classifier',
            modelId: models[0]?.id || 'openai/gpt-3.5-turbo',
            temperature: 0.1,
            maxTokens: 50,
            systemPrompt: 'Classify the input into one of: article, report, conversation, code, data. Output only the category name.',
            skills: [],
            contextCompression: { enabled: false, thresholdTokens: 1000, targetRatio: 0.5 },
            fallbackModels: [],
            fallbackMode: 'timeout',
            fallbackTimeoutMs: 5000,
          },
          {
            id: `step-${Date.now()}-2`,
            name: 'Analyst',
            description: 'Analyze the content',
            role: 'analyst',
            modelId: models[0]?.id || 'openai/gpt-3.5-turbo',
            temperature: 0.4,
            maxTokens: 1000,
            systemPrompt: 'Analyze the content and provide: 1) Key findings, 2) Patterns identified, 3) Recommendations',
            skills: [],
            contextCompression: { enabled: true, thresholdTokens: 1000, targetRatio: 0.5 },
            fallbackModels: [],
            fallbackMode: 'timeout',
            fallbackTimeoutMs: 5000,
          }
        ],
        globalSkills: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    } else {
      // Default empty pipeline
      pipeline = {
        id: `pipeline-${Date.now()}`,
        name: 'New Agent Pipeline',
        description: 'A multi-agent pipeline',
        steps: [],
        globalSkills: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }
    
    setCurrentPipeline(pipeline)
  }

  const addStep = () => {
    if (!currentPipeline) return
    const step: AgentStep = {
      id: `step-${Date.now()}`,
      name: 'New Step',
      description: '',
      role: 'analyst',
      modelId: models[0]?.id || '',
      temperature: 0.7,
      maxTokens: 1000,
      systemPrompt: '',
      skills: [],
      contextCompression: { enabled: false, thresholdTokens: 1000, targetRatio: 0.5 },
      fallbackModels: [],
      fallbackMode: 'timeout',
      fallbackTimeoutMs: 5000,
    }
    setCurrentPipeline({
      ...currentPipeline,
      steps: [...currentPipeline.steps, step],
    })
  }

  const updateStep = (index: number, updates: Partial<AgentStep>) => {
    if (!currentPipeline) return
    const newSteps = [...currentPipeline.steps]
    newSteps[index] = { ...newSteps[index], ...updates }
    setCurrentPipeline({ ...currentPipeline, steps: newSteps })
  }

  const removeStep = (index: number) => {
    if (!currentPipeline) return
    const newSteps = currentPipeline.steps.filter((_, i) => i !== index)
    setCurrentPipeline({ ...currentPipeline, steps: newSteps })
  }

  const savePipeline = () => {
    if (!currentPipeline) return
    setPipelines([...pipelines, currentPipeline])
    // In production, save to API/database
    console.log('Saving pipeline:', currentPipeline)
  }

  const exportPipeline = () => {
    if (!currentPipeline) return
    const data = JSON.stringify(currentPipeline, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentPipeline.name.replace(/\s+/g, '-')}.json`
    a.click()
  }

  const importPipeline = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (re) => {
          try {
            const data = JSON.parse(re.target?.result as string)
            setCurrentPipeline(data)
            setPipelines([...pipelines, data])
          } catch (err) {
            alert('Invalid pipeline JSON format.')
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }

  // Skill Manager functions
  const createSkill = async () => {
    if (!newSkill.name || !newSkill.description || !newSkill.content) return

    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: newSkill.name.toLowerCase().replace(/\s+/g, '-'),
          name: newSkill.name,
          description: newSkill.description,
          category: newSkill.category || undefined,
          content: newSkill.content,
        }),
      })

      if (res.ok) {
        setCreateSkillOpen(false)
        setNewSkill({ name: '', description: '', category: '', content: '' })
        loadData()
      }
    } catch (e) {
      console.error('Failed to create skill:', e)
    }
  }

  const deleteSkill = async (id: string) => {
    if (!confirm('Delete this skill?')) return
    try {
      const res = await fetch(`/api/skills?id=${id}`, { method: 'DELETE' })
      if (res.ok) loadData()
    } catch (e) {
      console.error('Failed to delete skill:', e)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background w-full min-w-0 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-4 border-b border-border gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Agent Constructor & Skills
          </h1>
          <p className="text-sm text-muted-foreground hidden sm:block">
            Build custom multi-agent pipelines and manage skills
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'constructor' | 'skills' | 'chains')} className="flex-1 flex flex-col min-h-0">
        <div className="px-4 sm:px-6 py-3 border-b border-border">
          <TabsList className="bg-secondary h-8">
            <TabsTrigger value="constructor" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
              <Bot className="w-3 h-3 sm:w-4 sm:h-4" />
              Agent Constructor
            </TabsTrigger>
            <TabsTrigger value="chains" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
              <Workflow className="w-3 h-3 sm:w-4 sm:h-4" />
              Automation Chains
            </TabsTrigger>
            <TabsTrigger value="skills" className="gap-2 text-[10px] sm:text-xs px-2 sm:px-3">
              <Puzzle className="w-3 h-3 sm:w-4 sm:h-4" />
              Skill Manager
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Chains Tab */}
        <TabsContent value="chains" className="flex-1 flex flex-col min-h-0 m-0">
          <div className="flex h-full">
            {/* Chains List Sidebar */}
            <div className="w-64 border-r border-border flex flex-col">
              <div className="p-4 border-b border-border">
                <Button 
                  className="w-full"
                  onClick={() => setSelectedChain({
                    id: `chain-${Date.now()}`,
                    name: 'New Chain',
                    description: '',
                    nodes: [],
                    edges: [],
                    triggerIds: [],
                    enabled: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    executionCount: 0,
                  } as any)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Chain
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {chains.map(chain => (
                    <div 
                      key={chain.id}
                      className="p-3 rounded-lg border border-border/50 hover:bg-secondary/20 cursor-pointer"
                      onClick={() => setSelectedChain(chain)}
                    >
                      <div className="flex items-center gap-2">
                        <Link className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm truncate">{chain.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {chain.executionCount} executions
                      </p>
                    </div>
                  ))}
                  {chains.length === 0 && (
                    <div className="p-4 text-center">
                      <Workflow className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                      <p className="text-sm text-muted-foreground">No chains yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Create your first automation chain</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            
            {/* Chain Builder */}
            <div className="flex-1">
              {selectedChain ? (
                <ChainBuilder
                  initialChain={selectedChain}
                  onSave={(chain) => {
                    setChains(prev => {
                      const exists = prev.find(c => c.id === chain.id)
                      if (exists) {
                        return prev.map(c => c.id === chain.id ? chain : c)
                      }
                      return [...prev, chain]
                    })
                    setSelectedChain(null)
                  }}
                  onExecute={(chain) => {
                    console.log('Chain executed:', chain)
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center p-8">
                    <Workflow className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">Select a chain or create a new one</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Constructor Tab */}
        <TabsContent value="constructor" className="flex-1 flex flex-col min-h-0 m-0">
          <div className="flex-1 flex gap-4 min-h-0 p-4">
            {/* Left Sidebar - Pipeline List */}
            <div className="w-64 flex flex-col border-r border-border/50">
              <div className="p-2 space-y-2">
                <Button onClick={() => createPipeline(undefined)} className="w-full" size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Pipeline
                </Button>
                <Button onClick={(e) => { e.stopPropagation(); createPipeline('simple') }} variant="outline" className="w-full" size="sm">
                  <Sparkles className="w-4 h-4 mr-2" /> Simple Summary
                </Button>
                <Button onClick={(e) => { e.stopPropagation(); createPipeline('analysis') }} variant="outline" className="w-full" size="sm">
                  <Play className="w-4 h-4 mr-2" /> Quick Analysis
                </Button>
                <Button onClick={importPipeline} variant="outline" className="w-full" size="sm">
                  <Upload className="w-4 h-4 mr-2" /> Import
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {pipelines.map(p => (
                    <div 
                      key={p.id} 
                      className="p-3 rounded-lg border border-border/50 hover:bg-secondary/20 cursor-pointer"
                      onClick={() => setCurrentPipeline(p)}
                    >
                      <p className="font-medium text-sm">{p.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{p.steps.length} steps</p>
                    </div>
                  ))}
                  {pipelines.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No pipelines yet</p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Main Editor */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {currentPipeline ? (
                <>
                  {/* Pipeline Header */}
                  <div className="p-4 border-b border-border/50 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Pipeline Name</Label>
                        <Input 
                          value={currentPipeline.name} 
                          onChange={e => setCurrentPipeline({ ...currentPipeline, name: e.target.value })} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Input 
                          value={currentPipeline.description} 
                          onChange={e => setCurrentPipeline({ ...currentPipeline, description: e.target.value })} 
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={savePipeline}>
                        <Save className="w-4 h-4 mr-2" /> Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={exportPipeline}>
                        <Download className="w-4 h-4 mr-2" /> Export
                      </Button>
                      <Button size="sm" variant="outline">
                        <Play className="w-4 h-4 mr-2" /> Run Pipeline
                      </Button>
                    </div>

                    {/* Global Skills */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Puzzle className="w-4 h-4" />
                        Global Skills (available to all steps)
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {currentPipeline.globalSkills.map(skillId => {
                          const skill = skills.find(s => s.id === skillId)
                          return (
                            <Badge key={skillId} variant="secondary" className="gap-1">
                              {skill?.name || skillId}
                              <button 
                                onClick={() => {
                                  setCurrentPipeline({
                                    ...currentPipeline,
                                    globalSkills: currentPipeline.globalSkills.filter(id => id !== skillId)
                                  })
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </Badge>
                          )
                        })}
                        <Select onValueChange={(skillId) => {
                          setCurrentPipeline({
                            ...currentPipeline,
                            globalSkills: [...currentPipeline.globalSkills, skillId]
                          })
                        }}>
                          <SelectTrigger className="w-40 h-7 text-xs">
                            <SelectValue placeholder="Add skill..." />
                          </SelectTrigger>
                          <SelectContent>
                            {skills.filter(s => !currentPipeline.globalSkills.includes(s.id)).map(skill => (
                              <SelectItem key={skill.id} value={skill.id}>{skill.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Steps */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="space-y-4">
                      {currentPipeline.steps.map((step, index) => (
                        <div key={step.id} className="p-4 rounded-xl border border-border/50 bg-secondary/10">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">Step {index + 1}</Badge>
                              <Input
                                value={step.name}
                                onChange={e => updateStep(index, { name: e.target.value })}
                                className="w-48 h-7 text-sm font-medium border-0 bg-transparent p-0 focus-visible:ring-0"
                              />
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7" 
                              onClick={() => removeStep(index)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            {/* Role & Model */}
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label>Agent Role</Label>
                                <Select 
                                  value={step.role} 
                                  onValueChange={(v: any) => updateStep(index, { role: v })}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="classifier">Classifier</SelectItem>
                                    <SelectItem value="router">Router</SelectItem>
                                    <SelectItem value="analyst">Analyst</SelectItem>
                                    <SelectItem value="researcher">Researcher</SelectItem>
                                    <SelectItem value="synthesizer">Synthesizer</SelectItem>
                                    <SelectItem value="summarizer">Summarizer</SelectItem>
                                    <SelectItem value="validator">Validator</SelectItem>
                                    <SelectItem value="custom">Custom</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <Label>Model</Label>
                                <Select 
                                  value={step.modelId} 
                                  onValueChange={(v) => updateStep(index, { modelId: v })}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Select model..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {models.map(model => (
                                      <SelectItem key={model.id} value={model.id}>
                                        <div className="flex flex-col">
                                          <span>{model.name}</span>
                                          <span className="text-[10px] text-muted-foreground">{model.provider}</span>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <Label>Temperature</Label>
                                  <span className="text-xs text-muted-foreground">{step.temperature}</span>
                                </div>
                                <Slider 
                                  value={[step.temperature]} 
                                  min={0} 
                                  max={2} 
                                  step={0.1} 
                                  onValueChange={([v]) => updateStep(index, { temperature: v })} 
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>Max Tokens</Label>
                                <Input
                                  type="number"
                                  value={step.maxTokens}
                                  onChange={e => updateStep(index, { maxTokens: parseInt(e.target.value) || 1000 })}
                                  className="h-8"
                                />
                              </div>
                            </div>

                            {/* Skills & Advanced */}
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  <Puzzle className="w-4 h-4" />
                                  Step-Specific Skills
                                </Label>
                                <div className="flex flex-wrap gap-1">
                                  {step.skills.map(skillId => {
                                    const skill = skills.find(s => s.id === skillId)
                                    return (
                                      <Badge key={skillId} variant="outline" className="gap-1 text-xs">
                                        {skill?.name || skillId}
                                        <button onClick={() => {
                                          updateStep(index, { skills: step.skills.filter(id => id !== skillId) })
                                        }}>
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </Badge>
                                    )
                                  })}
                                  <Select onValueChange={(skillId) => {
                                    updateStep(index, { skills: [...step.skills, skillId] })
                                  }}>
                                    <SelectTrigger className="h-7 text-xs w-32">
                                      <SelectValue placeholder="Add..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {skills.filter(s => !step.skills.includes(s.id)).map(skill => (
                                        <SelectItem key={skill.id} value={skill.id}>{skill.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label>System Prompt</Label>
                                <Textarea
                                  value={step.systemPrompt}
                                  onChange={e => updateStep(index, { systemPrompt: e.target.value })}
                                  placeholder="Custom system prompt for this agent..."
                                  className="h-24 text-xs resize-none"
                                />
                              </div>

                              {/* Context Compression */}
                              <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
                                <div className="flex items-center justify-between mb-2">
                                  <Label className="text-xs font-medium text-cyan-600">Context Compression</Label>
                                  <Switch
                                    checked={step.contextCompression.enabled}
                                    onCheckedChange={(checked) => updateStep(index, {
                                      contextCompression: { ...step.contextCompression, enabled: checked }
                                    })}
                                  />
                                </div>
                                {step.contextCompression.enabled && (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                      <Label>Threshold</Label>
                                      <span className="text-muted-foreground">{step.contextCompression.thresholdTokens} tokens</span>
                                    </div>
                                    <Slider
                                      value={[step.contextCompression.thresholdTokens]}
                                      min={500}
                                      max={5000}
                                      step={100}
                                      onValueChange={([v]) => updateStep(index, {
                                        contextCompression: { ...step.contextCompression, thresholdTokens: v }
                                      })}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="p-4 border-t border-border">
                    <Button variant="outline" size="sm" onClick={addStep}>
                      <Plus className="w-4 h-4 mr-2" /> Add Step
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center p-8">
                    <Bot className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">No pipeline selected</p>
                    <Button onClick={createPipeline} className="mt-4">
                      <Plus className="w-4 h-4 mr-2" /> Create New Pipeline
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="flex-1 flex flex-col min-h-0 m-0">
          <div className="p-4 flex-1 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FolderOpen className="w-4 h-4 text-violet-400" />
                Skills & Tools ({skills.length})
              </div>
              <Dialog open={createSkillOpen} onOpenChange={setCreateSkillOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" /> Create Skill
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Create New Skill</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 flex-1 overflow-hidden">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input 
                          value={newSkill.name} 
                          onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} 
                          placeholder="my-skill" 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Category (optional)</Label>
                        <Input 
                          value={newSkill.category} 
                          onChange={e => setNewSkill({ ...newSkill, category: e.target.value })} 
                          placeholder="e.g., devops, analysis" 
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input 
                        value={newSkill.description} 
                        onChange={e => setNewSkill({ ...newSkill, description: e.target.value })} 
                        placeholder="What does this skill do?" 
                      />
                    </div>
                    <div className="space-y-2 flex-1 min-h-0">
                      <Label>Skill Content (SKILL.md body)</Label>
                      <Textarea
                        value={newSkill.content}
                        onChange={e => setNewSkill({ ...newSkill, content: e.target.value })}
                        placeholder={`## What is this skill?

This skill helps you...

## How to use

1. Step one
2. Step two

## Examples

\`\`\`
Example usage here
\`\`\``}
                        className="flex-1 min-h-[200px] font-mono text-sm resize-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={() => setCreateSkillOpen(false)}>Cancel</Button>
                    <Button onClick={createSkill}>Create Skill</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {loading ? (
              <p className="text-xs text-muted-foreground">Loading skills...</p>
            ) : skills.length === 0 ? (
              <div className="p-8 rounded-lg border-2 border-dashed border-border text-center">
                <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No skills created yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Skills are reusable capabilities your agent can use.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {skills.map(skill => (
                  <div key={skill.id} className="p-4 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">{skill.name}</span>
                          {skill.category && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{skill.category}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-1">ID: {skill.id}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit">
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-destructive hover:text-destructive" 
                          title="Delete" 
                          onClick={() => deleteSkill(skill.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}