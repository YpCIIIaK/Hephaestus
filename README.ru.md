# Hephaestus (Ἥφαιστος) - LLM Arena

Веб-приложение для многомодельного чата и настраиваемых DAG-пайплайнов ("Arena") на базе OpenRouter.

- **Многомодельный чат**: отправь один промпт нескольким моделям и сравни результаты.
- **Arena-пайплайны**: строй направленный ациклический граф (DAG) из узлов (prompt/model/validator/aggregator/search/file/router/code) и запускай его.
- **Аналитика**: отслеживай использование токенов, оценочную стоимость и Waterfall диаграммы.
- **AI File Editing**: ИИ может создавать, редактировать и удалять файлы через чат и пайплайны.
- **Smart Fallback Chain**: автоматический fallback на резервные модели при timeout/error.
- **RAG Knowledge Base**: BM25-поиск по индексированным файлам проекта.

## Технологический стек

- Next.js 16 (App Router)
- React 19
- TypeScript
- Zustand (persisted store)
- Tailwind CSS + Radix UI (компоненты в стиле shadcn)
- OpenRouter API (chat completions + models)
- DuckDuckGo Lite (веб-поиск через скрейпинг)

## Структура проекта

- `app/`
  - `page.tsx` — главная оболочка UI (Sidebar + вкладки)
  - `api/` — серверные роуты
    - `chat/route.ts` — прокси стриминга OpenRouter (+ обработка web-search tool)
    - `models/route.ts` — получение списка моделей OpenRouter + маппинг pricing
    - `files/route.ts` — чтение/листинг локальных файлов рабочей области (используется File-узлами и KB)
    - `search/route.ts` — эндпоинт веб-поиска (DuckDuckGo Lite)
- `components/` — UI-компоненты
  - `chat-panel.tsx` — интерфейс чата (многомодельный + pipeline-в-чате)
  - `arena-panel.tsx` — конструктор пайплайнов и UI запуска
  - `sidebar.tsx` — навигация, настройки, контроль бюджета
- `lib/`
  - `store.ts` — Zustand-стор: модели, узлы/рёбра, конфиги, история чатов, usage/cost, KB
  - `executor.ts` — движок выполнения DAG
  - `types.ts` — основные типы
  - `search-utils.ts` — fetch DDG Lite + fallback-парсинг HTML
  - `tokenizer.ts` — подсчёт токенов через `js-tiktoken`

## Требования

- Node.js 18+ рекомендуется
- pnpm (рекомендуется) или npm/yarn

## Установка и запуск

1. Установи зависимости:

   ```bash
   pnpm install
   ```

2. Создай `.env` в корне проекта:

   ```dotenv
   OPENROUTER_API_KEY=YOUR_KEY_HERE
   ```

3. Запусти dev-сервер:

   ```bash
   pnpm dev
   ```

4. Открой:

   - http://localhost:3000

### Скрипты

- `pnpm dev` — запуск dev-сервера Next.js
- `pnpm build` — production-сборка
- `pnpm start` — запуск production-сервера
- `pnpm lint` — линтинг

## Основные концепции

### Вкладки

- **Chat** — многомодельный чат с AI File Editing (list/read/write/edit/delete файлов).
- **Arena** — конструктор/исполнитель пайплайнов с Dry Run.
- **Analytics** — дашборд использования, стоимости, Waterfall диаграммы и экспорт PDF/CSV.

### Обзор модели данных

Основное доменное состояние живёт в `lib/store.ts` (Zustand + persist).

- **Models**: список доступных LLM с настройками (temperature, maxTokens, pricing, webSearch, **fallbackModels**, **fallbackTimeoutMs**, **fallbackMode**, **contextCompression**).
- **Arena graph**: `nodes` + `edges`.
- **Configs**: сохранённые пресеты пайплайнов.
- **Chat**: `messages` + `responses` и `historicalChats`.
- **Usage**: `globalUsage`, `usageHistory`, `sessionCost`, `maxSessionBudget`.
- **Knowledge Base**: список путей к файлам + **BM25 RAG индекс** с чанкингом.

## Arena: пайплайны (DAG)

Пайплайн — это DAG, определяемый:

- Узлы: `ArenaNode[]`
- Рёбра: `ArenaEdge[]`

Выполнение производится через `lib/executor.ts::executePipeline()`.

### Типы узлов

Тип узла — `ArenaNode.type`:

- `prompt`
  - Производит текстовый вывод через шаблон.
  - Поддерживает плейсхолдеры: `{{input}}`, `{{context}}`, `{{global}}`.

- `model`
  - Вызывает `/api/chat` для стриминга ответа LLM.
  - **Context Compression**: автоматическое сжатие длинных контекстов.
  - **Smart Fallback Chain**: fallback на резервные модели при timeout/error.

- `validator` — валидация/саммари/оценка upstream-выходов (consensus/scoring/custom).

- `aggregator` — объединение upstream-выходов в единый финальный ответ.

- `search` — веб-поиск через DuckDuckGo.

- `file`
  - Чтение файлов, **Smart Read** для больших файлов.
  - **Global Knowledge**: инжектит файл в контекст всех AI-узлов.

- `router` — LLM-классификатор с активацией одного из исходящих путей.

- `code`
  - **Создание/редактирование/удаление файлов** через `/api/files/edit`.
  - Может использовать AI для генерации кода.
  - Операции: `write`, `edit`, `append`, `delete`.

### Топология и параллелизм

- Executor запускает узлы слоями на основе in-degree (топологическая прогрессия).
- Узлы одного слоя могут выполняться параллельно.
- Параллельные узлы слегка разносятся во времени (`idx * 300ms`) для снижения immediate rate-limits.

### Таймауты и ретраи

- У каждого узла жёсткий таймаут: **5 минут**.
- Вызовы LLM используют retry-обёртку, которая ретраит при `429` с экспоненциальным backoff.

### Холостой запуск (Dry run)

UI Arena предлагает **Dry Run (Preview Prompts)**.

- Нет внешних API-вызовов.
- Полезно для инспекции точного промпта/контекста, отправляемого моделям/валидаторам/роутерам/агрегаторам.

## База знаний (Global Knowledge)

Пайплайн может инжектить содержимое локальных файлов в контекст AI-узлов.

Как это работает:

1. Пометь любой `file`-узел как **Global** (или добавь файлы вручную через UI Knowledge Base).
2. Executor обнаруживает уникальные KB-пути (глобальные file-узлы + ручной список).
3. Для каждого пути executor загружает контент через `/api/files` и конкатенирует его.
4. Для AI-узлов:
   - Если промпт узла **не** содержит `{{global}}`, executor автоматически добавляет KB-контент в начало.

## API-роуты

Все роуты живут в `app/api/*`.

- `POST /api/chat`
  - Проксирует стриминг OpenRouter Chat Completions.
  - **Tools**: web_search, list_files, read_file, write_file, edit_file, delete_file.
  - **Multi-step tool chains**: рекурсивная обработка цепочек инструментов.

- `GET /api/models` — список моделей OpenRouter.

- `GET /api/files` — дерево файлов проекта.

- `POST /api/files` — чтение конкретного файла.

- `PATCH /api/files/edit` — редактирование файлов (write/edit/append/delete) с бэкапами.

- `POST /api/search` — веб-поиск DuckDuckGo Lite.

- `POST /api/knowledge/search` — **BM25 RAG поиск** по индексированным файлам.

- `PUT /api/knowledge/index` — индексация файла для RAG.

- `GET /api/knowledge/stats` — статистика RAG индекса.

## AI File Editing & Tools

ИИ в чате может использовать инструменты:

- `list_files` — список файлов проекта.
- `read_file` — чтение файла.
- `write_file` — создание/перезапись файла.
- `edit_file` — редактирование (str_replace).
- `delete_file` — удаление файла.
- `web_search` — веб-поиск.

### Multi-step Tool Chains

ИИ может выполнять цепочки: `list_files → delete_file(file1) → write_file(new)` — всё в одном запросе.

## Smart Fallback Chain

Model узлы поддерживают цепочку fallback:

- `fallbackModels`: резервные модели.
- `fallbackTimeoutMs`: таймаут перед fallback.
- `fallbackMode`: `'timeout'` (по времени) или `'on_error'` (только при ошибке).

## Context Compression

Автоматическое сжатие длинных контекстов в model узлах:

- `enabled`: включить.
- `thresholdTokens`: порог (default: 1000).
- `targetRatio`: целевое сжатие 0.0-1.0.

## База знаний (RAG)

- **BM25 поиск** по индексированным файлам.
- **Smart Read**: выборочное чтение для больших файлов.
- **Global Knowledge**: автоматический инжект в промпты.

## Аналитика и экспорт

- **Waterfall/Gantt**: визуализация выполнения пайплайна.
- **Экспорт**: PDF и CSV отчёты.
- **Метрики**: prompt/completion токены, стоимость, latency.

## Решение проблем

### `OPENROUTER_API_KEY is missing`

- Убедись, что `.env` существует в корне проекта и содержит `OPENROUTER_API_KEY`.
- Перезапусти dev-сервер после редактирования `.env`.

### Rate limits (429)

- Executor ретраит с backoff, но тяжёлые параллельные пайплайны всё равно могут упираться в лимиты.
- Уменьши количество параллельных узлов или упрости граф.

### Ошибки веб-поиска

- DuckDuckGo Lite иногда блокирует/меняет разметку.
- Если поиск возвращает `[Search failed: ...]` или `[Search Engine Error: ...]`, отключи `webSearch` для модели или полагайся на ответы без веба.

## Замечания по безопасности (важно)

- **Никогда не комить `.env`**. Твой ключ OpenRouter должен быть секретом.
- Эндпоинты `/api/files` и `/api/files/edit` могут читать и изменять **любой файл внутри корня проекта**.
- Это нормально для локальной разработки, но **небезопасно для публичных деплоев**.
- Для продакшена: добавь auth + allowlist путей.

## Идеи для развития

- Auth + per-user storage
- Жёсткий allowlist для чтения файлов (KB)
- Точнее считать стоимость через provider usage fields (когда доступно)
- Экспорт/шеринг пресетов пайплайнов
