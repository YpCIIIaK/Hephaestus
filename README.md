# Hephaestus (Ἥφαιστος) - LLM Arena

Web app for multi-model chat and configurable DAG pipelines ("Arena") powered by OpenRouter.

- Multi-model chat: send one prompt to multiple models and compare results.
- Arena pipelines: build a directed acyclic graph (DAG) of nodes (prompt/model/validator/aggregator/search/file/router/code) and execute it.
- Analytics: track token usage, estimated cost, and visualize with Waterfall/Gantt charts.
- AI File Editing: AI can create, edit, and delete files via chat and pipelines.
- Smart Fallback Chain: automatic fallback to backup models on timeout/error.
- RAG Knowledge Base: BM25 search across indexed project files.

## Tech stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Zustand (persisted store)
- Tailwind CSS + Radix UI (shadcn-style components)
- OpenRouter API (chat completions + models)
- DuckDuckGo Lite (web search scraping)

## Project structure

- `app/`
  - `page.tsx` — main UI shell (Sidebar + tabs)
  - `api/` — server routes
    - `chat/route.ts` — OpenRouter streaming proxy (+ web-search tool handling)
    - `models/route.ts` — fetch OpenRouter model list + pricing mapping
    - `files/route.ts` — list/read local workspace files (used by File nodes + KB)
    - `search/route.ts` — web search endpoint (DuckDuckGo Lite)
- `components/` — UI components
  - `chat-panel.tsx` — chat experience (multi-model + pipeline-in-chat)
  - `arena-panel.tsx` — pipeline designer and pipeline execution UI
  - `sidebar.tsx` — navigation, settings, budget controls
- `lib/`
  - `store.ts` — Zustand store: models, nodes/edges, configs, chat history, usage/cost, KB
  - `executor.ts` — DAG execution engine
  - `types.ts` — core types
  - `search-utils.ts` — DDG Lite HTML fetch + parsing fallbacks
  - `tokenizer.ts` — token estimation via `js-tiktoken`

## Requirements

- Node.js 18+ recommended
- pnpm (recommended) or npm/yarn

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create `.env` in project root:

   ```dotenv
   OPENROUTER_API_KEY=YOUR_KEY_HERE
   ```

3. Run the dev server:

   ```bash
   pnpm dev
   ```

4. Open:

- http://localhost:3000

### Scripts

- `pnpm dev` — run Next dev server
- `pnpm build` — production build
- `pnpm start` — start production server
- `pnpm lint` — lint

## Core concepts

### Tabs

- **Chat** — multi-model chat with AI File Editing (list/read/write/edit/delete files).
- **Arena** — pipeline designer/executor with Dry Run.
- **Analytics** — usage dashboard with Waterfall/Gantt charts and PDF/CSV export.

### Data model overview

Main domain state lives in `lib/store.ts` (Zustand + persist).

- **Models**: list of available LLMs with settings (temperature, maxTokens, pricing, webSearch, **fallbackModels**, **fallbackTimeoutMs**, **fallbackMode**, **contextCompression**).
- **Arena graph**: `nodes` + `edges`.
- **Configs**: saved pipeline presets.
- **Chat**: `messages` + `responses` and `historicalChats`.
- **Usage**: `globalUsage`, `usageHistory`, `sessionCost`, `maxSessionBudget`.
- **Knowledge Base**: list of file paths to inject into prompts + **BM25 RAG index** with chunking.

## Arena: pipelines (DAG)

A pipeline is a DAG defined by:

- Nodes: `ArenaNode[]`
- Edges: `ArenaEdge[]`

Execution is performed by `lib/executor.ts::executePipeline()`.

### Node types

Node type is `ArenaNode.type`:

- `prompt`
  - Produces a text output via a template.
  - Supports placeholders: `{{input}}`, `{{context}}`, `{{global}}`.

- `model`
  - Calls `/api/chat` to stream an LLM answer.
  - **Context Compression**: automatic compression of long contexts.
  - **Smart Fallback Chain**: fallback to backup models on timeout/error.

- `validator` — validation/summary/scoring of upstream outputs (consensus/scoring/custom).

- `aggregator` — merge upstream outputs into a single final answer.

- `search` — web search via DuckDuckGo.

- `file`
  - File reading, **Smart Read** for large files.
  - **Global Knowledge**: injects file into context of all AI nodes.

- `router` — LLM classifier that activates only the matched outgoing path.

- `code`
  - **Create/edit/delete files** via `/api/files/edit`.
  - Can use AI for code generation.
  - Operations: `write`, `edit`, `append`, `delete`.

### Topology and parallelism

- The executor runs nodes in layers based on in-degree (topological progression).
- Nodes in the same layer can execute in parallel.
- Parallel nodes are staggered slightly (`idx * 300ms`) to reduce immediate rate-limits.

### Timeouts and retries

- Each node has a hard timeout: **5 minutes**.
- LLM calls use a retry wrapper that retries on `429` with exponential backoff.

### Dry run

Arena UI offers **Dry Run (Preview Prompts)**.

- No external API calls.
- Useful to inspect the exact prompt/context being sent to models/validators/routers/aggregators.

## Knowledge Base (Global Knowledge)

The pipeline can inject content of local files into the context of AI nodes.

How it works:

1. Mark any `file` node as **Global** (or add files manually in Knowledge Base UI).
2. Executor discovers unique KB paths (global file nodes + manual list).
3. For each path, executor loads content through `/api/files` and concatenates it.
4. For AI nodes:
   - If node prompt does **not** include `{{global}}`, executor prepends the KB content automatically.

## API routes

All routes live in `app/api/*`.

- `POST /api/chat`
  - Proxies OpenRouter streaming Chat Completions.
  - **Tools**: web_search, list_files, read_file, write_file, edit_file, delete_file.
  - **Multi-step tool chains**: recursive processing of tool chains.

- `GET /api/models` — fetch OpenRouter models.

- `GET /api/files` — file tree of project.

- `POST /api/files` — read specific file.

- `PATCH /api/files/edit` — file editing (write/edit/append/delete) with backups.

- `POST /api/search` — DuckDuckGo Lite web search.

- `POST /api/knowledge/search` — **BM25 RAG search** over indexed files.

- `PUT /api/knowledge/index` — index file for RAG.

- `GET /api/knowledge/stats` — RAG index statistics.

## AI File Editing & Tools

AI in chat can use tools:

- `list_files` — list project files.
- `read_file` — read file.
- `write_file` — create/overwrite file.
- `edit_file` — edit (str_replace).
- `delete_file` — delete file.
- `web_search` — web search.

### Multi-step Tool Chains

AI can execute chains: `list_files → delete_file(file1) → write_file(new)` — all in one request.

## Smart Fallback Chain

Model nodes support fallback chain:

- `fallbackModels`: backup model IDs.
- `fallbackTimeoutMs`: timeout before fallback (default: 5000ms).
- `fallbackMode`: `'timeout'` (time-based) or `'on_error'` (only on error).

## Context Compression

Automatic compression of long contexts in model nodes:

- `enabled`: enable compression.
- `thresholdTokens`: threshold (default: 1000).
- `targetRatio`: target compression 0.0-1.0.

## Knowledge Base (RAG)

- **BM25 search** over indexed files.
- **Smart Read**: selective reading for large files.
- **Global Knowledge**: automatic inject into prompts.

## Analytics & Export

- **Waterfall/Gantt**: pipeline execution visualization.
- **Export**: PDF and CSV reports.
- **Metrics**: prompt/completion tokens, cost, latency.

## Troubleshooting

### `OPENROUTER_API_KEY is missing`

- Ensure `.env` exists in project root and contains `OPENROUTER_API_KEY`.
- Restart dev server after editing `.env`.

### Rate limits (429)

- The executor retries with backoff, but heavy parallel pipelines can still hit limits.
- Reduce parallel nodes or set stagger/limits by simplifying the graph.

### Web search failures

- DuckDuckGo Lite sometimes blocks/changes markup.
- If search results return `[Search failed: ...]` or `[Search Engine Error: ...]`, disable `webSearch` for the model or rely on non-web answers.

## Security notes (important)

- **Never commit `.env`**. Your OpenRouter key must be treated as a secret.
- The `/api/files` and `/api/files/edit` endpoints can read and modify **any file within the project root**.
- This is fine for local development, but **unsafe for public deployments**.
- For production: add auth + path allowlist.

## Roadmap ideas

- Auth + per-user storage
- Hard allowlist for file reading (KB)
- Better cost accuracy by consuming provider usage fields (when available)
- Export/share pipeline presets

---

If you want, I can also:

- add a `README` section for deployment (Vercel/Node server)
- harden `/api/files` and remove secrets exposure
- add a sample pipeline JSON and recommended node patterns
