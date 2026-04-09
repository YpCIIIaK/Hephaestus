'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Save, Bot, Puzzle, Sparkles } from 'lucide-react'

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

export function AgentConstructor() {
  const [pipelines, setPipelines] = useState<AgentPipeline[]>([])
  const [currentPipeline, setCurrentPipeline] = useState<AgentPipeline | null>(null)
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<any[]>([])
  const [models, setModels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

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
    } catch (e) {
      console.error('Failed to load data:', e)
    } finally {
      setLoading(false)
    }
  }

  const createPipeline = () => {
    const pipeline: AgentPipeline = {
      id: `pipeline-${Date.now()}`,
      name: 'New Agent Pipeline',
      description: 'A multi-agent pipeline',
      steps: [],
      globalSkills: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

  const savePipeline = async () => {
    if (!currentPipeline) return
    try {
      // TODO: Implement storage API for agent pipelines
      console.log('Saving pipeline:', currentPipeline)
      setPipelines([...pipelines, currentPipeline])
      setOpen(false)
    } catch (e) {
      console.error('Failed to save pipeline:', e)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Sparkles className="w-4 h-4 mr-2" />
          Agent Constructor
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Agent Constructor — Build Your Own OpenClaw
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Left Sidebar - Pipeline List */}
          <div className="w-64 flex flex-col border-r border-border/50">
            <div className="p-4 border-b border-border/50">
              <Button onClick={createPipeline} className="w-full" size="sm">
                <Plus className="w-4 h-4 mr-2" /> New Pipeline
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {pipelines.map(p => (
                  <div key={p.id} className="p-3 rounded-lg border border-border/50 hover:bg-secondary/20 cursor-pointer">
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{p.steps.length} steps</p>
                  </div>
                ))}
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
                      <Input value={currentPipeline.name} onChange={e => setCurrentPipeline({ ...currentPipeline, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input value={currentPipeline.description} onChange={e => setCurrentPipeline({ ...currentPipeline, description: e.target.value })} />
                    </div>
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
                            <button onClick={() => {
                              setCurrentPipeline({
                                ...currentPipeline,
                                globalSkills: currentPipeline.globalSkills.filter(id => id !== skillId)
                              })
                            }}>
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
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeStep(index)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Role & Model */}
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Agent Role</Label>
                              <Select value={step.role} onValueChange={(v: any) => updateStep(index, { role: v })}>
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
                              <Select value={step.modelId} onValueChange={(v) => updateStep(index, { modelId: v })}>
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
                              <Slider value={[step.temperature]} min={0} max={2} step={0.1} onValueChange={([v]) => updateStep(index, { temperature: v })} />
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
                <div className="p-4 border-t border-border flex justify-between">
                  <Button variant="outline" size="sm" onClick={addStep}>
                    <Plus className="w-4 h-4 mr-2" /> Add Step
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button size="sm" onClick={savePipeline}>
                      <Save className="w-4 h-4 mr-2" /> Save Pipeline
                    </Button>
                  </div>
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
      </DialogContent>
    </Dialog>
  )
}