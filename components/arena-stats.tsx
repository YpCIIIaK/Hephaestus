'use client'

import { useArenaStore } from '@/lib/store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Tooltip,
  Legend,
} from 'recharts'
import { 
  Activity, 
  Zap, 
  Clock, 
  TrendingUp,
  Layers,
  GitBranch,
  Bot,
  MessageSquare,
  Shield,
  Combine
} from 'lucide-react'

const COLORS = ['#10b981', '#f97316', '#3b82f6', '#a855f7', '#06b6d4']

export function ArenaStats() {
  const { nodes, edges, models, responses } = useArenaStore()

  // Calculate stats
  const modelNodes = nodes.filter(n => n.type === 'model')
  const promptNodes = nodes.filter(n => n.type === 'prompt')
  const validatorNodes = nodes.filter(n => n.type === 'validator')
  const aggregatorNodes = nodes.filter(n => n.type === 'aggregator')

  const enabledModels = models.filter(m => m.enabled)
  const totalConnections = edges.length
  const levels = new Set(models.map(m => m.level)).size

  // Node distribution data
  const nodeDistribution = [
    { name: 'Models', value: modelNodes.length, color: '#10b981' },
    { name: 'Prompts', value: promptNodes.length, color: '#3b82f6' },
    { name: 'Validators', value: validatorNodes.length, color: '#f97316' },
    { name: 'Aggregators', value: aggregatorNodes.length, color: '#a855f7' },
  ]

  // Provider distribution
  const providerDistribution = models.reduce((acc, model) => {
    acc[model.provider] = (acc[model.provider] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const providerData = Object.entries(providerDistribution).map(([provider, count]) => ({
    name: provider.charAt(0).toUpperCase() + provider.slice(1),
    count,
  }))

  // Response metrics (simulated)
  const responseMetrics = responses.filter(r => r.status === 'complete')
  const avgLatency = responseMetrics.length > 0
    ? responseMetrics.reduce((acc, r) => acc + (r.latency || 0), 0) / responseMetrics.length
    : 0
  const avgTokens = responseMetrics.length > 0
    ? responseMetrics.reduce((acc, r) => acc + (r.tokens || 0), 0) / responseMetrics.length
    : 0

  // Performance timeline data (simulated)
  const performanceData = [
    { time: '10:00', latency: 1200, tokens: 450 },
    { time: '10:05', latency: 980, tokens: 520 },
    { time: '10:10', latency: 1450, tokens: 380 },
    { time: '10:15', latency: 1100, tokens: 490 },
    { time: '10:20', latency: 890, tokens: 550 },
    { time: '10:25', latency: 1020, tokens: 470 },
  ]

  // Level distribution
  const levelDistribution = [
    { level: 'Level 1', models: models.filter(m => m.level === 1).length },
    { level: 'Level 2', models: models.filter(m => m.level === 2).length },
    { level: 'Level 3', models: models.filter(m => m.level === 3).length },
  ]

  return (
    <ScrollArea className="flex-1 min-h-0 min-w-0">
      <div className="p-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Total Nodes</p>
                  <p className="text-2xl font-bold text-foreground">{nodes.length}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <GitBranch className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Connections</p>
                  <p className="text-2xl font-bold text-foreground">{totalConnections}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Active Models</p>
                  <p className="text-2xl font-bold text-foreground">{enabledModels.length}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Pipeline Levels</p>
                  <p className="text-2xl font-bold text-foreground">{levels}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Node Distribution */}
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Node Distribution</CardTitle>
              <CardDescription>Breakdown of node types in your pipeline</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={nodeDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {nodeDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Provider Distribution */}
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Models by Provider</CardTitle>
              <CardDescription>Distribution across AI providers</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={providerData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <YAxis 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Performance Timeline */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Performance Timeline</CardTitle>
            <CardDescription>Response latency and token usage over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <YAxis 
                    yAxisId="left"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="latency" 
                    stroke="#f97316" 
                    strokeWidth={2}
                    dot={{ fill: '#f97316' }}
                    name="Latency (ms)"
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="tokens" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6' }}
                    name="Tokens"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Level Distribution and Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Level Distribution */}
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Pipeline Levels</CardTitle>
              <CardDescription>Model distribution across verification levels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {levelDistribution.map((level, index) => (
                <div key={level.level} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{level.level}</span>
                    <span className="text-muted-foreground">{level.models} models</span>
                  </div>
                  <Progress 
                    value={(level.models / Math.max(models.length, 1)) * 100} 
                    className="h-2"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Quick Stats</CardTitle>
              <CardDescription>Pipeline performance metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-orange-400" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Avg Latency</p>
                    <p className="text-xs text-muted-foreground">Response time</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-foreground">
                  {avgLatency > 0 ? `${(avgLatency / 1000).toFixed(2)}s` : '--'}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Avg Tokens</p>
                    <p className="text-xs text-muted-foreground">Per response</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-foreground">
                  {avgTokens > 0 ? Math.round(avgTokens) : '--'}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Success Rate</p>
                    <p className="text-xs text-muted-foreground">Completed responses</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-foreground">
                  {responses.length > 0 
                    ? `${Math.round((responseMetrics.length / responses.length) * 100)}%` 
                    : '--'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Node Type Legend */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Node Types Reference</CardTitle>
            <CardDescription>Available node types and their purposes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10">
                <Bot className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Model</p>
                  <p className="text-xs text-muted-foreground">AI model instance</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Prompt</p>
                  <p className="text-xs text-muted-foreground">Input template</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/10">
                <Shield className="w-5 h-5 text-orange-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Validator</p>
                  <p className="text-xs text-muted-foreground">Quality checker</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-500/10">
                <Combine className="w-5 h-5 text-purple-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Aggregator</p>
                  <p className="text-xs text-muted-foreground">Output combiner</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
