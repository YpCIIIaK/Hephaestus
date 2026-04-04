import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const STORE_FILE = path.join(DATA_DIR, 'telegram-store.json')

export interface TelegramUser {
  id: number
  username?: string
  firstName?: string
  lastName?: string
  firstSeen: string
  lastActive: string
  messageCount: number
  photoCount: number
  documentCount: number
  voiceCount: number
}

export interface TelegramMessage {
  userId: number
  type: string
  timestamp: string
  responseTime?: number
  tokens?: number
  cost?: number
  status: string
}

export interface TelegramStore {
  users: Record<number, TelegramUser>
  messages: TelegramMessage[]
}

let store: TelegramStore | null = null

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
  }
}

async function ensureStoreFile() {
  await ensureDataDir()
  try {
    await fs.access(STORE_FILE)
  } catch {
    await fs.writeFile(STORE_FILE, JSON.stringify({ users: {}, messages: [] }, null, 2))
  }
}

async function loadStore(): Promise<TelegramStore> {
  if (store) return store
  
  await ensureStoreFile()
  
  try {
    const data = await fs.readFile(STORE_FILE, 'utf-8')
    store = JSON.parse(data)
    return store as TelegramStore
  } catch {
    store = { users: {}, messages: [] }
    return store as TelegramStore
  }
}

async function saveStore() {
  if (!store) return
  
  await ensureStoreFile()
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2))
}

export async function addUser(user: Partial<TelegramUser> & { id: number }): Promise<TelegramUser> {
  const data = await loadStore()
  
  const existing = data.users[user.id]
  if (existing) {
    existing.lastActive = new Date().toISOString()
    if (user.username) existing.username = user.username
    if (user.firstName) existing.firstName = user.firstName
    await saveStore()
    return existing
  }

  const newUser: TelegramUser = {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    firstSeen: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    messageCount: 0,
    photoCount: 0,
    documentCount: 0,
    voiceCount: 0,
  }

  data.users[user.id] = newUser
  await saveStore()
  return newUser
}

export async function addMessage(msg: TelegramMessage) {
  const data = await loadStore()
  
  data.messages.push(msg)
  
  // Keep only last 10000 messages
  if (data.messages.length > 10000) {
    data.messages = data.messages.slice(-10000)
  }
  
  const user = data.users[msg.userId]
  if (user) {
    user.messageCount++
    if (msg.type === 'photo') user.photoCount++
    if (msg.type === 'document') user.documentCount++
    if (msg.type === 'voice') user.voiceCount++
  }
  
  await saveStore()
}

export async function getStats() {
  const data = await loadStore()
  
  const now = Date.now()
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000
  
  const users = Object.values(data.users)
  const messages = data.messages
  
  const activeUsers = users.filter(
    u => new Date(u.lastActive).getTime() > twentyFourHoursAgo
  ).length
  
  const recentMessages = messages.filter(
    m => new Date(m.timestamp).getTime() > twentyFourHoursAgo
  )
  
  const messagesByType = {
    text: messages.filter(m => m.type === 'text').length,
    photo: messages.filter(m => m.type === 'photo').length,
    document: messages.filter(m => m.type === 'document').length,
    voice: messages.filter(m => m.type === 'voice').length,
    command: messages.filter(m => m.type === 'command').length,
  }
  
  const messagesWithResponseTime = messages.filter(m => m.responseTime !== undefined)
  const avgResponseTime = messagesWithResponseTime.length > 0
    ? messagesWithResponseTime.reduce((sum, m) => sum + (m.responseTime || 0), 0) / messagesWithResponseTime.length
    : 0
  
  const totalTokens = messages.reduce((sum, m) => sum + (m.tokens || 0), 0)
  const totalCost = messages.reduce((sum, m) => sum + (m.cost || 0), 0)
  const errors24h = recentMessages.filter(m => m.status === 'error').length
  
  // Messages per hour (last 24h)
  const messagesPerHour = Array.from({ length: 24 }, (_, i) => {
    const hourStart = now - (23 - i) * 60 * 60 * 1000
    const hourEnd = hourStart + 60 * 60 * 1000
    const count = messages.filter(m => {
      const t = new Date(m.timestamp).getTime()
      return t >= hourStart && t < hourEnd
    }).length
    return { hour: i, count }
  })
  
  // Top commands
  const commandCounts = new Map<string, number>()
  messages.filter(m => m.type === 'command').forEach(m => {
    commandCounts.set('command', (commandCounts.get('command') || 0) + 1)
  })
  
  return {
    stats: {
      totalUsers: users.length,
      activeUsers24h: activeUsers,
      totalMessages: messages.length,
      messagesByType,
      avgResponseTime: Math.round(avgResponseTime),
      totalTokens,
      totalCost,
      topCommands: Array.from(commandCounts.entries()).map(([command, count]) => ({ command, count })),
      messagesPerHour,
      errors24h,
    },
    users: users,
  }
}