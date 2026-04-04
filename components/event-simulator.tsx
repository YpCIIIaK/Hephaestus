'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Globe,
  TrendingUp,
  Shield,
  Zap,
  Users,
  Bolt,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  BarChart3,
  ArrowRight,
  Sparkles,
  Bot,
  Plus,
  X,
  Settings2,
  Copy,
  Trash2,
  Save,
  FolderOpen,
} from 'lucide-react'

interface SimulationResult {
  scenario: 'baseline' | 'optimistic' | 'pessimistic' | 'custom'
  probability: number
  description: string
  impacts: Array<{
    domain: string
    impact: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    timeline: string
  }>
  cascadingEffects: string[]
}

interface CustomScenario {
  id: string
  name: string
  description: string
  probability: number
  temperature: number
  systemPrompt: string
}

interface SimulationConfig {
  name?: string
  event: string
  domains: string[]
  scenarios: string[]
  customScenarios: CustomScenario[]
  timeHorizon: string
  modelId: string
  maxTokens: number
  temperature: number
  includeWebSearch: boolean
  includeKnowledgeBase: boolean
  outputFormat: 'detailed' | 'brief' | 'bullet-points'
  language: string
}

const domainIcons: Record<string, any> = {
  political: Shield,
  economic: TrendingUp,
  military: Bolt,
  tech: Zap,
  social: Users,
  energy: Globe,
}

const severityColors: Record<string, string> = {
  low: 'bg-green-500/10 text-green-400 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const scenarioColors: Record<string, string> = {
  baseline: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
  optimistic: 'bg-green-500/10 border-green-500/20 text-green-400',
  pessimistic: 'bg-red-500/10 border-red-500/20 text-red-400',
  custom: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
}

const defaultPresets: SimulationConfig[] = [
  { name: 'Быстрый анализ', event: '', domains: ['political', 'economic'], scenarios: ['baseline'], customScenarios: [], timeHorizon: '30d', modelId: 'meta-llama/llama-3.3-70b-instruct:free', maxTokens: 1500, temperature: 0.3, includeWebSearch: false, includeKnowledgeBase: false, outputFormat: 'brief', language: 'ru' },
  { name: 'Полный анализ', event: '', domains: ['political', 'economic', 'military', 'tech'], scenarios: ['baseline', 'optimistic', 'pessimistic'], customScenarios: [], timeHorizon: '90d', modelId: 'anthropic/claude-3.5-sonnet', maxTokens: 3000, temperature: 0.5, includeWebSearch: true, includeKnowledgeBase: true, outputFormat: 'detailed', language: 'ru' },
  { name: 'Военный анализ', event: '', domains: ['military', 'political', 'tech'], scenarios: ['baseline', 'pessimistic'], customScenarios: [], timeHorizon: '7d', modelId: 'meta-llama/llama-3.3-70b-instruct:free', maxTokens: 2000, temperature: 0.2, includeWebSearch: true, includeKnowledgeBase: false, outputFormat: 'bullet-points', language: 'ru' },
]

export function EventSimulator() {
  const [models, setModels] = useState<any[]>([])
  const [config, setConfig] = useState<SimulationConfig>({
    event: '',
    domains: ['political', 'economic'],
    scenarios: ['baseline', 'pessimistic'],
    customScenarios: [],
    timeHorizon: '30d',
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    maxTokens: 2000,
    temperature: 0.5,
    includeWebSearch: false,
    includeKnowledgeBase: false,
    outputFormat: 'detailed',
    language: 'ru',
  })
  const [activeTab, setActiveTab] = useState('config')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<{ results: SimulationResult[]; summary: any } | null>(null)
  const [savedConfigs, setSavedConfigs] = useState<SimulationConfig[]>([])

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models) setModels(data.models)
      })
      .catch(() => {})
    
    const saved = localStorage.getItem('event-sim-configs')
    if (saved) {
      try {
        setSavedConfigs(JSON.parse(saved))
      } catch {}
    }
  }, [])

  const toggleDomain = (domain: string) => {
    setConfig(prev => ({
      ...prev,
      domains: prev.domains.includes(domain) 
        ? prev.domains.filter(d => d !== domain) 
        : [...prev.domains, domain]
    }))
  }

  const toggleScenario = (scenario: string) => {
    setConfig(prev => ({
      ...prev,
      scenarios: prev.scenarios.includes(scenario)
        ? prev.scenarios.filter(s => s !== scenario)
        : [...prev.scenarios, scenario]
    }))
  }

  const addCustomScenario = () => {
    const newScenario: CustomScenario = {
      id: `custom-${Date.now()}`,
      name: `Сценарий ${config.customScenarios.length + 1}`,
      description: 'Опишите ваш сценарий...',
      probability: 0.5,
      temperature: 0.7,
      systemPrompt: 'Вы эксперт-аналитик. Проанализируйте событие с учётом данного сценария.',
    }
    setConfig(prev => ({
      ...prev,
      customScenarios: [...prev.customScenarios, newScenario],
      scenarios: [...prev.scenarios, newScenario.id]
    }))
  }

  const updateCustomScenario = (id: string, updates: Partial<CustomScenario>) => {
    setConfig(prev => ({
      ...prev,
      customScenarios: prev.customScenarios.map(s => s.id === id ? { ...s, ...updates } : s)
    }))
  }

  const removeCustomScenario = (id: string) => {
    setConfig(prev => ({
      ...prev,
      customScenarios: prev.customScenarios.filter(s => s.id !== id),
      scenarios: prev.scenarios.filter(s => s !== id)
    }))
  }

  const applyPreset = (preset: SimulationConfig) => {
    setConfig({ ...preset, event: config.event })
  }

  const saveConfig = () => {
    const name = prompt('Название конфигурации:', 'Моя конфигурация')
    if (name) {
      const newConfigs = [...savedConfigs, { ...config, name }]
      setSavedConfigs(newConfigs)
      localStorage.setItem('event-sim-configs', JSON.stringify(newConfigs))
    }
  }

  const runSimulation = async () => {
    if (!config.event.trim() || config.domains.length === 0 || config.scenarios.length === 0) return

    setIsLoading(true)
    try {
      const res = await fetch('/api/events/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: config.event,
          domains: config.domains,
          scenarios: config.scenarios,
          customScenarios: config.customScenarios,
          timeHorizon: config.timeHorizon,
          modelId: config.modelId,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          includeWebSearch: config.includeWebSearch,
          includeKnowledgeBase: config.includeKnowledgeBase,
          outputFormat: config.outputFormat,
          language: config.language,
        }),
      })

      const data = await res.json()
      if (data.success || data.results) {
        setResults(data)
        setActiveTab('results')
      }
    } catch (e) {
      console.error('Simulation failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const eventPresets = [
    { name: '🏛️ Новые санкции', event: 'Country X imposes new economic sanctions against Country Y' },
    { name: '⚔️ Военный конфликт', event: 'Military escalation in disputed territory with troop deployments' },
    { name: '💻 Кибератака', event: 'Major cyberattack on critical national infrastructure' },
    { name: '🗳️ Выборы', event: 'Unexpected election results with pro-Western opposition winning' },
    { name: '⛽ Энергокризис', event: 'Sharp increase in oil prices due to supply disruption' },
    { name: '🤖 Технопрорыв', event: 'Breakthrough AI technology announced by major tech company' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          <h2 className="text-sm font-semibold">Event Simulator</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={saveConfig} className="gap-1 h-7 text-xs">
            <Save className="w-3 h-3" />
            Сохранить
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 overflow-hidden">
        {/* Left Column - Configuration */}
        <div className="lg:col-span-1 overflow-y-auto custom-scrollbar pr-1">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <TabsList className="w-full mb-3">
              <TabsTrigger value="config" className="flex-1 text-xs">Настройки</TabsTrigger>
              <TabsTrigger value="results" className="flex-1 text-xs">Результаты</TabsTrigger>
              <TabsTrigger value="saved" className="flex-1 text-xs">Сохранённые</TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="space-y-4 mt-0">
              {/* Event Input */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Событие</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={config.event}
                    onChange={(e) => setConfig(prev => ({ ...prev, event: e.target.value }))}
                    placeholder="Опишите событие для анализа..."
                    className="min-h-[80px] resize-none text-xs"
                  />
                  <div className="grid grid-cols-2 gap-1">
                    {eventPresets.map((preset, i) => (
                      <button
                        key={i}
                        onClick={() => setConfig(prev => ({ ...prev, event: preset.event }))}
                        className="px-2 py-1 text-[10px] rounded bg-secondary/50 hover:bg-secondary border border-border/50 transition-colors text-left truncate"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Domains */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Домены анализа</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(domainIcons).map(([domain, Icon]) => (
                      <button
                        key={domain}
                        onClick={() => toggleDomain(domain)}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-colors text-xs capitalize ${
                          config.domains.includes(domain)
                            ? 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                            : 'bg-secondary/30 border-border/50 text-muted-foreground hover:border-border'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        <span className="truncate">{domain}</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Scenarios */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Сценарии</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {['baseline', 'optimistic', 'pessimistic'].map(scenario => (
                    <button
                      key={scenario}
                      onClick={() => toggleScenario(scenario)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors text-xs capitalize ${
                        config.scenarios.includes(scenario)
                          ? scenarioColors[scenario as keyof typeof scenarioColors]
                          : 'bg-secondary/30 border-border/50 text-muted-foreground'
                      }`}
                    >
                      <span>{scenario}</span>
                      <div className={`w-3.5 h-3.5 rounded border ${
                        config.scenarios.includes(scenario) ? 'bg-current border-current' : 'border-border'
                      }`} />
                    </button>
                  ))}

                  {/* Custom Scenarios */}
                  {config.customScenarios.map(scenario => (
                    <div key={scenario.id} className="p-2 rounded-lg border border-violet-500/20 bg-violet-500/5">
                      <div className="flex items-center justify-between mb-1">
                        <Input
                          value={scenario.name}
                          onChange={(e) => updateCustomScenario(scenario.id, { name: e.target.value })}
                          className="h-6 text-xs bg-transparent border-0 p-0 focus-visible:ring-0 font-medium text-violet-400"
                        />
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => removeCustomScenario(scenario.id)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <Textarea
                        value={scenario.description}
                        onChange={(e) => updateCustomScenario(scenario.id, { description: e.target.value })}
                        className="min-h-[40px] text-[10px] resize-none mb-2"
                        placeholder="Описание сценария..."
                      />
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Вероятность: {Math.round(scenario.probability * 100)}%</span>
                        <Slider
                          value={[scenario.probability * 100]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={([v]) => updateCustomScenario(scenario.id, { probability: v / 100 })}
                          className="w-20"
                        />
                      </div>
                    </div>
                  ))}

                  <Button variant="outline" size="sm" onClick={addCustomScenario} className="w-full gap-1 text-xs h-8">
                    <Plus className="w-3 h-3" />
                    Добавить сценарий
                  </Button>
                </CardContent>
              </Card>

              {/* Model & Parameters */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5" />
                    Модель и параметры
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px]">Модель</Label>
                    <Select value={config.modelId} onValueChange={(v) => setConfig(prev => ({ ...prev, modelId: v }))}>
                      <SelectTrigger className="text-xs h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px]">Temperature</Label>
                      <span className="text-[10px] text-muted-foreground">{config.temperature}</span>
                    </div>
                    <Slider
                      value={[config.temperature]}
                      min={0}
                      max={1}
                      step={0.1}
                      onValueChange={([v]) => setConfig(prev => ({ ...prev, temperature: v }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px]">Max Tokens</Label>
                      <span className="text-[10px] text-muted-foreground">{config.maxTokens}</span>
                    </div>
                    <Slider
                      value={[config.maxTokens]}
                      min={500}
                      max={4000}
                      step={100}
                      onValueChange={([v]) => setConfig(prev => ({ ...prev, maxTokens: v }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px]">Формат вывода</Label>
                    <Select value={config.outputFormat} onValueChange={(v: any) => setConfig(prev => ({ ...prev, outputFormat: v }))}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="detailed">Детальный</SelectItem>
                        <SelectItem value="brief">Краткий</SelectItem>
                        <SelectItem value="bullet-points">Тезисы</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px]">Язык</Label>
                    <Select value={config.language} onValueChange={(v) => setConfig(prev => ({ ...prev, language: v }))}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ru">Русский</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="zh">中文</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Options */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-2">
                    <Settings2 className="w-3.5 h-3.5" />
                    Опции
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">Веб-поиск</Label>
                      <p className="text-[10px] text-muted-foreground">Добавить актуальные данные</p>
                    </div>
                    <Switch
                      checked={config.includeWebSearch}
                      onCheckedChange={(v) => setConfig(prev => ({ ...prev, includeWebSearch: v }))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">База знаний</Label>
                      <p className="text-[10px] text-muted-foreground">Использовать KB файлы</p>
                    </div>
                    <Switch
                      checked={config.includeKnowledgeBase}
                      onCheckedChange={(v) => setConfig(prev => ({ ...prev, includeKnowledgeBase: v }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px]">Горизонт</Label>
                    <Select value={config.timeHorizon} onValueChange={(v) => setConfig(prev => ({ ...prev, timeHorizon: v }))}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7d">7 дней</SelectItem>
                        <SelectItem value="30d">30 дней</SelectItem>
                        <SelectItem value="90d">90 дней</SelectItem>
                        <SelectItem value="1y">1 год</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Run Button */}
              <Button
                onClick={runSimulation}
                disabled={isLoading || !config.event.trim() || config.domains.length === 0 || config.scenarios.length === 0}
                className="w-full gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Анализ...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Запустить симуляцию
                  </>
                )}
              </Button>
            </TabsContent>

            {/* Saved Configs Tab */}
            <TabsContent value="saved" className="space-y-3 mt-0">
              {savedConfigs.length === 0 ? (
                <Card className="bg-card border-border p-6 text-center">
                  <FolderOpen className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">Нет сохранённых конфигураций</p>
                </Card>
              ) : (
                savedConfigs.map((cfg, i) => (
                  <Card key={i} className="bg-card border-border cursor-pointer hover:border-violet-500/30 transition-colors">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{cfg.name || `Конфигурация ${i + 1}`}</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => {
                          e.stopPropagation()
                          const newConfigs = savedConfigs.filter((_, idx) => idx !== i)
                          setSavedConfigs(newConfigs)
                          localStorage.setItem('event-sim-configs', JSON.stringify(newConfigs))
                        }}>
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{cfg.event || 'Без события'}</p>
                      <div className="flex gap-1 mt-2">
                        <Badge variant="outline" className="text-[9px]">{cfg.domains.length} доменов</Badge>
                        <Badge variant="outline" className="text-[9px]">{cfg.scenarios.length} сценариев</Badge>
                      </div>
                      <Button size="sm" className="w-full mt-2 h-7 text-xs" onClick={() => applyPreset(cfg)}>
                        <Copy className="w-3 h-3 mr-1" />
                        Применить
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Results Tab */}
            <TabsContent value="results" className="mt-0">
              {results ? (
                <ScrollArea className="h-[calc(100vh-180px)]">
                  <div className="space-y-4 pr-2">
                    {results.results.map((result: SimulationResult) => (
                      <Card key={result.scenario} className={`border ${scenarioColors[result.scenario as keyof typeof scenarioColors] || scenarioColors.custom}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold capitalize text-sm">{result.scenario}</h4>
                            <Badge className={severityColors[result.probability > 0.5 ? 'high' : 'medium']}>
                              {Math.round(result.probability * 100)}%
                            </Badge>
                          </div>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">{result.description}</p>
                          
                          {result.impacts.length > 0 && (
                            <>
                              <Separator />
                              <div className="space-y-2">
                                {result.impacts.map((impact, i) => {
                                  const Icon = domainIcons[impact.domain] || Globe
                                  return (
                                    <div key={i} className={`p-2 rounded border ${severityColors[impact.severity]}`}>
                                      <div className="flex items-center gap-2 mb-1">
                                        <Icon className="w-3 h-3" />
                                        <span className="text-xs font-medium capitalize">{impact.domain}</span>
                                        <Badge className={`text-[9px] ml-auto ${severityColors[impact.severity]}`}>
                                          {impact.severity}
                                        </Badge>
                                      </div>
                                      <p className="text-[10px] text-muted-foreground">{impact.impact}</p>
                                      <p className="text-[9px] text-muted-foreground mt-1">⏱ {impact.timeline}</p>
                                    </div>
                                  )
                                })}
                              </div>
                            </>
                          )}

                          {result.cascadingEffects.length > 0 && (
                            <>
                              <Separator />
                              <div className="space-y-1.5">
                                <h5 className="text-xs font-medium flex items-center gap-1">
                                  <ArrowRight className="w-3 h-3" />
                                  Цепные реакции
                                </h5>
                                {result.cascadingEffects.map((effect, i) => (
                                  <div key={i} className="flex items-start gap-1.5 p-1.5 rounded bg-secondary/30 text-[10px]">
                                    <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                                    <span className="text-muted-foreground">{effect}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <Card className="bg-card border-border p-8 text-center">
                  <Globe className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Запустите симуляцию для получения результатов</p>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Main Results View */}
        <div className="lg:col-span-3 overflow-y-auto custom-scrollbar pr-1">
          {results ? (
            <Tabs defaultValue={results.results[0]?.scenario || 'baseline'}>
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm">Результаты симуляции</CardTitle>
                      <CardDescription className="text-xs mt-1 line-clamp-1">{results.summary.event}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs gap-1">
                        <Clock className="w-3 h-3" />
                        {results.summary.timeHorizon}
                      </Badge>
                      <Badge variant="outline" className="text-xs gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {results.summary.successfulAnalyses} анализов
                      </Badge>
                    </div>
                  </div>

                  <TabsList className="w-full mt-3">
                    {results.results.map((r: SimulationResult) => (
                      <TabsTrigger key={r.scenario} value={r.scenario} className="flex-1 text-xs capitalize">
                        {r.scenario} ({Math.round(r.probability * 100)}%)
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </CardHeader>

                <CardContent>
                  {results.results.map((result: SimulationResult) => (
                    <TabsContent key={result.scenario} value={result.scenario} className="space-y-4 mt-0">
                      <div className={`p-4 rounded-lg border ${scenarioColors[result.scenario as keyof typeof scenarioColors] || scenarioColors.custom}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold capitalize">{result.scenario} сценарий</h4>
                          <Badge className={severityColors[result.probability > 0.5 ? 'high' : 'medium']}>
                            Вероятность: {Math.round(result.probability * 100)}%
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap">{result.description}</p>
                      </div>

                      <Separator />

                      <div className="space-y-3">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Анализ влияния
                        </h4>
                        {result.impacts.map((impact, i) => {
                          const Icon = domainIcons[impact.domain] || Globe
                          return (
                            <div key={i} className={`p-3 rounded-lg border ${severityColors[impact.severity]}`}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <Icon className="w-3.5 h-3.5" />
                                  <span className="text-xs font-medium capitalize">{impact.domain}</span>
                                </div>
                                <Badge className={`text-[10px] ${severityColors[impact.severity]}`}>
                                  {impact.severity}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{impact.impact}</p>
                              <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                Срок: {impact.timeline}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {result.cascadingEffects.length > 0 && (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium flex items-center gap-2">
                              <ArrowRight className="w-4 h-4" />
                              Цепные реакции
                            </h4>
                            {result.cascadingEffects.map((effect, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 rounded bg-secondary/30 border border-border/50">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                                <span className="text-xs text-muted-foreground">{effect}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </TabsContent>
                  ))}
                </CardContent>
              </Card>
            </Tabs>
          ) : (
            <Card className="bg-card border-border h-full flex items-center justify-center p-8">
              <div className="text-center space-y-4">
                <Globe className="w-12 h-12 mx-auto text-muted-foreground/30" />
                <div>
                  <h3 className="text-lg font-medium text-foreground">Event Simulator</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Настройте параметры и запустите симуляцию
                  </p>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Выберите домены для кросс-доменного анализа</p>
                  <p>Добавьте кастомные сценарии</p>
                  <p>Выберите модель и параметры генерации</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}