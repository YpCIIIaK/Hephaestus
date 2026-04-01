'use client'

import { useArenaStore } from '@/lib/store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, Tooltip, Legend 
} from 'recharts'
import { 
  Activity, Zap, Clock, TrendingUp, Coins, 
  BarChart3, Sparkles, Calendar, Layers, AlertTriangle,
  Download, FileText, Table2
} from 'lucide-react'
import { useMemo } from 'react'
import { WaterfallGantt } from '@/components/waterfall-gantt'
import { Button } from '@/components/ui/button'
import { downloadCSV, downloadPDF } from '@/lib/export-utils'

const COLORS = ['#ffffff', '#e2e8f0', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a']

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl backdrop-blur-md">
        <p className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm font-semibold" style={{ color: entry.color || '#fff' }}>
            {entry.name}: {entry.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export function AnalyticsPanel() {
  const { responses, historicalChats, globalUsage, usageHistory } = useArenaStore()

  // 1. Process Global Stats (Prioritize usageHistory for accuracy)
  const stats = useMemo(() => {
    // Current Chat Responses (for live updates)
    const activeResponses = responses.filter(r => r.status === 'complete')
    
    // Total from persistent state
    const totalTokens = globalUsage.totalTokens
    const totalCost = globalUsage.totalCost
    const totalRequests = globalUsage.totalRequests
    
    // Avg Latency (aggregated from history)
    const completedResponses = [...historicalChats.flatMap(c => c.responses), ...responses].filter(r => r.status === 'complete')
    const avgLatency = completedResponses.length > 0 
      ? completedResponses.reduce((acc, r) => acc + (r.latency || 0), 0) / completedResponses.length 
      : 0

    // Timeline Data (Last 20 events)
    const timelineData = usageHistory.slice(-20).map((event, i) => ({
      index: i + 1,
      name: event.modelName.split('/').pop(),
      tokens: event.tokens,
      cost: event.cost
    }))

    // Model Distribution (Aggregate by ID, Display by Name)
    const modelMap = usageHistory
      .filter(e => e.type !== 'error')
      .reduce((acc, event) => {
        const key = event.modelId || event.modelName
        if (!acc[key]) acc[key] = { value: 0, name: event.modelName }
        acc[key].value += event.tokens
        return acc
      }, {} as Record<string, { value: number, name: string }>)

    const pieData = Object.values(modelMap)
      .map(item => ({ name: item.name, value: item.value }))
      .sort((a, b) => b.value - a.value)

    return { totalTokens, totalCost, totalRequests, avgLatency, timelineData, pieData }
  }, [responses, historicalChats, globalUsage, usageHistory])

  // 2. Daily History Data
  const dailyData = useMemo(() => {
    const dayMap = usageHistory
      .filter(e => e.type !== 'error')
      .reduce((acc, event) => {
        const date = new Date(event.timestamp).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
        if (!acc[date]) acc[date] = { date, tokens: 0, cost: 0, count: 0 }
        acc[date].tokens += event.tokens
        acc[date].cost += event.cost
        acc[date].count += 1
        return acc
      }, {} as Record<string, any>)

    return Object.values(dayMap).slice(-14) // Last 14 days
  }, [usageHistory])

  // 3. Per-Model Detailed Stats
  const modelStats = useMemo(() => {
    const mData = usageHistory
      .filter(e => e.type !== 'error')
      .reduce((acc, event) => {
        const key = event.modelId || event.modelName
        if (!acc[key]) {
          acc[key] = { 
            id: key, 
            name: event.modelName, 
            tokens: 0, 
            cost: 0, 
            count: 0,
            avgTokens: 0
          }
        }
        acc[key].tokens += event.tokens
        acc[key].cost += event.cost
        acc[key].count += 1
        return acc
      }, {} as Record<string, any>)

    return Object.values(mData)
      .map((m: any) => ({ ...m, avgTokens: Math.round(m.tokens / m.count) }))
      .sort((a: any, b: any) => b.cost - a.cost)
  }, [usageHistory])

  // 4. Speed (latency & tokens/sec) from pipeline node measurements
  const pipelineSpeedByModel = useMemo(() => {
    const shorten = (name: string | undefined) => {
      if (!name) return 'unknown'
      const last = name.includes('/') ? name.split('/').pop() : name
      return (last || name).slice(0, 22)
    }

    const allResponses = [
      ...historicalChats.flatMap(c => c.responses),
      ...responses,
    ]

    const completedSteps = allResponses
      .filter(r => r.status === 'complete' && Array.isArray(r.pipelineSteps))
      .flatMap(r => r.pipelineSteps || [])
      .filter((s: any) =>
        s.status === 'completed' &&
        typeof s.latencyMs === 'number' &&
        typeof s.tokens === 'number' &&
        (s.tokens || 0) > 0 &&
        (s.latencyMs || 0) > 0 &&
        s.modelId
      )

    const byModel = new Map<string, { modelId: string; modelName: string; totalLatencyMs: number; totalTokens: number; count: number }>()

    completedSteps.forEach((s: any) => {
      const modelId = s.modelId as string
      const modelName = s.modelName || modelId
      const current = byModel.get(modelId)
      if (!current) {
        byModel.set(modelId, {
          modelId,
          modelName,
          totalLatencyMs: s.latencyMs,
          totalTokens: s.tokens,
          count: 1,
        })
        return
      }
      current.totalLatencyMs += s.latencyMs
      current.totalTokens += s.tokens
      current.count += 1
    })

    const rows = Array.from(byModel.values()).map(v => {
      const avgLatencySec = (v.totalLatencyMs / Math.max(v.count, 1)) / 1000
      const totalSeconds = v.totalLatencyMs / 1000
      const tokensPerSec = totalSeconds > 0 ? v.totalTokens / totalSeconds : 0
      return {
        modelId: v.modelId,
        displayName: shorten(v.modelName),
        avgLatencySec,
        tokensPerSec,
        count: v.count,
      }
    })

    return rows
      .sort((a, b) => b.tokensPerSec - a.tokensPerSec)
      .slice(0, 8)
  }, [responses, historicalChats])

  // 5. Error stats (donut overall error rate + list of models that fail)
  const pipelineErrorStats = useMemo(() => {
    const allResponses = [
      ...historicalChats.flatMap(c => c.responses),
      ...responses,
    ]

    const modelSteps = allResponses
      .filter(r => r.status === 'complete' && Array.isArray(r.pipelineSteps))
      .flatMap(r => r.pipelineSteps || [])
      .filter((s: any) => {
        if (!s || typeof s !== 'object') return false
        if (!s.modelId) return false
        return s.status === 'completed' || s.status === 'error'
      })

    const byModel = new Map<string, { modelId: string; modelName: string; success: number; error: number }>()
    modelSteps.forEach((s: any) => {
      const modelId = s.modelId as string
      const modelName = s.modelName || modelId
      const current = byModel.get(modelId)
      if (!current) {
        byModel.set(modelId, { modelId, modelName, success: 0, error: 0 })
      }
      const updated = byModel.get(modelId)!
      if (s.status === 'error') updated.error += 1
      if (s.status === 'completed') updated.success += 1
    })

    let totalError = 0
    let totalSuccess = 0
    Array.from(byModel.values()).forEach(v => {
      totalError += v.error
      totalSuccess += v.success
    })

    const totalAttempts = totalError + totalSuccess
    const errorRate = totalAttempts > 0 ? totalError / totalAttempts : 0

    const topFailingModels = Array.from(byModel.values())
      .map(v => {
        const attempts = v.error + v.success
        const rate = attempts > 0 ? v.error / attempts : 0
        const shortenName = (name: string) => {
          const last = name.includes('/') ? name.split('/').pop() : name
          return (last || name).slice(0, 28)
        }
        return {
          modelId: v.modelId,
          displayName: shortenName(v.modelName),
          errorCount: v.error,
          successCount: v.success,
          errorRate: rate,
          attempts,
        }
      })
      .sort((a, b) => b.errorCount - a.errorCount || b.errorRate - a.errorRate)
      .slice(0, 6)

    return {
      totalError,
      totalSuccess,
      errorRate,
      topFailingModels,
      donutData: [
        { name: 'Errors', value: totalError, color: '#f97316' },
        { name: 'Success', value: totalSuccess, color: '#10b981' },
      ],
    }
  }, [responses, historicalChats])

  // 6. Prompt vs Completion efficiency (tokens + cost share)
  const pipelineEfficiencyStats = useMemo(() => {
    const allResponses = [
      ...historicalChats.flatMap(c => c.responses),
      ...responses,
    ]

    const steps = allResponses
      .filter(r => r.status === 'complete' && Array.isArray(r.pipelineSteps))
      .flatMap(r => r.pipelineSteps || [])
      .filter((s: any) => {
        return (
          s &&
          s.status === 'completed' &&
          typeof s.promptTokens === 'number' &&
          typeof s.completionTokens === 'number' &&
          (s.promptTokens as number) + (s.completionTokens as number) > 0
        )
      })

    let promptTokensSum = 0
    let completionTokensSum = 0
    let promptCostSum = 0
    let completionCostSum = 0

    const fallbackCostPer1K = 0.002

    for (const s of steps as any[]) {
      const pt = s.promptTokens as number
      const ct = s.completionTokens as number
      promptTokensSum += pt
      completionTokensSum += ct

      if (typeof s.promptCost === 'number' && typeof s.completionCost === 'number') {
        promptCostSum += s.promptCost as number
        completionCostSum += s.completionCost as number
      } else {
        const totalTokens = pt + ct
        const totalCost = (totalTokens / 1000) * fallbackCostPer1K
        const promptShare = totalTokens > 0 ? pt / totalTokens : 0
        promptCostSum += totalCost * promptShare
        completionCostSum += totalCost - totalCost * promptShare
      }
    }

    const totalTokensSum = promptTokensSum + completionTokensSum
    const totalCostSum = promptCostSum + completionCostSum

    const tokenDonutData = [
      { name: 'Prompt', value: promptTokensSum, color: '#f59e0b' },
      { name: 'Completion', value: completionTokensSum, color: '#10b981' },
    ]

    const costDonutData = [
      { name: 'Prompt', value: promptCostSum, color: '#f59e0b' },
      { name: 'Completion', value: completionCostSum, color: '#10b981' },
    ]

    const promptTokenShare = totalTokensSum > 0 ? promptTokensSum / totalTokensSum : 0
    const promptCostShare = totalCostSum > 0 ? promptCostSum / totalCostSum : 0

    return {
      hasData: totalTokensSum > 0,
      tokenDonutData,
      costDonutData,
      promptTokenShare,
      promptCostShare,
    }
  }, [responses, historicalChats])

  return (
    <div className="flex-1 w-full h-full bg-background/50 overflow-y-auto custom-scrollbar">
      <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 pb-40">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Activity className="w-4 h-4 text-emerald-500" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">Usage Dashboard</h1>
              </div>
              <p className="text-muted-foreground">Detailed analytics across all models and pipelines</p>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Export Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const latestResponse = responses.find(r => r.status === 'complete' && r.pipelineSteps)
                    if (latestResponse?.pipelineSteps) {
                      downloadCSV({
                        title: 'Pipeline Report',
                        timestamp: new Date().toISOString(),
                        pipelineSteps: latestResponse.pipelineSteps,
                        totalCost: latestResponse.pipelineSteps.reduce((acc, s) => acc + (s.promptCost || 0) + (s.completionCost || 0), 0),
                        totalTokens: latestResponse.pipelineSteps.reduce((acc, s) => acc + (s.tokens || 0), 0),
                        latency: latestResponse.pipelineSteps.reduce((acc, s) => acc + (s.latencyMs || 0), 0)
                      }, `pipeline-report-${new Date().toISOString().slice(0, 10)}.csv`)
                    }
                  }}
                  className="gap-2"
                  disabled={!responses.some(r => r.status === 'complete' && r.pipelineSteps)}
                >
                  <Table2 className="w-4 h-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const latestResponse = responses.find(r => r.status === 'complete' && r.pipelineSteps)
                    if (latestResponse?.pipelineSteps) {
                      downloadPDF({
                        title: 'Pipeline Execution Report',
                        timestamp: new Date().toISOString(),
                        pipelineSteps: latestResponse.pipelineSteps,
                        totalCost: latestResponse.pipelineSteps.reduce((acc, s) => acc + (s.promptCost || 0) + (s.completionCost || 0), 0),
                        totalTokens: latestResponse.pipelineSteps.reduce((acc, s) => acc + (s.tokens || 0), 0),
                        latency: latestResponse.pipelineSteps.reduce((acc, s) => acc + (s.latencyMs || 0), 0)
                      }, `pipeline-report-${new Date().toISOString().slice(0, 10)}.pdf`)
                    }
                  }}
                  className="gap-2"
                  disabled={!responses.some(r => r.status === 'complete' && r.pipelineSteps)}
                >
                  <FileText className="w-4 h-4" />
                  PDF
                </Button>
              </div>
              
              <div className="flex items-center gap-4 bg-secondary/30 p-1 rounded-lg border border-border/50">
                <div className="px-3 py-1 text-xs font-semibold text-emerald-500 uppercase">Live</div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-2" />
              </div>
            </div>
          </div>

          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Total Tokens" value={stats.totalTokens.toLocaleString()} sub="Accumulated usage" icon={Zap} color="text-emerald-500" />
            <MetricCard title="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} sub="Accurate OpenRouter pricing" icon={Coins} color="text-slate-200" />
            <MetricCard title="Avg. Latency" value={`${(stats.avgLatency / 1000).toFixed(2)}s`} sub="Response delivery" icon={Clock} color="text-slate-200" />
            <MetricCard title="Total Requests" value={stats.totalRequests.toString()} sub="Total initiated pipeline calls" icon={Layers} color="text-slate-100" />
          </div>

          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="bg-secondary/50 border border-border/50 p-1">
              <TabsTrigger value="overview" className="gap-2"><BarChart3 className="w-4 h-4" /> Overview</TabsTrigger>
              <TabsTrigger value="daily" className="gap-2"><Calendar className="w-4 h-4" /> Daily History</TabsTrigger>
              <TabsTrigger value="models" className="gap-2"><Layers className="w-4 h-4" /> Model Breakdown</TabsTrigger>
              <TabsTrigger value="waterfall" className="gap-2"><Clock className="w-4 h-4" /> Waterfall</TabsTrigger>
            </TabsList>

            {/* OVERVIEW TAB */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-emerald-500" /> Recent Token Usage
                    </CardTitle>
                    <CardDescription>Visualizing last 20 requests</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px] w-full mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.timelineData}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                          <XAxis 
                            dataKey="index" 
                            stroke="#888888" 
                            fontSize={11} 
                            tickLine={false} 
                            axisLine={false} 
                          />
                          <YAxis 
                            stroke="#888888" 
                            fontSize={11} 
                            tickLine={false} 
                            axisLine={false} 
                          />
                          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                          <Bar dataKey="tokens" fill="#ffffff" radius={[4, 4, 0, 0]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-blue-500" /> Cumulative Distribution
                    </CardTitle>
                    <CardDescription>Tokens requested per provider</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px] w-full mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stats.pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            stroke="none"
                          >
                            {stats.pieData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#000" strokeWidth={1} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#888' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Progress list for quick share */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader>
                  <CardTitle className="text-lg">Relative Market Share</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {stats.pieData.slice(0, 5).map((model, idx) => (
                    <div key={model.name} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{model.name}</span>
                        <span className="text-muted-foreground">{Math.round((model.value / Math.max(stats.totalTokens, 1)) * 100)}%</span>
                      </div>
                      <Progress value={(model.value / Math.max(stats.totalTokens, 1)) * 100} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Speed by model (tokens/sec and average latency) */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-400" /> Speed by Model
                  </CardTitle>
                  <CardDescription>
                    Avg latency (seconds) and generation speed (tokens/sec) for completed pipeline nodes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {pipelineSpeedByModel.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Нет данных по скорости. Запустите пайплайн в режиме Chat, чтобы измерения сохранились в истории.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <div className="text-sm font-medium mb-2 text-foreground/90">
                          Avg latency (s)
                        </div>
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={pipelineSpeedByModel}>
                              <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                              <XAxis
                                dataKey="displayName"
                                stroke="#888888"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis
                                stroke="#888888"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                              />
                              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                              <Bar
                                dataKey="avgLatencySec"
                                name="Avg latency (s)"
                                fill="#3b82f6"
                                radius={[4, 4, 0, 0]}
                                barSize={18}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-medium mb-2 text-foreground/90">
                          Tokens/sec
                        </div>
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={pipelineSpeedByModel}>
                              <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                              <XAxis
                                dataKey="displayName"
                                stroke="#888888"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis
                                stroke="#888888"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                              />
                              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                              <Bar
                                dataKey="tokensPerSec"
                                name="Tokens/sec"
                                fill="#10b981"
                                radius={[4, 4, 0, 0]}
                                barSize={18}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Error stats (donut + top failing models) */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" /> Errors by Model
                  </CardTitle>
                  <CardDescription>
                    Donut shows overall error rate; list shows models with most failed steps
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {pipelineErrorStats.totalError + pipelineErrorStats.totalSuccess === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Нет данных по ошибкам. Запустите пайплайн в режиме Chat, чтобы появились измерения.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                      <div className="relative h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pipelineErrorStats.donutData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={3}
                              stroke="none"
                            >
                              {pipelineErrorStats.donutData.map((entry, index) => (
                                <Cell key={`err-cell-${index}`} fill={entry.color} stroke="#000" strokeWidth={1} />
                              ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>

                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-amber-500">
                              {(pipelineErrorStats.errorRate * 100).toFixed(1)}%
                            </div>
                            <div className="text-xs text-muted-foreground">error rate</div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-sm font-medium text-foreground/90">Top failing models</div>
                        <div className="space-y-3">
                          {pipelineErrorStats.topFailingModels.map((m) => (
                            <div key={m.modelId} className="p-3 rounded-xl border border-border/50 bg-secondary/20">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground truncate">{m.displayName}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    errors: {m.errorCount} / {m.attempts}
                                  </div>
                                </div>
                                <div className="text-sm font-bold text-destructive">
                                  {(m.errorRate * 100).toFixed(0)}%
                                </div>
                              </div>
                              <div className="mt-2">
                                <Progress value={m.errorRate * 100} className="h-2" />
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Считаем только шаги пайплайна, у которых есть `modelId`, и учитываем статусы `completed` и `error`.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Prompt vs Completion efficiency */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Coins className="h-5 w-5 text-amber-500" /> Prompt vs Completion Efficiency
                  </CardTitle>
                  <CardDescription>
                    Доля токенов и стоимости между входным контекстом и генерацией (по завершенным шагам пайплайна)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!pipelineEfficiencyStats.hasData ? (
                    <p className="text-sm text-muted-foreground">
                      Нет данных по prompt/completion. Запустите пайплайн из Chat, чтобы измерения сохранились в истории.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                      <div className="space-y-3">
                        <div className="text-sm font-medium text-foreground/90">Tokens split</div>
                        <div className="relative h-[250px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={pipelineEfficiencyStats.tokenDonutData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={3}
                                stroke="none"
                              >
                                {pipelineEfficiencyStats.tokenDonutData.map((entry, index) => (
                                  <Cell key={`tok-cell-${index}`} fill={entry.color} stroke="#000" strokeWidth={1} />
                                ))}
                              </Pie>
                              <Tooltip content={<CustomTooltip />} />
                            </PieChart>
                          </ResponsiveContainer>

                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-amber-500">
                                {(pipelineEfficiencyStats.promptTokenShare * 100).toFixed(0)}%
                              </div>
                              <div className="text-xs text-muted-foreground">prompt share</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="text-sm font-medium text-foreground/90">Cost split</div>
                        <div className="relative h-[250px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={pipelineEfficiencyStats.costDonutData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={3}
                                stroke="none"
                              >
                                {pipelineEfficiencyStats.costDonutData.map((entry, index) => (
                                  <Cell key={`cost-cell-${index}`} fill={entry.color} stroke="#000" strokeWidth={1} />
                                ))}
                              </Pie>
                              <Tooltip content={<CustomTooltip />} />
                            </PieChart>
                          </ResponsiveContainer>

                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-amber-500">
                                {(pipelineEfficiencyStats.promptCostShare * 100).toFixed(0)}%
                              </div>
                              <div className="text-xs text-muted-foreground">prompt cost share</div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 pt-1">
                          <div className="text-xs font-medium text-foreground/90">Top failing models</div>
                          <div className="space-y-2">
                            {pipelineErrorStats.topFailingModels.slice(0, 3).map((m) => (
                              <div key={`eff-fail-${m.modelId}`} className="p-2 rounded-xl border border-border/50 bg-secondary/20">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-[10px] text-muted-foreground truncate font-medium">{m.displayName}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      errors: {m.errorCount} / {m.attempts}
                                    </div>
                                  </div>
                                  <div className="text-[10px] font-bold text-destructive">
                                    {(m.errorRate * 100).toFixed(0)}%
                                  </div>
                                </div>
                                <Progress value={m.errorRate * 100} className="h-1.5 mt-2" />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* DAILY HISTORY TAB */}
            <TabsContent value="daily">
              <Card className="border-border/50 bg-card/50">
                <CardHeader>
                  <CardTitle>Usage History by Day</CardTitle>
                  <CardDescription>Daily cost and token accumulation for the last 14 days</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                        <XAxis dataKey="date" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="cost" name="Cost ($)" fill="#ffffff" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="tokens" name="Tokens" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MODELS BREAKDOWN TAB */}
            <TabsContent value="models">
              <Card className="border-border/50 bg-card/50">
                <CardHeader>
                  <CardTitle>Detailed Model Breakdown</CardTitle>
                  <CardDescription>Specific costs based on OpenRouter real-time pricing</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-border/50">
                    <Table>
                      <TableHeader className="bg-secondary/30">
                        <TableRow>
                          <TableHead className="w-[300px]">Model Name</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Avg. Tokens</TableHead>
                          <TableHead className="text-right">Total Tokens</TableHead>
                          <TableHead className="text-right">Total Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {modelStats.map((model) => (
                          <TableRow key={model.id} className="hover:bg-secondary/20">
                            <TableCell className="font-medium">{model.name}</TableCell>
                            <TableCell className="text-right">{model.count}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{model.avgTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{model.tokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-emerald-500">${model.cost.toFixed(5)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* WATERFALL TAB */}
            <TabsContent value="waterfall" className="space-y-6">
              <WaterfallGantt 
                pipelineSteps={responses.find(r => r.status === 'complete' && r.pipelineSteps && r.pipelineSteps.length > 0)?.pipelineSteps}
              />
              
              {/* Historical Waterfalls */}
              {historicalChats
                .filter(chat => chat.responses.some(r => r.pipelineSteps && r.pipelineSteps.some(s => typeof s.startTime === 'number')))
                .slice(0, 3)
                .map(chat => (
                  <WaterfallGantt 
                    key={chat.id}
                    pipelineSteps={chat.responses.find(r => r.pipelineSteps)?.pipelineSteps}
                    className="mt-6"
                  />
                ))}
            </TabsContent>
          </Tabs>
      </div>
    </div>
  )
}

function MetricCard({ title, value, sub, icon: Icon, color }: any) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  )
}
