'use client'

import { BadgeCheck, CheckCircle2, LogIn, LogOut, CircleDashed, Cpu, Database, Download, FolderCog, KeyRound, Gauge, MessageSquareText, RefreshCw, Server, Settings2, Sparkles, TriangleAlert, Upload, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ModelPicker } from '@/components/model-picker'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, NativeSelect } from '@/components/ui/field'
import { Badge, Card, Segmented, Spinner } from '@/components/ui/misc'
import { Confirm, Slider, Switch } from '@/components/ui/overlay'
import { api } from '@/lib/client/llm'
import { ALIAS_LABELS, pickAliasModel, shortModelName } from '@/lib/models'
import { usableModels, useCatalog } from '@/lib/stores/catalog'
import { rehydrateAll } from '@/lib/stores/hydration'
import { useSettings, type Settings } from '@/lib/stores/settings'
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
            Веб-поиск (свой метапоиск, бесплатно):{' '}
            {status.search.map((e, i) => {
              const paused = (e.pausedUntil ?? 0) > Date.now()
              return (
                <span key={e.id} title={e.lastError}>
                  {i > 0 && ', '}
                  <b className={paused ? 'text-danger' : 'text-fg'}>{e.name}</b>
                  {paused && ' (пауза)'}
                </span>
              )
            })}
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
  const subscriptionFirst = useSettings((s) => s.subscriptionFirst)
  const models = useCatalog((s) => s.models)
  const unavailable = useCatalog((s) => s.unavailable)
  const fetchedAt = useCatalog((s) => s.fetchedAt)
  const loading = useCatalog((s) => s.loading)
  const refresh = useCatalog((s) => s.refresh)
  const errors = useCatalog((s) => s.errors)
  return (
    <Section icon={<Sparkles />} title="Роли моделей" description="Агенты, шаблоны и судьи ссылаются на роли, а не на конкретные модели. Поменяйте модель здесь — и она сменится везде.">
      {(Object.keys(ALIAS_LABELS) as ModelAlias[]).map((a) => {
        const auto = pickAliasModel(a, usableModels(models, unavailable), freeOnly, subscriptionFirst)
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
      <RoutingSettings />
      <DeciderSettings />
    </Section>
  )
}

const SERVICE_FIELDS: { key: keyof Settings['services']; label: string; hint: string; empty: string }[] = [
  { key: 'title', label: 'Заголовки чатов', hint: 'Короткое название диалога по первому сообщению', empty: 'Быстрая' },
  { key: 'compaction', label: 'Сжатие контекста', hint: 'Резюме ранней истории, когда диалог не помещается в контекст', empty: 'Сам участник диалога' },
  { key: 'router', label: 'Маршрутизатор в Кузнице', hint: 'Если в блоке маршрутизатора модель не выбрана', empty: 'Быстрая' },
  { key: 'validator', label: 'Проверка в Кузнице', hint: 'Если в блоке проверки модель не выбрана', empty: 'Умная' },
]

/** Подписка в приоритете и модели служебных задач */
function RoutingSettings() {
  const subscriptionFirst = useSettings((s) => s.subscriptionFirst)
  const subscriptionFallback = useSettings((s) => s.subscriptionFallback)
  const services = useSettings((s) => s.services)
  const set = useSettings((s) => s.set)
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <label className="flex items-center justify-between gap-4 text-[13px]">
        <span>
          Подписка в приоритете
          <span className="block text-xs text-muted">
            Модель OpenRouter, у которой есть такая же по подписке (Claude → Claude Code, GPT → Codex), запускается через подписку с тем же усилием. «Умная» и «Основная» в автовыборе — тоже по подписке
          </span>
        </span>
        <Switch checked={subscriptionFirst} onCheckedChange={(v) => set({ subscriptionFirst: v })} />
      </label>
      <label className="flex items-center justify-between gap-4 text-[13px]">
        <span>
          Запасной путь через OpenRouter
          <span className="block text-xs text-muted">Подписка не сработала (лимит, нет входа, устаревший CLI) — повторить той же моделью через OpenRouter. Лимиты расходов и «только бесплатные» действуют</span>
        </span>
        <Switch checked={subscriptionFallback} onCheckedChange={(v) => set({ subscriptionFallback: v })} />
      </label>
      <div className="space-y-3">
        <div className="text-[13px] font-medium">Служебные модели</div>
        {SERVICE_FIELDS.map((f) => (
          <div key={f.key} className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
            <div>
              <div className="text-[13px]">{f.label}</div>
              <div className="text-xs text-muted">{f.hint}</div>
            </div>
            <div className="flex gap-2">
              <ModelPicker value={services[f.key]} onChange={(id) => set({ services: { ...services, [f.key]: id } })} placeholder={`По умолчанию: ${f.empty}`} />
              {services[f.key] && (
                <Button variant="ghost" onClick={() => set({ services: { ...services, [f.key]: '' } })}>
                  Сброс
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Модели решений OpenRouter, проверенные через их страницы эндпоинтов */
const DECIDER_MODELS = [
  { id: 'perplexity/pplx-decider-v1.2', label: 'Perplexity Decider V1.2', price: '$0,02 за 1M входных токенов' },
  { id: 'typesafe/jev-1.14', label: 'TypeSafe Jev 1.14', price: '$0,042 за 1M входных токенов' },
]

function DeciderSettings() {
  const decider = useSettings((s) => s.decider)
  const freeOnly = useSettings((s) => s.freeOnly)
  const set = useSettings((s) => s.set)
  const update = (patch: Partial<typeof decider>) => set({ decider: { ...decider, ...patch } })
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <label className="flex items-center justify-between gap-4 text-[13px]">
        <span>
          Модель решений (decider)
          <span className="block text-xs text-muted">
            Маршрутизаторы и проверки в пайплайнах решают не текстом, а выбором с вероятностью: быстрее и надёжнее, чем просить LLM вернуть JSON. Если модель решений недоступна, решает LLM, как раньше.
          </span>
        </span>
        <Switch checked={decider.enabled} onCheckedChange={(enabled) => update({ enabled })} />
      </label>
      {decider.enabled && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {DECIDER_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => update({ model: m.id })}
                className={cn('rounded-lg border px-2.5 py-1.5 text-left text-xs', decider.model === m.id ? 'border-accent bg-accent-soft' : 'border-border text-muted hover:border-border-strong')}
              >
                <div className="font-medium text-fg">{m.label}</div>
                <div>{m.price}</div>
              </button>
            ))}
          </div>
          <Input value={decider.model} onChange={(e) => update({ model: e.target.value.trim() })} placeholder="id модели решений, например perplexity/pplx-decider-v1.2" className="font-mono" />
          <p className="text-xs text-muted">
            Модели решений платные, но очень дешёвые: одно решение — сотни входных токенов, тысячные доли цента. Расход учитывается в аналитике и лимитах.
            {freeOnly && ' Режим «Только бесплатные модели» на них не распространяется: включая этот переключатель, вы разрешаете эти расходы.'}
          </p>
        </div>
      )}
    </div>
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
        <FieldRow label={`Память диалога · ${formatTokens(chat.maxContextTokens)} токенов`} hint="Когда история длиннее, ранние ходы сжимаются в резюме. Больше, чем вмещает контекст модели, ставить нет смысла — у большинства моделей до 1M">
          <Slider min={2000} max={1_000_000} step={2000} value={[chat.maxContextTokens]} onValueChange={([v]) => setChat({ maxContextTokens: v })} />
        </FieldRow>
        <FieldRow label={`Температура моделей · ${chat.temperature.toFixed(1)}`} hint="У агентов — своя">
          <Slider min={0} max={2} step={0.1} value={[chat.temperature]} onValueChange={([v]) => setChat({ temperature: v })} />
        </FieldRow>
        <FieldRow label="Макс. длина ответа, токенов" hint="До 1 000 000; если модель выдаёт меньше, запрос сам урежется до её предела">
          <Input type="number" min={256} max={1_000_000} value={chat.maxTokens} onChange={(e) => setChat({ maxTokens: Number(e.target.value) || 4096 })} />
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

function WorkspaceSection() {
  const status = useCatalog((s) => s.status)
  const [dir, setDir] = useState<string | null>(null)
  const [timeout, setTimeoutSec] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmFull, setConfirmFull] = useState(false)

  const save = async (body: Record<string, unknown>, ok = 'Сохранено') => {
    setBusy(true)
    try {
      const st = await api<ServerStatus>('/api/settings', { method: 'POST', json: body })
      useCatalog.setState({ status: st })
      setDir(null)
      setTimeoutSec(null)
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const dirValue = dir ?? status?.workspace ?? ''
  const timeoutValue = timeout ?? String(status?.terminal.timeoutSec ?? 120)
  return (
    <Section
      icon={<FolderCog />}
      title="Рабочая папка и терминал"
      description="Папка, с которой модели работают через инструменты: читают и правят файлы, ищут по коду, запускают команды. Выйти за её пределы файловые инструменты не могут."
    >
      <FieldRow label="Рабочая папка" hint="Абсолютный путь к папке проекта. Без настройки — папка workspace/ рядом с приложением или HEPHAESTUS_WORKSPACE из .env">
        <div className="flex gap-2">
          <Input value={dirValue} onChange={(e) => setDir(e.target.value)} placeholder="/home/user/projects/app или C:\Projects\app" className="font-mono" />
          <Button disabled={busy || dir == null || !dir.trim() || dir === status?.workspace} onClick={() => save({ workspaceDir: dir!.trim() }, 'Рабочая папка изменена')}>
            Сохранить
          </Button>
          {status?.workspaceCustom && (
            <Button variant="ghost" disabled={busy} onClick={() => save({ workspaceDir: '' }, 'Вернули папку по умолчанию')}>
              По умолчанию
            </Button>
          )}
        </div>
      </FieldRow>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px]">
            Терминал для моделей
            <span className="block text-xs text-muted">Тесты, сборка, линтеры, git, установка зависимостей и запуск программ в рабочей папке ({status?.terminal.shell ?? 'bash'})</span>
          </div>
          <Segmented
            size="sm"
            value={status?.terminal.mode ?? 'off'}
            onChange={(mode) => (mode === 'full' ? setConfirmFull(true) : save({ terminal: 'off' }, 'Терминал выключен'))}
            options={[
              { value: 'off', label: 'Выключен' },
              { value: 'full', label: 'Полный доступ' },
            ]}
          />
        </div>
        {status?.terminal.mode === 'full' && (
          <p className="flex gap-2 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted">
            <TriangleAlert className="size-4 shrink-0 text-gold" />
            Модели выполняют любые команды с вашими правами. Команды стартуют в рабочей папке, ключи API в них не передаются, но сама команда может обратиться к любым файлам компьютера. Не давайте терминал вместе с интернетом моделям, которым не доверяете: прочитанная страница может подсказать вредную команду.
          </p>
        )}
        <FieldRow label="Лимит времени на команду, секунд" hint="Долгие процессы (dev-серверы, watch) модели запускают в фоне — для них лимита нет">
          <div className="flex gap-2">
            <Input type="number" min={5} max={1800} value={timeoutValue} onChange={(e) => setTimeoutSec(e.target.value)} className="w-32" />
            <Button disabled={busy || timeout == null || Number(timeout) === status?.terminal.timeoutSec} onClick={() => save({ commandTimeoutSec: Math.round(Number(timeout)) })}>
              Сохранить
            </Button>
          </div>
        </FieldRow>
      </div>

      {status && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-4 text-xs text-muted">
          <span>
            Поиск в коде: <b className="text-fg">{status.ripgrep ? 'ripgrep' : 'встроенный'}</b>
            {!status.ripgrep && ' — установите ripgrep (rg), чтобы на больших проектах было в разы быстрее'}
          </span>
        </div>
      )}
      <Confirm
        open={confirmFull}
        onOpenChange={setConfirmFull}
        title="Дать моделям полный доступ к терминалу?"
        description="Модели смогут выполнять любые команды в рабочей папке с правами вашего пользователя: запускать тесты и сборку, ставить пакеты, менять и удалять файлы. Включайте для своих проектов и моделей, которым доверяете."
        confirmLabel="Включить"
        onConfirm={() => save({ terminal: 'full' }, 'Терминал включён')}
      />
    </Section>
  )
}

const SUB_INFO: Record<'claude-code' | 'codex', { title: string; install: string; login: string; models: string }> = {
  'claude-code': {
    title: 'Claude Code — подписка Claude Pro/Max',
    install: 'npm i -g @anthropic-ai/claude-code',
    login: 'запустите claude в терминале и выполните /login',
    models: 'Все свежие модели Anthropic появляются в списке сами. Сюда — только если нужной там нет (полное имя, например claude-opus-5-5)',
  },
  codex: {
    title: 'Codex — подписка ChatGPT',
    install: 'npm i -g @openai/codex',
    login: 'codex login',
    models: 'Список берётся из самого Codex. Сюда — только если нужной там нет',
  },
}

interface AuthJobView {
  action: 'install' | 'login' | 'logout'
  state: 'running' | 'done' | 'failed'
  output: string
  url?: string
}
interface SubAuthView {
  id: 'claude-code' | 'codex'
  installed: boolean
  version: string | null
  latest?: string | null
  outdated?: boolean
  loggedIn: boolean | null
  detail?: string
  job: AuthJobView | null
}

const JOB_LABEL: Record<AuthJobView['action'], string> = { install: 'Установка', login: 'Вход', logout: 'Выход' }

/** Установка CLI и вход в подписку кнопками: сервер запускает штатные команды CLI */
function SubscriptionAuth({ id, onChanged }: { id: 'claude-code' | 'codex'; onChanged: () => void }) {
  const [view, setView] = useState<SubAuthView | null>(null)
  const [code, setCode] = useState('')
  const running = view?.job?.state === 'running'

  const load = useCallback(async () => {
    try {
      const r = await api<{ subscriptions: SubAuthView[] }>('/api/subscriptions')
      setView(r.subscriptions.find((s) => s.id === id) ?? null)
    } catch {
      // сервер недоступен — покажем при следующем опросе
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])
  // Пока идёт установка или вход — обновляем состояние; по окончании — каталог моделей и статус
  const wasRunning = useRef(false)
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) onChanged()
      wasRunning.current = false
      return
    }
    wasRunning.current = true
    const t = setInterval(() => void load(), 1500)
    return () => clearInterval(t)
  }, [running, load, onChanged])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await api('/api/subscriptions', { method: 'POST', json: { action, id, ...extra } })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  if (!view) return null
  const job = view.job
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {view.installed ? (
          view.loggedIn ? (
            <StatusPill ok label={`вход выполнен${view.detail ? ` · ${view.detail}` : ''}`} />
          ) : (
            <StatusPill ok={false} label={view.loggedIn === false ? 'вход не выполнен' : 'вход: неизвестно'} />
          )
        ) : (
          <StatusPill ok={false} label="CLI не установлен" />
        )}
        {view.outdated && <span className="text-xs text-warning">доступна версия {view.latest} — новые модели требуют свежий CLI</span>}
        <span className="flex-1" />
        {!view.installed && (
          <Button size="sm" variant="primary" disabled={running} onClick={() => void act('install')}>
            <Download /> Установить
          </Button>
        )}
        {view.installed && !view.loggedIn && (
          <Button size="sm" variant="primary" disabled={running} onClick={() => void act('login')}>
            <LogIn /> Войти в подписку
          </Button>
        )}
        {view.installed && view.loggedIn && (
          <Button size="sm" variant="ghost" disabled={running} onClick={() => void act('logout')}>
            <LogOut /> Выйти
          </Button>
        )}
        {view.installed && (
          <Button size="sm" variant={view.outdated ? 'primary' : 'ghost'} disabled={running} onClick={() => void act('install')} title="Обновить CLI до последней версии">
            <RefreshCw /> Обновить
          </Button>
        )}
      </div>
      {job && (job.state === 'running' || job.state === 'failed' || job.action !== 'logout') && job.output.trim() && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            {job.state === 'running' ? <Spinner className="size-3" /> : job.state === 'done' ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-danger" />}
            {JOB_LABEL[job.action]}: {job.state === 'running' ? 'выполняется…' : job.state === 'done' ? 'готово' : 'не удалось'}
            {job.state === 'running' && (
              <button className="ml-auto underline hover:text-fg" onClick={() => void act('cancel')}>
                Отменить
              </button>
            )}
          </div>
          {job.action === 'login' && job.state === 'running' && (
            <div className="space-y-2">
              <p className="text-xs text-muted">Браузер со страницей входа должен открыться сам. Войдите в аккаунт с подпиской — окно можно закрыть, когда появится «успешно».</p>
              {job.url && (
                <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent underline">
                  Открыть страницу входа вручную
                </a>
              )}
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Если страница показала код — вставьте его сюда" className="font-mono text-xs" />
                <Button
                  size="sm"
                  disabled={!code.trim()}
                  onClick={() => {
                    void act('code', { code })
                    setCode('')
                  }}
                >
                  Отправить
                </Button>
              </div>
            </div>
          )}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-[11px] text-muted">{job.output.trim().split('\n').slice(-12).join('\n')}</pre>
        </div>
      )}
    </div>
  )
}

function SubscriptionsSection() {
  const status = useCatalog((s) => s.status)
  const models = useCatalog((s) => s.models)
  const refreshCatalog = useCatalog((s) => s.refresh)
  const [drafts, setDrafts] = useState<Record<string, { bin?: string; models?: string }>>({})
  const [routeFrom, setRouteFrom] = useState('')
  const [routeTo, setRouteTo] = useState('')
  const [busy, setBusy] = useState(false)
  const subs = status?.subscriptions ?? []
  const routes = status?.subscriptionRoutes ?? {}
  // После установки или входа — свежий статус CLI и каталог моделей
  const refreshStatus = useCallback(() => {
    void api<ServerStatus>('/api/status')
      .then((st) => useCatalog.setState({ status: st }))
      .catch(() => {})
    void refreshCatalog(true)
  }, [refreshCatalog])

  const save = async (body: Record<string, unknown>, ok = 'Сохранено') => {
    setBusy(true)
    try {
      const st = await api<ServerStatus>('/api/settings', { method: 'POST', json: body })
      useCatalog.setState({ status: st })
      setDrafts({})
      void refreshCatalog(true)
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const subsBody = (id: string, patch: { enabled?: boolean; bin?: string; models?: string }) => {
    const all: Record<string, unknown> = {}
    for (const s of subs) all[s.id] = { enabled: s.enabled, bin: s.bin, models: s.models.join(', ') }
    all[id] = { ...(all[id] as object), ...patch }
    return { subscriptions: all }
  }

  const subModels = models.filter((m) => m.provider === 'claude-code' || m.provider === 'codex')
  return (
    <Section
      icon={<BadgeCheck />}
      title="Подписки вместо оплаты за токены"
      description="Модели Claude и OpenAI через официальные CLI — Claude Code и Codex — по вашей подписке: расход идёт из её лимитов, а не с баланса OpenRouter. Вход выполняется в самих CLI, Hephaestus не хранит и не видит ваши токены."
    >
      {subs.map((s) => {
        const info = SUB_INFO[s.id]
        const d = drafts[s.id] ?? {}
        return (
          <div key={s.id} className="space-y-3 border-b border-border pb-4 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px]">
                {info.title}
                <span className="block text-xs">
                  {s.version ? <StatusPill ok label={`установлен · ${s.version}`} /> : <StatusPill ok={false} label={`${s.bin}: ${s.error ?? 'не найден'} — кнопка «Установить» ниже или вручную: ${info.install}`} />}
                </span>
              </div>
              <Switch checked={s.enabled} disabled={busy} onCheckedChange={(enabled) => void save(subsBody(s.id, { enabled }), enabled ? 'Подписка включена' : 'Подписка выключена')} />
            </div>
            <SubscriptionAuth id={s.id} onChanged={refreshStatus} />
            {s.enabled && (
              <>
                <FieldRow label="Дополнительные модели" hint={info.models}>
                  <div className="flex gap-2">
                    <Input value={d.models ?? s.models.join(', ')} onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, models: e.target.value } })} className="font-mono" />
                    <Button disabled={busy || d.models == null} onClick={() => void save(subsBody(s.id, { models: d.models }))}>
                      Сохранить
                    </Button>
                  </div>
                </FieldRow>
                <FieldRow label="Команда CLI" hint={`Имя команды или полный путь к ней. Перед работой войдите в подписку: ${info.login}`}>
                  <div className="flex gap-2">
                    <Input value={d.bin ?? s.bin} onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, bin: e.target.value } })} className="font-mono" />
                    <Button disabled={busy || d.bin == null} onClick={() => void save(subsBody(s.id, { bin: d.bin }))}>
                      Сохранить
                    </Button>
                  </div>
                </FieldRow>
              </>
            )}
          </div>
        )
      })}
      {subModels.length > 0 && (
        <FieldRow label="Через подписку вместо OpenRouter" hint="Выбранная модель OpenRouter везде — в чате, агентах, Кузнице — будет работать через подписку. Например, anthropic/claude-fable-5.2 → claude-code/fable">
          <div className="space-y-2">
            {Object.entries(routes).map(([from, to]) => (
              <div key={from} className="flex items-center gap-2 text-[13px]">
                <span className="truncate font-mono">{from}</span>→<span className="truncate font-mono text-accent">{to}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const { [from]: _, ...rest } = routes
                    void save({ subscriptionRoutes: rest }, 'Перенаправление удалено')
                  }}
                >
                  Убрать
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <ModelPicker value={routeFrom} onChange={setRouteFrom} placeholder="Модель OpenRouter" />
              <NativeSelect value={routeTo} onChange={(e) => setRouteTo(e.target.value)}>
                <option value="">Модель подписки…</option>
                {subModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </NativeSelect>
              <Button disabled={busy || !routeFrom || !routeTo || routeFrom.startsWith('claude-code/') || routeFrom.startsWith('codex/')} onClick={() => void save({ subscriptionRoutes: { ...routes, [routeFrom]: routeTo } }, 'Перенаправление сохранено')}>
                Добавить
              </Button>
            </div>
          </div>
        </FieldRow>
      )}
      <p className="text-xs text-faint">
        Инструменты у таких моделей свои (чтение и правка файлов, команды, веб) и работают в рабочей папке проекта или в копии участника; терминал — только если он включён выше. База знаний и навыки Hephaestus им недоступны. Использование подписки через CLI подчиняется условиям Anthropic и OpenAI.
      </p>
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
          <WorkspaceSection />
          <SubscriptionsSection />
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
