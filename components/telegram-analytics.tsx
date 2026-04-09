'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  MessageSquare,
  Users,
  Clock,
  Zap,
  DollarSign,
  AlertTriangle,
  Camera,
  FileText,
  Mic,
  Terminal,
  RefreshCw,
  Search,
  Send,
  Bot,
  Activity,
  Link,
  Trash,
  CheckCircle,
  XCircle,
} from 'lucide-react'

interface TelegramStats {
  totalUsers: number
  activeUsers24h: number
  totalMessages: number
  messagesByType: { text: number; photo: number; document: number; voice: number; command: number }
  avgResponseTime: number
  totalTokens: number
  totalCost: number
  topCommands: Array<{ command: string; count: number }>
  messagesPerHour: Array<{ hour: number; count: number }>
  errors24h: number
}

interface TelegramUser {
  id: number
  username?: string
  firstName?: string
  lastActive: string
  messageCount: number
  photoCount: number
  documentCount: number
  voiceCount: number
}

export function TelegramAnalytics() {
  const [stats, setStats] = useState<TelegramStats | null>(null)
  const [users, setUsers] = useState<TelegramUser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [webhookStatus, setWebhookStatus] = useState<{ ok: boolean; url?: string; pending?: number } | null>(null)
  const [webhookLoading, setWebhookLoading] = useState(false)

  const checkWebhook = async () => {
    try {
      const res = await fetch('/api/telegram/set-webhook', { method: 'POST' })
      const data = await res.json()
      if (data.webhookInfo) {
        setWebhookStatus({
          ok: data.webhookInfo.url ? true : false,
          url: data.webhookInfo.url,
          pending: data.webhookInfo.pending_update_count,
        })
      }
    } catch (e) {
      console.error('Failed to check webhook:', e)
    }
  }

  const setupWebhook = async () => {
    setWebhookLoading(true)
    try {
      const res = await fetch('/api/telegram/set-webhook', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setWebhookStatus({ ok: true, url: data.webhookUrl })
      }
    } catch (e: any) {
      console.error('Failed to setup webhook:', e)
    } finally {
      setWebhookLoading(false)
    }
  }

  const deleteWebhook = async () => {
    setWebhookLoading(true)
    try {
      const res = await fetch('/api/telegram/set-webhook', { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setWebhookStatus({ ok: false })
      }
    } catch (e: any) {
      console.error('Failed to delete webhook:', e)
    } finally {
      setWebhookLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/telegram/stats')
      const data = await res.json()
      setStats(data.stats)
      setUsers(data.users || [])
    } catch (e) {
      console.error('Failed to fetch Telegram stats:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    checkWebhook()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const filteredUsers = users.filter(u =>
    u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(u.id).includes(searchQuery)
  )

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Webhook Status */}
      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link className="w-4 h-4 text-blue-400" />
              <div>
                <p className="text-xs text-muted-foreground">Webhook Status</p>
                {webhookStatus ? (
                  <div className="flex items-center gap-1">
                    {webhookStatus.ok ? (
                      <CheckCircle className="w-3 h-3 text-green-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-400" />
                    )}
                    <span className="text-xs">{webhookStatus.ok ? 'Active' : 'Not configured'}</span>
                    {webhookStatus.pending !== undefined && (
                      <span className="text-[10px] text-muted-foreground">({webhookStatus.pending} pending)</span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Checking...</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={setupWebhook} disabled={webhookLoading}>
                <Link className="w-3 h-3 mr-1" /> Setup
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={deleteWebhook} disabled={webhookLoading}>
                <Trash className="w-3 h-3 mr-1" /> Delete
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Users</p>
                  <p className="text-lg font-bold">{stats.totalUsers}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {stats.activeUsers24h} active (24h)
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-green-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Messages</p>
                  <p className="text-lg font-bold">{stats.totalMessages}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-yellow-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Avg Response</p>
                  <p className="text-lg font-bold">{formatTime(stats.avgResponseTime)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Tokens</p>
                  <p className="text-lg font-bold">{stats.totalTokens.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Cost</p>
                  <p className="text-lg font-bold">${stats.totalCost.toFixed(4)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Errors</p>
                  <p className="text-lg font-bold">{stats.errors24h}</p>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Last 24h</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="w-full bg-secondary">
          <TabsTrigger value="users" className="flex-1">
            <Users className="w-3 h-3 mr-1" /> Users
          </TabsTrigger>
          <TabsTrigger value="messages" className="flex-1">
            <MessageSquare className="w-3 h-3 mr-1" /> Messages
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users">
          <div className="flex items-center gap-2 mb-4">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by username, name, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>

          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Photos</TableHead>
                  <TableHead>Docs</TableHead>
                  <TableHead>Last Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {user.firstName || 'User'} {user.username ? `@${user.username}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">ID: {user.id}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.messageCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Camera className="w-3 h-3" />
                        {user.photoCount}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {user.documentCount}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(user.lastActive)}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages">
          {stats && (
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-3">
                <Card className="bg-card border-border">
                  <CardContent className="p-3 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">Text</p>
                      <p className="text-lg font-bold">{stats.messagesByType.text}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-3 flex items-center gap-2">
                    <Camera className="w-5 h-5 text-green-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">Photos</p>
                      <p className="text-lg font-bold">{stats.messagesByType.photo}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-3 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-yellow-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">Docs</p>
                      <p className="text-lg font-bold">{stats.messagesByType.document}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-3 flex items-center gap-2">
                    <Mic className="w-5 h-5 text-purple-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">Voice</p>
                      <p className="text-lg font-bold">{stats.messagesByType.voice}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-3 flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-orange-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">Commands</p>
                      <p className="text-lg font-bold">{stats.messagesByType.command}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Messages per hour chart */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Messages per Hour (24h)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-1 h-32">
                    {stats.messagesPerHour.map((hour, i) => {
                      const maxCount = Math.max(...stats.messagesPerHour.map(h => h.count), 1)
                      const height = (hour.count / maxCount) * 100
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-blue-500/20 hover:bg-blue-500/40 rounded-t transition-colors relative group"
                          style={{ height: `${height}%` }}
                        >
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-background border rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                            {hour.count} msgs
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>00:00</span>
                    <span>06:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>23:00</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}