# План внедрения интеграций и автоматизаций (Actions & Triggers)

## Обзор

Расширение системы навыков для поддержки реальных действий (actions) и триггеров (triggers):
- **Actions** — выполнение действий: отправка email, сообщений в Telegram, создание задач в Notion
- **Triggers** — реакция на события: изменения файлов, расписание, webhook'и
- **Chains** — связывание навыков в цепочки с условиями

---

## Архитектура

### 1. Система действий (Actions)

```typescript
// lib/actions/types.ts
interface Action {
  id: string
  name: string
  description: string
  category: 'communication' | 'productivity' | 'monitoring' | 'data'
  inputs: ActionInput[]
  outputs: ActionOutput[]
  config: {
    requiresAuth: boolean
    authType?: 'oauth' | 'api_key' | 'basic'
    rateLimit?: number // requests per minute
  }
  execute: (inputs: Record<string, any>, context: ActionContext) => Promise<ActionResult>
}

interface ActionInput {
  name: string
  type: 'string' | 'number' | 'boolean' | 'file' | 'json'
  required: boolean
  description: string
  default?: any
}

interface ActionResult {
  success: boolean
  data?: any
  error?: string
  metadata?: {
    duration: number
    tokensUsed: number
    cost: number
  }
}
```

### 2. Система триггеров (Triggers)

```typescript
// lib/triggers/types.ts
interface Trigger {
  id: string
  name: string
  description: string
  type: 'schedule' | 'webhook' | 'file_watch' | 'manual'
  config: TriggerConfig
  handler: (event: TriggerEvent) => Promise<void>
}

interface ScheduleTriggerConfig {
  cronExpression: string
  timezone: string
  inputData: Record<string, any>
}

interface FileWatchTriggerConfig {
  paths: string[]
  events: ('create' | 'modify' | 'delete')[]
  debounce: number // ms
}

interface WebhookTriggerConfig {
  path: string
  secret?: string
  allowedIPs?: string[]
}
```

### 3. Цепочки (Chains)

```typescript
// lib/chains/types.ts
interface Chain {
  id: string
  name: string
  description: string
  nodes: ChainNode[]
  edges: ChainEdge[]
  triggers: string[] // trigger IDs
  enabled: boolean
}

interface ChainNode {
  id: string
  type: 'action' | 'agent' | 'condition' | 'delay'
  config: {
    actionId?: string
    agentConfig?: AgentConfig
    condition?: Condition
    delayMs?: number
  }
}

interface ChainEdge {
  source: string
  target: string
  condition?: string // expression for conditional routing
}
```

---

## Реализуемые действия (Actions)

### Communication (Коммуникация)

#### 1. Send Email (Gmail/SMTP)
```typescript
// lib/actions/email.ts
const sendEmailAction: Action = {
  id: 'send-email',
  name: 'Send Email',
  description: 'Отправить email через Gmail или SMTP',
  category: 'communication',
  inputs: [
    { name: 'to', type: 'string', required: true, description: 'Получатель' },
    { name: 'subject', type: 'string', required: true, description: 'Тема' },
    { name: 'body', type: 'string', required: true, description: 'Тело письма' },
    { name: 'cc', type: 'string', required: false, description: 'Копия' },
    { name: 'attachments', type: 'file', required: false, description: 'Вложения' },
  ],
  config: { requiresAuth: true, authType: 'oauth' },
  execute: async (inputs, context) => {
    // Реализация через Nodemailer или Gmail API
  }
}
```

#### 2. Send Telegram Message
```typescript
// lib/actions/telegram.ts
const sendTelegramAction: Action = {
  id: 'send-telegram',
  name: 'Send Telegram Message',
  description: 'Отправить сообщение в Telegram',
  category: 'communication',
  inputs: [
    { name: 'chatId', type: 'string', required: true, description: 'Chat ID или @username' },
    { name: 'message', type: 'string', required: true, description: 'Сообщение' },
    { name: 'parseMode', type: 'string', required: false, description: 'HTML|Markdown', default: 'HTML' },
  ],
  config: { requiresAuth: true, authType: 'api_key' },
  execute: async (inputs, context) => {
    // Используем существующий telegram-store
  }
}
```

#### 3. Send Slack Message
```typescript
// lib/actions/slack.ts
const sendSlackAction: Action = {
  id: 'send-slack',
  name: 'Send Slack Message',
  description: 'Отправить сообщение в Slack канал',
  category: 'communication',
  inputs: [
    { name: 'channel', type: 'string', required: true, description: '#channel или @user' },
    { name: 'text', type: 'string', required: true, description: 'Сообщение' },
    { name: 'blocks', type: 'json', required: false, description: 'Slack blocks' },
  ],
  config: { requiresAuth: true, authType: 'api_key' },
  execute: async (inputs, context) => {
    // Slack Web API
  }
}
```

### Productivity (Продуктивность)

#### 4. Create Notion Page
```typescript
// lib/actions/notion.ts
const createNotionAction: Action = {
  id: 'create-notion-page',
  name: 'Create Notion Page',
  description: 'Создать страницу в Notion',
  category: 'productivity',
  inputs: [
    { name: 'parentPageId', type: 'string', required: true, description: 'ID родительской страницы' },
    { name: 'title', type: 'string', required: true, description: 'Заголовок' },
    { name: 'content', type: 'string', required: false, description: 'Содержимое' },
    { name: 'icon', type: 'string', required: false, description: 'Иконка (emoji)' },
  ],
  config: { requiresAuth: true, authType: 'api_key' },
  execute: async (inputs, context) => {
    // Notion API
  }
}
```

#### 5. Create Trello Card
```typescript
// lib/actions/trello.ts
const createTrelloAction: Action = {
  id: 'create-trello-card',
  name: 'Create Trello Card',
  description: 'Создать карточку в Trello',
  category: 'productivity',
  inputs: [
    { name: 'boardId', type: 'string', required: true, description: 'ID доски' },
    { name: 'listId', type: 'string', required: true, description: 'ID списка' },
    { name: 'name', type: 'string', required: true, description: 'Название' },
    { name: 'description', type: 'string', required: false, description: 'Описание' },
    { name: 'labels', type: 'json', required: false, description: 'Метки' },
  ],
  config: { requiresAuth: true, authType: 'oauth' },
  execute: async (inputs, context) => {
    // Trello API
  }
}
```

#### 6. Create Google Calendar Event
```typescript
// lib/actions/calendar.ts
const createCalendarEventAction: Action = {
  id: 'create-calendar-event',
  name: 'Create Calendar Event',
  description: 'Создать событие в Google Calendar',
  category: 'productivity',
  inputs: [
    { name: 'title', type: 'string', required: true, description: 'Название' },
    { name: 'startTime', type: 'string', required: true, description: 'Начало (ISO)' },
    { name: 'endTime', type: 'string', required: true, description: 'Конец (ISO)' },
    { name: 'description', type: 'string', required: false, description: 'Описание' },
    { name: 'attendees', type: 'json', required: false, description: 'Участники' },
  ],
  config: { requiresAuth: true, authType: 'oauth' },
  execute: async (inputs, context) => {
    // Google Calendar API
  }
}
```

### Monitoring (Мониторинг)

#### 7. Watch File Changes
```typescript
// lib/triggers/file-watch.ts
const fileWatchTrigger: Trigger = {
  id: 'file-watch',
  name: 'Watch File Changes',
  description: 'Реагировать на изменения файлов',
  type: 'file_watch',
  config: {
    paths: ['**/*.md', '**/*.ts'],
    events: ['create', 'modify', 'delete'],
    debounce: 1000,
  },
  handler: async (event) => {
    // Запуск цепочки при изменении файла
  }
}
```

#### 8. Scheduled Trigger
```typescript
// lib/triggers/schedule.ts
const scheduleTrigger: Trigger = {
  id: 'schedule',
  name: 'Scheduled Trigger',
  description: 'Запуск по расписанию',
  type: 'schedule',
  config: {
    cronExpression: '0 9 * * 1-5', // Каждый будний день в 9:00
    timezone: 'Asia/Yekaterinburg',
    inputData: {},
  },
  handler: async (event) => {
    // Запуск цепочки по расписанию
  }
}
```

### Data (Данные)

#### 9. Fetch News/RSS
```typescript
// lib/actions/rss.ts
const fetchRssAction: Action = {
  id: 'fetch-rss',
  name: 'Fetch RSS Feed',
  description: 'Получить новости из RSS ленты',
  category: 'data',
  inputs: [
    { name: 'url', type: 'string', required: true, description: 'URL RSS ленты' },
    { name: 'limit', type: 'number', required: false, description: 'Максимум записей', default: 10 },
    { name: 'filter', type: 'string', required: false, description: 'Фильтр по ключевым словам' },
  ],
  config: { requiresAuth: false },
  execute: async (inputs, context) => {
    // Парсинг RSS
  }
}
```

#### 10. Web Scraping
```typescript
// lib/actions/scrape.ts
const webScrapeAction: Action = {
  id: 'web-scrape',
  name: 'Web Scraping',
  description: 'Спарсить данные с веб-сайта',
  category: 'data',
  inputs: [
    { name: 'url', type: 'string', required: true, description: 'URL для парсинга' },
    { name: 'selectors', type: 'json', required: true, description: 'CSS селекторы' },
    { name: 'waitFor', type: 'string', required: false, description: 'Selector to wait for' },
  ],
  config: { requiresAuth: false },
  execute: async (inputs, context) => {
    // Puppeteer или Cheerio для парсинга
  }
}
```

---

## Примеры цепочек (Chains)

### Пример 1: Daily News Digest → Telegram

```
[Schedule Trigger: 8:00 AM daily]
         ↓
[Fetch RSS: Tech news sources]
         ↓
[Agent: Summarize & filter news]
         ↓
[Send Telegram: Daily digest to user]
```

**Конфигурация:**
```json
{
  "id": "daily-news-digest",
  "name": "Daily Tech News Digest",
  "nodes": [
    {
      "id": "fetch-news",
      "type": "action",
      "config": { "actionId": "fetch-rss", "inputs": { "url": "https://news.ycombinator.com/rss", "limit": 20 } }
    },
    {
      "id": "summarize",
      "type": "agent",
      "config": { "agentConfig": { "role": "summarizer", "modelId": "openai/gpt-3.5-turbo", "maxTokens": 1000 } }
    },
    {
      "id": "send-telegram",
      "type": "action",
      "config": { "actionId": "send-telegram", "inputs": { "chatId": "@username" } }
    }
  ],
  "edges": [
    { "source": "fetch-news", "target": "summarize" },
    { "source": "summarize", "target": "send-telegram" }
  ],
  "triggers": ["schedule-daily-8am"]
}
```

### Пример 2: File Change → Notion Update

```
[File Watch Trigger: docs/*.md]
         ↓
[Agent: Extract key points & action items]
         ↓
[Condition: Has action items?]
    ↓           ↓
  Yes         No
    ↓           ↓
[Create Notion Task]  [Log & exit]
         ↓
[Send Telegram: Notification]
```

### Пример 3: Development Plan → Notion + Calendar

```
[Manual Trigger / Schedule]
         ↓
[Agent: Create daily dev plan based on project context]
         ↓
[Create Notion Page: Daily plan]
         ↓
[Create Calendar Events: Time blocks]
         ↓
[Send Email: Morning briefing]
```

---

## Технологии

### Backend (Next.js API Routes)

| Компонент | Технология |
|-----------|------------|
| Email | Nodemailer + Gmail API |
| Telegram | node-telegram-bot-api (уже есть) |
| Slack | @slack/web-api |
| Notion | @notionhq/client |
| Google Calendar | googleapis |
| Trello | node-trello |
| RSS | rss-parser |
| Web Scraping | puppeteer, cheerio |
| Scheduling | node-cron |
| File Watch | chokidar |
| Queue | Bull (Redis) или in-memory |

### Конфигурация и хранение

| Компонент | Хранение |
|-----------|----------|
| Actions config | JSON files + env vars |
| Credentials | Encrypted in DB or .env |
| Chains | JSON in `/chains` directory |
| Execution history | SQLite or JSON files |
| Triggers state | In-memory + persist to file |

---

## Структура проекта

```
lib/
  actions/
    index.ts          # Registry всех actions
    types.ts          # Типы
    email.ts          # Email action
    telegram.ts       # Telegram action (использовать существующий)
    slack.ts          # Slack action
    notion.ts         # Notion action
    calendar.ts       # Google Calendar
    trello.ts         # Trello
    rss.ts            # RSS fetch
    scrape.ts         # Web scraping
  triggers/
    index.ts          # Registry всех triggers
    types.ts          # Типы
    schedule.ts       # Cron trigger
    file-watch.ts     # File watcher
    webhook.ts        # Webhook handler
  chains/
    index.ts          # Chain executor
    types.ts          # Типы
    executor.ts       # Выполнение цепочек
    conditions.ts     # Condition evaluator
  auth/
    providers.ts      # OAuth providers
    credentials.ts    # Credential management
    encrypt.ts        # Encryption utilities

app/api/
  actions/
    list/route.ts     # GET /api/actions
    execute/route.ts  # POST /api/actions/execute
  triggers/
    list/route.ts     # GET /api/triggers
    webhook/[path]/route.ts  # Dynamic webhook handler
  chains/
    list/route.ts     # GET /api/chains
    execute/route.ts  # POST /api/chains/execute

chains/
  daily-news-digest.json
  file-to-notion.json
  dev-plan.json

components/
  chain-builder.tsx   # Visual chain builder
  action-picker.tsx   # Action selection UI
  trigger-config.tsx  # Trigger configuration
```

---

## План реализации (по этапам)

### Phase 1: Core Framework (1-2 дня)
- [ ] Создать `lib/actions/types.ts` и `lib/triggers/types.ts`
- [ ] Создать registry для actions и triggers
- [ ] Создать базовый executor для chains
- [ ] Добавить API routes для list/execute

### Phase 2: Communication Actions (1 день)
- [ ] Send Email (Gmail/SMTP)
- [ ] Send Telegram (использовать существующий bot)
- [ ] Send Slack

### Phase 3: Productivity Actions (1-2 дня)
- [ ] Create Notion Page
- [ ] Create Trello Card
- [ ] Create Google Calendar Event

### Phase 4: Triggers (1 день)
- [ ] Schedule trigger (cron)
- [ ] File watch trigger
- [ ] Webhook trigger

### Phase 5: Data Actions (1 день)
- [ ] Fetch RSS
- [ ] Web scraping

### Phase 6: UI Components (2-3 дня)
- [ ] Chain builder (visual editor)
- [ ] Action picker
- [ ] Trigger configuration
- [ ] Chain execution monitoring

### Phase 7: Integration & Testing (1-2 дня)
- [ ] Интеграция с AgentsPanel
- [ ] Тестирование end-to-end
- [ ] Документация

---

## Безопасность

1. **Credentials** — шифрование API ключей
2. **Rate limiting** — ограничение запросов к внешним API
3. **Input validation** — валидация всех входных данных
4. **Error handling** — graceful degradation при ошибках
5. **Audit logging** — логирование всех действий

---

## Метрики и мониторинг

- Количество выполненных chains
- Успешность выполнения (success rate)
- Время выполнения (latency)
- Использование токенов
- Стоимость (cost tracking)

---

## Будущие расширения

1. **Conditional branching** — сложные условия в цепочках
2. **Parallel execution** — параллельное выполнение узлов
3. **Error recovery** — retry logic и fallbacks
4. **Webhook responses** — ответ на webhook с данными
5. **Custom actions** — пользовательские actions через JavaScript
6. **Action marketplace** — сообщество для обмена actions