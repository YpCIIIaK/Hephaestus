# Hephaestus (Ἥφαιστος) — Multi-Agent LLM Arena

Web app for multi-model chat, configurable DAG pipelines ("Arena"), and **event simulation** powered by OpenRouter + **Ollama local models**.

## Features

- **Multi-model chat**: send one prompt to multiple models and compare results.
- **Arena pipelines**: build a directed acyclic graph (DAG) of nodes and execute it.
- **Multi-Agent System**: specialized agents (classifier, analyst, researcher, synthesizer, summarizer) with pre-configured presets.
- **Event Simulation**: simulate political, economic, military, and technology events with cross-domain analysis.
- **Ollama Local Support**: run free local models (Llama, Phi, Qwen) — 100% private, no API costs.
- **Token Optimization**: context compression, RAG, smart file reading — up to 80% token savings.
- **Analytics**: track token usage, estimated cost, and visualize with Waterfall/Gantt charts.
- **AI File Editing**: AI can create, edit, and delete files via chat and pipelines.
- **Smart Fallback Chain**: automatic fallback to backup models on timeout/error.
- **RAG Knowledge Base**: BM25 search across indexed project files with adjacent chunk inclusion.
- **Telegram Bot**: interact with AI via Telegram — send text, photos, documents, voice messages.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Zustand (persisted store)
- Tailwind CSS + Radix UI (shadcn-style components)
- OpenRouter API (chat completions + models)
- **Ollama** (local model inference)
- DuckDuckGo Lite (web search scraping)

## Project Structure

- `app/`
  - `page.tsx` — main UI shell (Sidebar + tabs)
  - `api/` — server routes
    - `chat/route.ts` — OpenRouter + **Ollama** streaming proxy
    - `models/route.ts` — fetch OpenRouter model list + pricing mapping
    - `files/route.ts` — list/read local workspace files
    - `search/route.ts` — web search endpoint (DuckDuckGo Lite)
- `components/` — UI components
  - `chat-panel.tsx` — chat experience (multi-model + pipeline-in-chat)
  - `arena-panel.tsx` — pipeline designer and pipeline execution UI
  - `node-settings.tsx` — node configuration with **agent presets**
  - `sidebar.tsx` — navigation, settings, budget controls
- `lib/`
  - `store.ts` — Zustand store: models, nodes/edges, configs, chat history, usage/cost, KB
  - `executor.ts` — DAG execution engine with **specialized agent nodes**
  - `agent-config.ts` — **pre-configured agent presets (19 cloud + 5 Ollama)**
  - `types.ts` — core types with **5 new node types**
  - `search-utils.ts` — DDG Lite HTML fetch + parsing fallbacks
  - `tokenizer.ts` — token estimation via `js-tiktoken`
  - `text-splitter.ts` — text chunking for RAG
  - `simple-vector-store.ts` — BM25-based vector store with **adjacent chunk inclusion**

## Requirements

- Node.js 18+ recommended
- pnpm (recommended) or npm/yarn
- **Ollama** (optional, for local models): https://ollama.ai

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create `.env` in project root:

   ```dotenv
   OPENROUTER_API_KEY=YOUR_KEY_HERE
   OLLAMA_BASE_URL=http://localhost:11434  # optional, default
   ```

3. (Optional) Install Ollama and pull local models:

   ```bash
   curl -fsSL https://ollama.com/install | sh
   ollama pull llama3.1:8b      # Analyst (~4.7GB)
   ollama pull phi4:latest      # Classifier/Summarizer (~3GB)
   ollama pull qwen2.5:14b      # Researcher (~9GB)
   ollama pull llama3.1:70b     # Synthesizer (~43GB)
   ```

4. Run the dev server:

   ```bash
   pnpm dev
   ```

5. Open: http://localhost:3000

### Scripts

- `pnpm dev` — run Next dev server
- `pnpm build` — production build
- `pnpm start` — start production server
- `pnpm lint` — lint

## Core Concepts

### Tabs

- **Chat** — multi-model chat with AI File Editing.
- **Arena** — pipeline designer/executor with Dry Run.
- **Analytics** — usage dashboard with Waterfall/Gantt charts and PDF/CSV export.

### Data Model Overview

Main domain state lives in `lib/store.ts` (Zustand + persist).

- **Models**: list of available LLMs with settings.
- **Arena graph**: `nodes` + `edges`.
- **Agent Presets**: pre-configured specialized agents in `lib/agent-config.ts`.
- **Configs**: saved pipeline presets.
- **Chat**: `messages` + `responses` and `historicalChats`.
- **Usage**: `globalUsage`, `usageHistory`, `sessionCost`, `maxSessionBudget`.
- **Knowledge Base**: list of file paths + **BM25 RAG index** with chunking.

## Multi-Agent System

### Specialized Agent Nodes

Five new node types, each optimized for a specific role:

| Node Type | Role | Default Model | Max Tokens | Cost |
|-----------|------|---------------|------------|------|
| **Classifier** | Categorize input (political/economic/military/risk) | Gemma 2B (free) | 20-50 | $0 |
| **Analyst** | Structured analysis with findings and risks | Llama 3.1 8B (free) | 800 | $0 |
| **Researcher** | Deep analysis with historical context | Qwen 235B | 2000 | Low |
| **Synthesizer** | Combine multi-agent analysis into final report | Claude Opus | 3000 | Premium |
| **Summarizer** | Condense to key bullet points | Gemma 9B (free) | 300 | $0 |

### Agent Presets

19 pre-configured presets in `lib/agent-config.ts`:

- **4 Classifiers**: political, economic, military, risk level
- **2 Routers**: by domain, by urgency
- **4 Analysts**: political, economic, military, technology
- **2 Researchers**: political, economic
- **2 Synthesizers**: strategic (Claude Opus), brief (Claude Sonnet)
- **1 Validator**: fact-checker
- **1 Summarizer**: executive summary
- **5 Ollama Local**: free local models for all roles

### Event Simulation Pipeline

```
[INPUT EVENT]
     ↓
[ROUTERS] — classify domain (political/economic/military/tech)
     ↓
     ├──────→ [Political Analyst] ──┐
     ├──────→ [Economic Analyst] ──┤
     ├──────→ [Military Analyst] ───┼── [VALIDATOR]
     └──────→ [Tech Analyst] ──────┤          ↓
                                  └──── [SYNTHESIZER] → FINAL REPORT
```

## Arena: Pipelines (DAG)

A pipeline is a DAG defined by:

- Nodes: `ArenaNode[]`
- Edges: `ArenaEdge[]`

Execution is performed by `lib/executor.ts::executePipeline()`.

### Node Types

Node type is `ArenaNode.type`:

- `prompt` — produces text output via template. Supports `{{input}}`, `{{context}}`, `{{global}}`.
- `model` — calls `/api/chat` to stream LLM answer.
- `validator` — validation/summary/scoring of upstream outputs.
- `aggregator` — merge upstream outputs into single final answer.
- `search` — web search via DuckDuckGo.
- `file` — file reading with **Smart Read** for large files.
- `router` — LLM classifier that activates only the matched outgoing path.
- `code` — create/edit/delete files via `/api/files/edit`.
- **`classifier`** — fast categorization (20-50 tokens, strict output).
- **`analyst`** — structured analysis with findings and recommendations.
- **`researcher`** — deep analysis with historical context and scenarios.
- **`synthesizer`** — combine multi-agent analysis into strategic report.
- **`summarizer`** — condense to key bullet points.

### Topology and Parallelism

- The executor runs nodes in layers based on in-degree (topological progression).
- Nodes in the same layer can execute in parallel.
- Parallel nodes are staggered slightly (`idx * 300ms`) to reduce rate-limits.

### Timeouts and Retries

- Each node has a hard timeout: **5 minutes**.
- LLM calls use a retry wrapper that retries on `429` with exponential backoff.

### Dry Run

Arena UI offers **Dry Run (Preview Prompts)** — no external API calls, useful to inspect exact prompts.

## Telegram Bot

Interact with your AI assistant directly through Telegram — no need to open a browser.

### Setup

1. **Create a bot** via [@BotFather](https://t.me/BotFather) on Telegram:
   ```
   /newbot
   # Follow instructions, get a token like: 123456789:ABCdef...
   ```

2. **Add token to `.env`**:
   ```dotenv
   TELEGRAM_BOT_TOKEN=123456789:ABCdef...
   NEXT_PUBLIC_APP_URL=https://your-domain.com  # your deployed URL
   ```

3. **Set webhook** (after deployment):
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-domain.com/api/telegram/webhook"
   ```

4. **Test it**: Send `/start` to your bot on Telegram.

### Supported Content

| Type | Description |
|------|-------------|
| 📝 **Text** | AI chat with context history |
| 🖼️ **Photos** | Image analysis and description |
| 📄 **Documents** | File content extraction and analysis |
| 🎤 **Voice** | Voice messages (transcription coming soon) |

### Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and intro |
| `/help` | Show available commands |
| `/status` | Session info and mode |
| `/clear` | Clear chat history |
| `/pipeline` | Toggle pipeline mode |

### Features

- **Session management**: 30-minute timeout, auto-cleanup
- **Message history**: Last 20 messages kept for context
- **Long message splitting**: Auto-splits responses >4000 chars
- **Chat actions**: Shows "typing..." indicator while processing
- **Pipeline mode**: Route messages through your Arena pipeline

## Ollama Local Models

Run models locally for **100% free, private** inference:

### Setup

```bash
# Install Ollama
curl -fsSL https://ollama.com/install | sh

# Pull models
ollama pull llama3.1:8b      # Analyst
ollama pull phi4:latest      # Classifier/Summarizer
ollama pull qwen2.5:14b      # Researcher
ollama pull llama3.1:70b     # Synthesizer
```

### Usage

1. In Arena, add a specialized node (classifier/analyst/researcher/synthesizer/summarizer).
2. In Node Settings, select **"Local Models (Ollama)"** section.
3. Choose a preset — the node auto-configures model, prompt, and parameters.

### Token Savings with Ollama

| Task | Cloud Tokens | Ollama Tokens | Savings |
|------|-------------|---------------|---------|
| Classifier | 20 (Gemma free) | 50 (Phi-4) | **100% free** |
| Analyst | 800 (Llama 8B free) | 800 (Llama 8B local) | **100% free** |
| Researcher | 2000 (Qwen 235B) | 2000 (Qwen 14B local) | **~$0.02 saved** |
| Synthesizer | 3000 (Claude Opus) | 3000 (Llama 70B local) | **~$0.15 saved** |

## Token Optimization Strategies

### 1. Rational Model Selection

- **Classifiers** → micro-models (Gemma 2B), maxTokens: 20-50
- **Analysts** → free models (Llama 8B), maxTokens: 800
- **Synthesizers** → one expensive model (Claude/GPT-4), maxTokens: 3000
- **Savings: 60-70%**

### 2. Context Compression

- Built-in `contextCompression` in nodes
- Compresses input context before sending to model
- Threshold: 1000 tokens, target: 50% compression
- **Savings: 30-50%** on prompts

### 3. RAG Instead of Full Context

- BM25 search for relevant chunks
- **Adjacent chunk inclusion** for better context
- Default topK: 5 (was 3)
- **Savings: 90%** on large documents

### 4. Smart File Reader

- AI selects only relevant lines from files
- 500 lines from 10,000+ line files
- **Savings: 95%** on file reading

## Knowledge Base (Global Knowledge)

The pipeline can inject content of local files into the context of AI nodes.

How it works:

1. Mark any `file` node as **Global** (or add files manually in Knowledge Base UI).
2. Executor discovers unique KB paths (global file nodes + manual list).
3. For each path, executor loads content through `/api/files` and concatenates it.
4. For AI nodes:
   - If node prompt does **not** include `{{global}}`, executor prepends the KB content automatically.

## API Routes

All routes live in `app/api/*`.

- `POST /api/chat` — OpenRouter + **Ollama** streaming Chat Completions.
- `GET /api/models` — fetch OpenRouter models.
- `GET /api/files` — file tree of project.
- `POST /api/files` — read specific file.
- `PATCH /api/files/edit` — file editing (write/edit/append/delete) with backups.
- `POST /api/search` — DuckDuckGo Lite web search.
- `POST /api/search-multi` — **Multi-source search** (DuckDuckGo, SearXNG, Google, Bing, RSS) with web scraping.
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

## Analytics & Export

- **Waterfall/Gantt**: pipeline execution visualization.
- **Export**: PDF and CSV reports.
- **Metrics**: prompt/completion tokens, cost, latency.

## Troubleshooting

### `OPENROUTER_API_KEY is missing`

- Ensure `.env` exists in project root and contains `OPENROUTER_API_KEY`.
- Restart dev server after editing `.env`.

### Ollama Connection Refused

- Ensure Ollama is running: `ollama list`
- Check `OLLAMA_BASE_URL` in `.env` (default: `http://localhost:11434`)

### Rate Limits (429)

- The executor retries with backoff, but heavy parallel pipelines can still hit limits.
- Reduce parallel nodes or simplify the graph.

### Web Search Failures

- DuckDuckGo Lite sometimes blocks/changes markup.
- If search results return `[Search failed: ...]`, disable `webSearch` for the model.

## Security Notes (Important)

- **Never commit `.env`**. Your OpenRouter key must be treated as a secret.
- The `/api/files` and `/api/files/edit` endpoints can read and modify **any file within the project root**.
- This is fine for local development, but **unsafe for public deployments**.
- For production: add auth + path allowlist.

## Roadmap Ideas

- Auth + per-user storage
- Hard allowlist for file reading (KB)
- Better cost accuracy by consuming provider usage fields
- Export/share pipeline presets
- Real embedding models (OpenAI/Nomic) for RAG
- Multi-scenario event simulation (optimistic/pessimistic/baseline)

---

If you want, I can also:

- add a `README` section for deployment (Vercel/Node server)
- harden `/api/files` and remove secrets exposure
- add a sample pipeline JSON and recommended node patterns