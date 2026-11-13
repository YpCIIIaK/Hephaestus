'use client'

import { Copy, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { startPipeline, usePipelineRunner } from '@/lib/client/pipeline-runner'
import { useMemo } from 'react'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { ToolsetToggles, ToolTraceList } from '@/components/tool-chips'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, NativeSelect, Textarea } from '@/components/ui/field'
import { Badge, Segmented } from '@/components/ui/misc'
import { Slider, Switch } from '@/components/ui/overlay'
import { UsageLine } from '@/components/usage-line'
import { effectiveAgentConfig, itemTitle, NODE_META, validatePipeline, type NodeConfig, type NodeRun, type Pipeline, type PipelineNode } from '@/lib/engine/pipeline'
import { getAgent, useAllAgents } from '@/lib/stores/agents'
import { cn, uid } from '@/lib/utils'
import { NODE_STYLE } from './node-meta'
import { SandboxChanges } from './sandbox-changes'
import { inputHint, useRunInputs } from './run-inputs'

function VarChips({ pipeline, node, onInsert }: { pipeline: Pipeline; node: PipelineNode; onInsert: (v: string) => void }) {
  // Предлагаем узлы, которые выполняются раньше текущего
  const upstream = useMemo(() => {
    const parents = new Map<string, string[]>()
    for (const e of pipeline.edges) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source])
    const seen = new Set<string>()
    const stack = [...(parents.get(node.id) ?? [])]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...(parents.get(id) ?? []))
    }
    return pipeline.nodes.filter((n) => seen.has(n.id) && n.kind !== 'input')
  }, [pipeline, node.id])
  const vars = ['input', 'prev', ...upstream.map((n) => n.label)]
  return (
    <div className="flex flex-wrap gap-1">
      {vars.map((v) => (
        <button key={v} type="button" onClick={() => onInsert(`{{${v}}}`)} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted hover:border-accent/50 hover:text-accent">
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  )
}

function TemplateField({ label, hint, value, onChange, pipeline, node, rows = 4, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; pipeline: Pipeline; node: PipelineNode; rows?: number; placeholder?: string }) {
  return (
    <FieldRow label={label} hint={hint}>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="font-mono text-[12.5px]" />
      <VarChips pipeline={pipeline} node={node} onInsert={(v) => onChange(value + v)} />
    </FieldRow>
  )
}

function AgentFields({ node, set, pipeline }: { node: PipelineNode; set: (p: Partial<NodeConfig>) => void; pipeline: Pipeline }) {
  const agents = useAllAgents()
  const c = node.config
  const agent = c.agentId ? getAgent(c.agentId) : undefined
  const eff = effectiveAgentConfig(node, getAgent)
  return (
    <>
      <FieldRow label="Агент из библиотеки" hint="Берёт модель, промпт и инструменты агента; поля ниже их переопределяют">
        <NativeSelect value={c.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}>
          <option value="">— без агента, своя настройка —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.emoji} {a.name}
            </option>
          ))}
        </NativeSelect>
      </FieldRow>
      <FieldRow label="Модель">
        <div className="flex gap-1.5">
          <ModelPicker value={c.model || eff.model} onChange={(id) => set({ model: id })} />
          {c.model && agent && (
            <Button size="icon" variant="ghost" onClick={() => set({ model: undefined })} title="Вернуть модель агента">
              <X />
            </Button>
          )}
        </div>
      </FieldRow>
      <FieldRow label="Системный промпт">
        <Textarea rows={4} value={c.systemPrompt ?? ''} onChange={(e) => set({ systemPrompt: e.target.value })} placeholder={agent ? `От агента: ${agent.systemPrompt.slice(0, 160)}…` : 'Кто ты и как отвечать'} />
      </FieldRow>
      <TemplateField label="Промпт" hint="Пусто — получит выходы входящих узлов ({{prev}})" value={c.prompt ?? ''} onChange={(v) => set({ prompt: v })} pipeline={pipeline} node={node} placeholder="{{prev}}" />
      <FieldRow label={`Температура · ${eff.temperature.toFixed(1)}`}>
        <Slider min={0} max={2} step={0.1} value={[eff.temperature]} onValueChange={([v]) => set({ temperature: v })} />
      </FieldRow>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Макс. токенов">
          <Input type="number" min={50} max={1_000_000} value={eff.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) || undefined })} />
        </FieldRow>
        <FieldRow label="Повторы при ошибке">
          <Input type="number" min={0} max={5} value={c.retries ?? 1} onChange={(e) => set({ retries: Number(e.target.value) })} />
        </FieldRow>
      </div>
      <FieldRow label="Инструменты">
        <ToolsetToggles compact value={eff.tools} onChange={(tools) => set({ tools })} />
      </FieldRow>
      <label className="flex items-center justify-between gap-3 text-[13px]">
        <span>
          Ответ в формате JSON
          <span className="block text-xs text-muted">Для узлов, чей вывод разбирают дальше</span>
        </span>
        <Switch checked={!!c.jsonMode} onCheckedChange={(v) => set({ jsonMode: v })} />
      </label>
      {node.kind === 'agent' && (
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            Своя копия проекта
            <span className="block text-xs text-muted">Правит копию, а не оригинал. После запуска — список изменений, diff и «Применить к проекту». Команды и проверки после этого блока выполняются в его копии</span>
          </span>
          <Switch checked={!!c.isolate} onCheckedChange={(v) => set({ isolate: v })} />
        </label>
      )}
      <FieldRow label="Запасные модели" hint="Если основная упадёт, по очереди попробуем эти">
        <div className="space-y-1.5">
          {(c.fallbackModels ?? []).map((m, i) => (
            <div key={i} className="flex gap-1.5">
              <ModelPicker size="sm" value={m} onChange={(id) => set({ fallbackModels: (c.fallbackModels ?? []).map((x, j) => (j === i ? id : x)) })} />
              <Button size="icon-sm" variant="ghost" onClick={() => set({ fallbackModels: (c.fallbackModels ?? []).filter((_, j) => j !== i) })} aria-label="Убрать">
                <X />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set({ fallbackModels: [...(c.fallbackModels ?? []), '@fast'] })}>
            <Plus /> Добавить
          </Button>
        </div>
      </FieldRow>
    </>
  )
}

/** Где выполнить команду: в проекте или в копии блока со «своей копией» */
function SandboxSource({ node, pipeline, set }: { node: PipelineNode; pipeline: Pipeline; set: (p: Partial<NodeConfig>) => void }) {
  const isolated = pipeline.nodes.filter((n) => n.kind === 'agent' && n.config.isolate)
  if (!isolated.length) return null
  return (
    <FieldRow label="Где выполнять" hint="По умолчанию — в копии входящего блока, если она у него есть, иначе в проекте">
      <NativeSelect value={node.config.sandboxFrom ?? ''} onChange={(e) => set({ sandboxFrom: e.target.value || undefined })}>
        <option value="">Автоматически</option>
        {isolated.map((n) => (
          <option key={n.id} value={n.id}>
            В копии блока «{n.label}»
          </option>
        ))}
      </NativeSelect>
    </FieldRow>
  )
}

/** Блок «Вход»: тот же черновик входа, что в панели «Запуск», и кнопка запуска прямо здесь */
function InputFields({ node, pipeline, set }: { node: PipelineNode; pipeline: Pipeline; set: (p: Partial<NodeConfig>) => void }) {
  const draft = useRunInputs((s) => s.inputs[pipeline.id] ?? '')
  const setDraft = useRunInputs((s) => s.set)
  const active = usePipelineRunner((s) => s.active[pipeline.id])
  return (
    <>
      <p className="text-sm leading-relaxed text-muted">
        Это то, с чем запускают пайплайн: задача, цель, фокус. В шаблонах других блоков вход доступен как <code className="font-mono text-accent">{'{{input}}'}</code>.
      </p>
      <FieldRow label="Вход для запуска" hint="То же поле, что в панели «Запуск»">
        <Textarea rows={5} value={draft} onChange={(e) => setDraft(pipeline.id, e.target.value)} placeholder={inputHint(pipeline)} />
      </FieldRow>
      <Button
        variant="primary"
        disabled={!!active}
        onClick={() => {
          const errors = validatePipeline(pipeline).filter((i) => i.level === 'error')
          if (errors.length) return toast.error('Пайплайн не готов к запуску', { description: errors[0].message })
          void startPipeline(pipeline, draft)
        }}
      >
        <Play className="fill-current" /> {active ? 'Выполняется' : 'Запустить'}
      </Button>
      <FieldRow label="Подсказка ко входу" hint="Что писать во «Вход» — видно тому, кто запускает пайплайн">
        <Textarea rows={2} value={node.config.hint ?? ''} onChange={(e) => set({ hint: e.target.value || undefined })} placeholder="Например: репозиторий и на что обратить внимание" />
      </FieldRow>
    </>
  )
}

function ConfigFields({ node, pipeline, set }: { node: PipelineNode; pipeline: Pipeline; set: (p: Partial<NodeConfig>) => void }) {
  const c = node.config
  switch (node.kind) {
    case 'input':
      return <InputFields node={node} pipeline={pipeline} set={set} />
    case 'command':
      return (
        <>
          <TemplateField
            label="Команда"
            hint="Выполняется в терминале рабочей папки (нужен «Полный доступ»). Можно подставлять выходы блоков. Вывод команды — выход блока"
            value={c.command ?? ''}
            onChange={(v) => set({ command: v })}
            pipeline={pipeline}
            node={node}
            rows={3}
            placeholder="npx semgrep scan --config auto --json > audit/semgrep.json; cat audit/semgrep.json"
          />
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Папка" hint="Подпапка или @tools/…">
              <Input value={c.cwd ?? ''} onChange={(e) => set({ cwd: e.target.value || undefined })} placeholder="корень" className="font-mono" />
            </FieldRow>
            <FieldRow label="Лимит, секунд" hint="Не больше лимита из настроек">
              <Input type="number" min={5} max={1800} value={c.timeoutSec ?? ''} onChange={(e) => set({ timeoutSec: Number(e.target.value) || undefined })} placeholder="из настроек" />
            </FieldRow>
          </div>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>
              Ошибка — не ошибка
              <span className="block text-xs text-muted">Ненулевой код выхода не останавливает ветку (сканеры часто так сообщают о находках)</span>
            </span>
            <Switch checked={!!c.allowFail} onCheckedChange={(v) => set({ allowFail: v })} />
          </label>
          <SandboxSource node={node} pipeline={pipeline} set={set} />
        </>
      )
    case 'foreach':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            Делит вход на элементы и обрабатывает каждый отдельным вызовом агента, по несколько одновременно. В промпте элемент — <code className="font-mono text-accent">{'{{item}}'}</code>, его номер — <code className="font-mono text-accent">{'{{index}}'}</code>.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="Деление">
              <NativeSelect value={c.splitBy ?? 'blocks'} onChange={(e) => set({ splitBy: e.target.value as NodeConfig['splitBy'] })}>
                <option value="blocks">Разделы</option>
                <option value="lines">Строки</option>
                <option value="json">JSON</option>
              </NativeSelect>
            </FieldRow>
            <FieldRow label="Не больше">
              <Input type="number" min={1} max={200} value={c.limit ?? 20} onChange={(e) => set({ limit: Number(e.target.value) || undefined })} />
            </FieldRow>
            <FieldRow label="Одновременно">
              <Input type="number" min={1} max={10} value={c.concurrency ?? 3} onChange={(e) => set({ concurrency: Number(e.target.value) || undefined })} />
            </FieldRow>
          </div>
          <FieldRow label="Элементы из файла" hint="Путь в папке проекта, например audit/candidates.json. Если файл есть — элементы берутся из него, иначе из ответа предыдущего блока">
            <Input value={c.itemsFile ?? ''} onChange={(e) => set({ itemsFile: e.target.value || undefined })} placeholder="из ответа предыдущего блока" className="font-mono" />
          </FieldRow>
          <AgentFields node={node} set={set} pipeline={pipeline} />
        </>
      )
    case 'agent':
      return <AgentFields node={node} set={set} pipeline={pipeline} />
    case 'search':
      return (
        <>
          <TemplateField label="Поисковый запрос" value={c.query ?? ''} onChange={(v) => set({ query: v })} pipeline={pipeline} node={node} rows={2} placeholder="{{input}}" />
          <FieldRow label={`Читать страниц из выдачи · ${c.readPages ?? 0}`} hint="Загрузит текст первых страниц — дольше, но точнее">
            <Slider min={0} max={5} step={1} value={[c.readPages ?? 0]} onValueChange={([v]) => set({ readPages: v })} />
          </FieldRow>
        </>
      )
    case 'knowledge':
      return (
        <>
          <TemplateField label="Запрос к базе знаний" value={c.query ?? ''} onChange={(v) => set({ query: v })} pipeline={pipeline} node={node} rows={2} placeholder="{{input}}" />
          <FieldRow label={`Фрагментов · ${c.limit ?? 5}`}>
            <Slider min={1} max={15} step={1} value={[c.limit ?? 5]} onValueChange={([v]) => set({ limit: v })} />
          </FieldRow>
        </>
      )
    case 'file':
      return <TemplateField label="Путь в workspace" value={c.path ?? ''} onChange={(v) => set({ path: v })} pipeline={pipeline} node={node} rows={1} placeholder="docs/notes.md" />
    case 'write':
      return (
        <>
          <TemplateField label="Путь в workspace" value={c.path ?? ''} onChange={(v) => set({ path: v })} pipeline={pipeline} node={node} rows={1} placeholder="reports/итог.md" />
          <TemplateField label="Содержимое" hint="Пусто — запишет выходы входящих узлов" value={c.template ?? ''} onChange={(v) => set({ template: v })} pipeline={pipeline} node={node} />
        </>
      )
    case 'merge':
    case 'output':
      return <TemplateField label="Шаблон" hint="Пусто — склеит выходы входящих узлов с заголовками" value={c.template ?? ''} onChange={(v) => set({ template: v })} pipeline={pipeline} node={node} rows={6} />
    case 'router': {
      const routes = c.routes ?? []
      return (
        <>
          <FieldRow label="Как выбирать ветку">
            <Segmented
              value={c.routerMode ?? 'llm'}
              onChange={(v) => set({ routerMode: v })}
              options={[
                { value: 'llm', label: 'Модель по смыслу' },
                { value: 'keyword', label: 'Ключевые слова' },
              ]}
            />
          </FieldRow>
          {(c.routerMode ?? 'llm') === 'llm' && (
            <FieldRow label="Модель маршрутизатора">
              <ModelPicker value={c.model || '@fast'} onChange={(id) => set({ model: id })} />
            </FieldRow>
          )}
          <FieldRow label="Ветки" hint={c.routerMode === 'keyword' ? 'Первая ветка, где нашлось слово; если нигде — последняя' : 'Описание помогает модели выбрать'}>
            <div className="space-y-2">
              {routes.map((r, i) => (
                <div key={r.id} className="space-y-1.5 rounded-lg border border-border p-2">
                  <div className="flex gap-1.5">
                    <Input value={r.label} onChange={(e) => set({ routes: routes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Название" className="h-8" />
                    <Button size="icon-sm" variant="ghost" className="size-8" onClick={() => set({ routes: routes.filter((_, j) => j !== i) })} aria-label="Удалить ветку">
                      <Trash2 />
                    </Button>
                  </div>
                  <Input value={r.keywords ?? ''} onChange={(e) => set({ routes: routes.map((x, j) => (j === i ? { ...x, keywords: e.target.value } : x)) })} placeholder={c.routerMode === 'keyword' ? 'слова через запятую' : 'когда выбирать эту ветку'} className="h-8 text-[12.5px]" />
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => set({ routes: [...routes, { id: uid('r'), label: `Ветка ${routes.length + 1}` }] })}>
                <Plus /> Ветка
              </Button>
            </div>
          </FieldRow>
        </>
      )
    }
    case 'validator':
      return (
        <>
          <FieldRow label="Чем проверять">
            <Segmented
              size="sm"
              value={c.checkCommand != null ? 'command' : 'llm'}
              onChange={(v) => set({ checkCommand: v === 'command' ? (c.checkCommand ?? 'npm test') : undefined })}
              options={[
                { value: 'llm', label: 'Моделью по критериям' },
                { value: 'command', label: 'Командой (код выхода)' },
              ]}
            />
          </FieldRow>
          {c.checkCommand != null ? (
            <>
              <TemplateField
                label="Команда проверки"
                hint="Прошло — если команда завершилась с кодом 0. Иначе агенты на входе получают конец вывода как замечания и дорабатывают"
                value={c.checkCommand}
                onChange={(v) => set({ checkCommand: v })}
                pipeline={pipeline}
                node={node}
                rows={2}
                placeholder="npm test"
              />
              <FieldRow label="Папка" hint="Подпапка или @tools/…; пусто — корень проекта">
                <Input value={c.cwd ?? ''} onChange={(e) => set({ cwd: e.target.value || undefined })} placeholder="корень" className="font-mono" />
              </FieldRow>
              <SandboxSource node={node} pipeline={pipeline} set={set} />
            </>
          ) : (
            <FieldRow label="Критерии проверки">
              <Textarea rows={4} value={c.criteria ?? ''} onChange={(e) => set({ criteria: e.target.value })} placeholder="Ответ полный, точный, со ссылками на источники…" />
            </FieldRow>
          )}
          <FieldRow label={`Доработок максимум · ${c.maxAttempts ?? 2}`} hint="Не прошёл — агенты на входе получают замечания и переписывают ответ">
            <Slider min={1} max={5} step={1} value={[c.maxAttempts ?? 2]} onValueChange={([v]) => set({ maxAttempts: v })} />
          </FieldRow>
          {c.checkCommand == null && (
            <FieldRow label="Модель проверяющего">
              <ModelPicker value={c.model || '@smart'} onChange={(id) => set({ model: id })} />
            </FieldRow>
          )}
        </>
      )
  }
}

/** «Для каждого»: элементы со статусом и результатом каждого */
function ItemResults({ items, running }: { items: NonNullable<NodeRun['itemResults']>; running: boolean }) {
  const ok = items.filter((i) => i.ok).length
  const failed = items.filter((i) => !i.ok && !i.pending).length
  return (
    <details className="rounded-xl border border-border p-3" open>
      <summary className="cursor-pointer text-xs font-semibold">
        Элементы · {ok} готово{failed ? ` · ${failed} с ошибкой` : ''}
        {running ? ' · идёт' : ''}
      </summary>
      <div className="mt-2 space-y-1">
        {items.map((it, i) => (
          <details key={i} className={cn('rounded-lg border px-2.5 py-1.5', it.pending ? 'border-border opacity-60' : it.ok ? 'border-border' : 'border-danger/30 bg-danger/5')}>
            <summary className="flex cursor-pointer items-center gap-2 text-xs">
              <span className={cn('size-1.5 shrink-0 rounded-full', it.pending ? 'bg-faint' : it.ok ? 'bg-success' : 'bg-danger')} />
              <span className="font-mono text-faint">{i + 1}</span>
              <span className="min-w-0 truncate">{itemTitle(it.item)}</span>
              {it.pending && <span className="ml-auto text-faint">в очереди или идёт</span>}
            </summary>
            {!it.pending && (
              <div className="mt-2">
                <Markdown text={it.text} className="text-[12.5px]" />
              </div>
            )}
          </details>
        ))}
      </div>
    </details>
  )
}

export function NodeOutput({ run }: { run: NodeRun }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={run.status === 'done' ? 'success' : run.status === 'error' ? 'danger' : run.status === 'running' ? 'accent' : 'neutral'}>
          {{ idle: 'ожидает', running: 'выполняется', done: 'готово', skipped: 'пропущен', error: 'ошибка' }[run.status]}
        </Badge>
        {run.reused && <Badge>из прошлого запуска</Badge>}
        {run.note && <span className="text-xs text-muted">{run.note}</span>}
      </div>
      {!!run.refusals?.length && (
        <div className="rounded-lg border border-warning/30 bg-warning/8 p-2.5 text-xs">
          Отказались выполнять: <span className="font-mono">{[...new Set(run.refusals)].join(', ')}</span>. Блок повторял запрос с уточнением задачи и переходил к запасным моделям.
        </div>
      )}
      <UsageLine usage={run.usage} latencyMs={run.startedAt && run.endedAt ? run.endedAt - run.startedAt : undefined} />
      {!!run.received?.length && <details className="rounded-xl border border-border p-3" open>
        <summary className="cursor-pointer text-xs font-semibold">Получено от других узлов · {run.received.length}</summary>
        <div className="mt-3 space-y-3">{run.received.map((part, i) => <div key={i} className="rounded-lg bg-surface-2/50 p-2.5">
          <div className="mb-1 text-xs font-medium text-muted">{part.label} → этот узел</div>
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-xs">{part.output}</div>
        </div>)}</div>
      </details>}
      {run.systemPrompt && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-semibold">Инструкция модели</summary><div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs">{run.systemPrompt}</div></details>}
      {run.prompt && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-semibold">Запрос модели</summary><div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs">{run.prompt}</div></details>}
      {run.reasoning && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-semibold">Рассуждения, переданные моделью</summary><div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs">{run.reasoning}</div></details>}
      {!!run.itemResults?.length && <ItemResults items={run.itemResults} running={run.status === 'running'} />}
      {!!run.tools?.length && <ToolTraceList tools={run.tools} />}
      {run.sandbox && run.status !== 'running' && <SandboxChanges id={run.sandbox} />}
      {run.error && <div className="rounded-lg border border-danger/25 bg-danger/8 p-2.5 text-[13px] text-danger">{run.error}</div>}
      {run.output && (
        <div className="rounded-xl border border-border bg-surface-2/50 p-3">
          <Markdown text={run.output} streaming={run.status === 'running'} className="text-[13.5px]" />
        </div>
      )}
    </div>
  )
}

export function Inspector({
  pipeline,
  node,
  run,
  onChange,
  onDelete,
  onDuplicate,
  onClose,
  onRerun,
}: {
  pipeline: Pipeline
  node: PipelineNode
  run?: NodeRun
  /** Перезапустить этот блок и всё после него, остальное взять из последнего запуска */
  onRerun?: () => void
  onChange: (patch: Partial<PipelineNode>) => void
  onDelete: () => void
  onDuplicate: () => void
  onClose: () => void
}) {
  const style = NODE_STYLE[node.kind]
  const Icon = style.icon
  const set = (p: Partial<NodeConfig>) => onChange({ config: { ...node.config, ...p } })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: `color-mix(in oklch, ${style.color} 16%, transparent)`, color: style.color }}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-faint">{NODE_META[node.kind].title}</div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onDuplicate} title="Дублировать" aria-label="Дублировать">
          <Copy />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onDelete} title="Удалить" aria-label="Удалить" className="hover:text-danger">
          <Trash2 />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Закрыть">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <FieldRow label="Название" hint="По нему на выход узла можно сослаться в шаблонах">
          <Input value={node.label} onChange={(e) => onChange({ label: e.target.value })} />
        </FieldRow>
        <ConfigFields node={node} pipeline={pipeline} set={set} />
        {run && run.status !== 'idle' && (
          <div className="border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Последний запуск</span>
              {onRerun && node.kind !== 'input' && (
                <Button size="sm" variant="ghost" onClick={onRerun} title="Этот блок и всё, что после него, выполнятся заново; остальное возьмётся из последнего запуска">
                  <RotateCcw /> Перезапустить отсюда
                </Button>
              )}
            </div>
            <NodeOutput run={run} />
          </div>
        )}
      </div>
    </div>
  )
}
