# LLM Arena (AI Aggregator App)

Web app for multi-model chat and configurable DAG pipelines ("Arena") powered by OpenRouter.

- Multi-model chat: send one prompt to multiple models and compare results.
- Arena pipelines: build a directed acyclic graph (DAG) of nodes (prompt/model/validator/aggregator/search/file/router) and execute it.
- Analytics: track token usage and estimated cost.

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

- **Chat** — multi-model chat.
- **Arena** — pipeline designer/executor.
- **Analytics** — usage and cost dashboard.

### Data model overview

Main domain state lives in `lib/store.ts` (Zustand + persist).

- **Models**: list of available LLMs with settings (temperature, maxTokens, pricing, webSearch).
- **Arena graph**: `nodes` + `edges`.
- **Configs**: saved pipeline presets.
- **Chat**: `messages` + `responses` and `historicalChats`.
- **Usage**: `globalUsage`, `usageHistory`, `sessionCost`, `maxSessionBudget`.
- **Knowledge Base**: list of file paths to inject into prompts.

## Arena: pipelines (DAG)

A pipeline is a DAG defined by:

- Nodes: `ArenaNode[]`
- Edges: `ArenaEdge[]`

Execution is performed by `lib/executor.ts::executePipeline()`.

### Node types

Node type is `ArenaNode.type`:

- `prompt`
  - Produces a text output via a template.
  - Supports placeholders:
    - `{{input}}` / `{{context}}` — upstream context
    - `{{global}}` — injected Knowledge Base content
  - If you forget `{{input}}`/`{{context}}`, the executor auto-appends `{{input}}`.

- `model`
  - Calls `/api/chat` to stream an LLM answer.
  - Input comes from upstream nodes (or initial pipeline input).
  - Token count is computed (prompt vs completion) and cost is estimated.

- `validator`
  - Calls an LLM to validate/summarize/score multiple upstream outputs.
  - Built-in modes:
    - `consensus`
    - `scoring`
    - `custom` (uses node prompt)

- `aggregator`
  - Calls an LLM to merge upstream outputs into a single final answer.

- `search`
  - Calls `/api/search` to get web results.

- `file`
  - Reads file content via `/api/files`.

- `router`
  - Runs an LLM classifier and activates only the matched outgoing path.
  - Unmatched downstream nodes are marked `skipped`.

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
  - Supports tool-based web search (when enabled) by detecting tool calls and performing server-side search.

- `GET /api/models`
  - Fetches the OpenRouter models list and maps it to the app `Model` type.

- `GET /api/files`
  - Returns a file tree of the current workspace (excluding some directories).

- `POST /api/files`
  - Reads a specific file by relative path.

- `POST /api/search`
  - Runs DuckDuckGo Lite search and returns formatted results.

## Analytics: tokens and cost

- Token counting uses `lib/tokenizer.ts` (`js-tiktoken`) when possible.
- Cost estimation:
  - Prefers model pricing returned from OpenRouter (`/api/models`) or from your configured `Model.pricing`.
  - Falls back to a heuristic if pricing is missing.

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
- The `POST /api/files` endpoint can read **any file within the project root**, which may include secrets (for example `.env`).
  - This is fine for local development, but **unsafe for public deployments**.
  - If you deploy publicly, you should restrict `/api/files` (auth + allowlist paths) or remove it.

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
