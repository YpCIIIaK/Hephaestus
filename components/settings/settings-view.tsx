'use client'

import { CheckCircle2, CircleDashed, Cpu, Database, Download, KeyRound, Gauge, MessageSquareText, RefreshCw, Server, Settings2, Sparkles, Upload, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ModelPicker } from '@/components/model-picker'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { FieldRow, Input } from '@/components/ui/field'
import { Badge, Card, Spinner } from '@/components/ui/misc'
import { Confirm, Slider, Switch } from '@/components/ui/overlay'
import { api } from '@/lib/client/llm'
import { ALIAS_LABELS, pickAliasModel, shortModelName } from '@/lib/models'
import { useCatalog } from '@/lib/stores/catalog'
import { rehydrateAll } from '@/lib/stores/hydration'
import { useSettings } from '@/lib/stores/settings'
import { clearAllPersisted, readAllPersisted, writeAllPersisted } from '@/lib/stores/storage'
import type { ModelAlias, ServerStatus } from '@/lib/types'
import { cn, downloadFile, formatRelative, formatTokens } from '@/lib/utils'

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-4">{icon}</div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      <div className="space-y-5 px-5 py-4">{children}</div>
    </Card>
  )
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', ok ? 'text-success' : ok === false ? 'text-faint' : 'text-muted')}>
      {ok ? <CheckCircle2 className="size-3.5" /> : ok === false ? <XCircle className="size-3.5" /> : <CircleDashed className="size-3.5" />}
      {label}
    </span>
  )
}

function Connections() {
  const status = useCatalog((s) => s.status)
  const loadStatus = useCatalog((s) => s.loadStatus)
  const refresh = useCatalog((s) => s.refresh)
  const [key, setKey] = useState('')
  const [ollama, setOllama] = useState('')
  const [custom, setCustom] = useState({ url: '', key: '' })
  const [busy, setBusy] = useState<string | null>(null)

  const save = async (what: string, body: Record<string, string>) => {
    setBusy(what)
    try {
      const st = await api<ServerStatus>('/api/settings', { method: 'POST', json: body })
      useCatalog.setState({ status: st })
      await refresh(true)
      toast.success('Сохранено')
      return st
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section icon={<KeyRound />} title="Подключения" description="Ключи хранятся на вашем компьютере в data/settings.json и не попадают в браузер. Переменные из .env тоже работают.">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">OpenRouter</span>
          <StatusPill ok={status ? status.openrouter.configured : null} label={status?.openrouter.configured ? `ключ ${status.openrouter.masked} · ${status.openrouter.source === 'env' ? 'из .env' : 'из настроек'}` : 'ключ не задан'} />
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="ml-auto text-xs text-accent hover:underline">
            Получить ключ →
          </a>
        </div>
        <div className="flex gap-2">
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" className="font-mono" />
          <Button
            variant="primary"
            disabled={!key.trim() || busy === 'or'}
            onClick={async () => {
              if (await save('or', { openrouterKey: key.trim() })) setKey('')
            }}
          >
            {busy === 'or' && <Spinner />} Сохранить
          </Button>
          {status?.openrouter.source === 'settings' && (
            <Button variant="ghost" onClick={() => save('or-del', { openrouterKey: '' })}>
              Удалить
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">Один ключ — сотни моделей: OpenAI, Anthropic, Google, DeepSeek, Qwen, Llama и другие. Цены и баланс — на сайте OpenRouter.</p>
      </div>

      <div className="space-y-2 border-t border-border pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">Ollama — локальные модели</span>
          <StatusPill ok={status ? status.ollama.reachable : null} label={status?.ollama.reachable ? `работает · ${status.ollama.models} моделей` : 'не отвечает'} />
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="ml-auto text-xs text-accent hover:underline">
            Установить →
          </a>
        </div>
        <div className="flex gap-2">
          <Input value={ollama} onChange={(e) => setOllama(e.target.value)} placeholder={status?.ollama.url ?? 'http://127.0.0.1:11434'} className="font-mono" />
          <Button disabled={!ollama.trim() || busy === 'ol'} onClick={() => save('ol', { ollamaUrl: ollama.trim() })}>
            Сохранить
          </Button>
          <Button variant="ghost" size="icon" onClick={() => loadStatus().then(() => refresh(true))} aria-label="Проверить снова">
            <RefreshCw />
          </Button>
        </div>
        <p className="text-xs text-muted">
          Бесплатно и приватно. Запустите <code className="font-mono">ollama serve</code> и скачайте модель, например <code className="font-mono">ollama pull qwen3:8b</code> — она появится в каталоге с префиксом ollama/.
        </p>
      </div>

      <div className="space-y-2 border-t border-border pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">Свой OpenAI-совместимый сервер</span>
          <StatusPill ok={status ? status.custom.configured : null} label={status?.custom.configured ? status.custom.url ?? '' : 'не задан'} />
        </div>
        <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
          <Input value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} placeholder="http://127.0.0.1:1234/v1" className="font-mono" />
          <Input type="password" value={custom.key} onChange={(e) => setCustom({ ...custom, key: e.target.value })} placeholder="ключ (если нужен)" className="font-mono" />
          <Button disabled={!custom.url.trim() || busy === 'cu'} onClick={() => save('cu', { customUrl: custom.url.trim(), customKey: custom.key.trim() })}>
            Сохранить
          </Button>
        </div>
        <p className="text-xs text-muted">LM Studio, vLLM, llama.cpp server и другие. Модели появятся с префиксом custom/.</p>
      </div>
      {status && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-4 text-xs text-muted">
          <span>
            Веб-поиск: <b className="text-fg">{status.searxng ? 'SearXNG' : 'DuckDuckGo'}</b>
          </span>
          <span>
            Папка файлов: <code className="font-mono text-fg">{status.workspace}/</code>
          </span>
        </div>
      )}
    </Section>
  )
}

function Models() {
  const aliases = useSettings((s) => s.aliases)
  const setAlias = useSettings((s) => s.setAlias)
  const freeOnly = useSettings((s) => s.freeOnly)
  const models = useCatalog((s) => s.models)
  const fetchedAt = useCatalog((s) => s.fetchedAt)
  const loading = useCatalog((s) => s.loading)
  const refresh = useCatalog((s) => s.refresh)
  const errors = useCatalog((s) => s.errors)
  return (
    <Section icon={<Sparkles />} title="Роли моделей" description="Агенты, шаблоны и судьи ссылаются на роли, а не на конкретные модели. Поменяйте модель здесь — и она сменится везде.">
      {(Object.keys(ALIAS_LABELS) as ModelAlias[]).map((a) => {
        const auto = pickAliasModel(a, models, freeOnly)
        const autoInfo = models.find((m) => m.id === auto)
        return (
          <div key={a} className="grid items-center gap-2 sm:grid-cols-[200px_1fr]">
            <div>
              <div className="text-[13px] font-medium">{ALIAS_LABELS[a].title}</div>
              <div className="text-xs text-muted">{ALIAS_LABELS[a].hint}</div>
            </div>
            <div className="flex gap-2">
              <ModelPicker value={aliases[a]} onChange={(id) => setAlias(a, id)} allowAliases={false} placeholder={auto ? `Авто: ${shortModelName(autoInfo, auto)}` : 'Нет доступных моделей'} />
              {aliases[a] && (
                <Button variant="ghost" onClick={() => setAlias(a, '')}>
                  Авто
                </Button>
              )}
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-xs text-muted">
        <Cpu className="size-4" />
        В каталоге {models.length} моделей{fetchedAt ? ` · обновлён ${formatRelative(fetchedAt)}` : ''}
        {errors[0] && <Badge tone="danger">{errors[0]}</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => refresh(true)} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw />} Обновить каталог
        </Button>
      </div>
    </Section>
  )
}

function ChatPrefs() {
  const chat = useSettings((s) => s.chat)
  const setChat = useSettings((s) => s.setChat)
  const sendOnEnter = useSettings((s) => s.sendOnEnter)
  const set = useSettings((s) => s.set)
  const toggles: [keyof typeof chat, string, string][] = [
    ['autoTitle', 'Автоназвание диалогов', 'Быстрая модель придумывает название по первому сообщению'],
    ['autoJudge', 'Автосудья', 'Когда отвечают несколько участников, судья сразу сравнивает ответы'],
    ['showReasoning', 'Показывать рассуждения', 'У моделей с режимом размышлений — сворачиваемый блок'],
  ]
  return (
    <Section icon={<MessageSquareText />} title="Чат">
      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRow label={`Память диалога · ${formatTokens(chat.maxContextTokens)} токенов`} hint="Старые сообщения отбрасываются, когда история длиннее">
          <Slider min={2000} max={200_000} step={2000} value={[chat.maxContextTokens]} onValueChange={([v]) => setChat({ maxContextTokens: v })} />
        </FieldRow>
        <FieldRow label={`Температура моделей · ${chat.temperature.toFixed(1)}`} hint="У агентов — своя">
          <Slider min={0} max={2} step={0.1} value={[chat.temperature]} onValueChange={([v]) => setChat({ temperature: v })} />
        </FieldRow>
        <FieldRow label="Макс. длина ответа, токенов">
          <Input type="number" min={256} max={128000} value={chat.maxTokens} onChange={(e) => setChat({ maxTokens: Number(e.target.value) || 4096 })} />
        </FieldRow>
        <FieldRow label="Модель судьи">
          <ModelPicker value={chat.judgeModel} onChange={(judgeModel) => setChat({ judgeModel })} />
        </FieldRow>
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        {toggles.map(([k, label, hint]) => (
          <label key={k} className="flex items-center justify-between gap-4 text-[13px]">
            <span>
              {label}
              <span className="block text-xs text-muted">{hint}</span>
            </span>
            <Switch checked={!!chat[k]} onCheckedChange={(v) => setChat({ [k]: v })} />
          </label>
        ))}
        <label className="flex items-center justify-between gap-4 text-[13px]">
          <span>
            Отправка по Enter
            <span className="block text-xs text-muted">Иначе — Ctrl+Enter, а Enter переносит строку</span>
          </span>
          <Switch checked={sendOnEnter} onCheckedChange={(v) => set({ sendOnEnter: v })} />
        </label>
      </div>
    </Section>
  )
}

function Limits() {
  const limits = useSettings((s) => s.limits)
  const freeOnly = useSettings((s) => s.freeOnly)
  const set = useSettings((s) => s.set)
  return (
    <Section icon={<Gauge />} title="Лимиты расходов" description="При достижении лимита новые запросы к платным моделям блокируются. 0 — без лимита.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="В день, $">
          <Input type="number" min={0} step={0.5} value={limits.dailyUsd} onChange={(e) => set({ limits: { ...limits, dailyUsd: Math.max(0, Number(e.target.value) || 0) } })} />
        </FieldRow>
        <FieldRow label="В месяц, $">
          <Input type="number" min={0} step={1} value={limits.monthlyUsd} onChange={(e) => set({ limits: { ...limits, monthlyUsd: Math.max(0, Number(e.target.value) || 0) } })} />
        </FieldRow>
      </div>
      <label className="flex items-center justify-between gap-4 border-t border-border pt-4 text-[13px]">
        <span>
          Только бесплатные модели
          <span className="block text-xs text-muted">Роли в режиме «Авто» берут бесплатные модели OpenRouter, запросы к платным блокируются</span>
        </span>
        <Switch checked={freeOnly} onCheckedChange={(v) => set({ freeOnly: v })} />
      </label>
    </Section>
  )
}

function DataSection() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [resetting, setResetting] = useState(false)
  return (
    <Section icon={<Database />} title="Данные" description="Диалоги, пайплайны, дебаты и настройки хранятся в браузере (IndexedDB). Сделайте резервную копию перед сменой браузера.">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            const data = await readAllPersisted()
            downloadFile(`hephaestus-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'hephaestus-backup@1', exportedAt: new Date().toISOString(), data }, null, 2))
          }}
        >
          <Download /> Резервная копия
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const parsed = JSON.parse(await f.text()) as { format?: string; data?: Record<string, unknown> }
              if (parsed.format !== 'hephaestus-backup@1' || !parsed.data) throw new Error('Это не резервная копия Hephaestus')
              await writeAllPersisted(parsed.data)
              await rehydrateAll()
              toast.success('Данные восстановлены')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err))
            }
          }}
        />
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <Upload /> Восстановить
        </Button>
        <Button variant="danger" className="ml-auto" onClick={() => setResetting(true)}>
          Стереть всё
        </Button>
      </div>
      <Confirm
        open={resetting}
        onOpenChange={setResetting}
        title="Стереть все данные?"
        description="Удалятся диалоги, пайплайны, дебаты, анализы, свои агенты, история расходов и настройки в этом браузере. Файлы workspace, база знаний и ключи на сервере останутся."
        confirmLabel="Стереть"
        onConfirm={async () => {
          await clearAllPersisted()
          location.reload()
        }}
      />
    </Section>
  )
}

export function SettingsView() {
  return (
    <>
      <PageHeader icon={<Settings2 />} title="Настройки" subtitle="Подключения, модели, лимиты и данные" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
          <Connections />
          <Models />
          <Limits />
          <ChatPrefs />
          <DataSection />
          <p className="flex items-center justify-center gap-2 pb-4 text-xs text-faint">
            <Server className="size-3.5" /> Hephaestus 2.0 · работает локально на вашем компьютере
          </p>
        </div>
      </div>
    </>
  )
}
