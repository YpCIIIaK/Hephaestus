'use client'

import { Copy, Plus, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { ToolsetToggles, ToolTraceList } from '@/components/tool-chips'
import { Button } from '@/components/ui/button'
import { FieldRow, Input, NativeSelect, Textarea } from '@/components/ui/field'
import { Badge, Segmented } from '@/components/ui/misc'
import { Slider, Switch } from '@/components/ui/overlay'
import { UsageLine } from '@/components/usage-line'
import { effectiveAgentConfig, NODE_META, type NodeConfig, type NodeRun, type Pipeline, type PipelineNode } from '@/lib/engine/pipeline'
import { getAgent, useAllAgents } from '@/lib/stores/agents'
import { uid } from '@/lib/utils'
import { NODE_STYLE } from './node-meta'

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
          <Input type="number" min={50} max={64000} value={eff.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) || undefined })} />
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

function ConfigFields({ node, pipeline, set }: { node: PipelineNode; pipeline: Pipeline; set: (p: Partial<NodeConfig>) => void }) {
  const c = node.config
  switch (node.kind) {
    case 'input':
      return <p className="text-sm leading-relaxed text-muted">Сюда попадает запрос, с которым запускают пайплайн. В шаблонах других узлов он доступен как <code className="font-mono text-accent">{'{{input}}'}</code>.</p>
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
          <FieldRow label="Критерии проверки">
            <Textarea rows={4} value={c.criteria ?? ''} onChange={(e) => set({ criteria: e.target.value })} placeholder="Ответ полный, точный, со ссылками на источники…" />
          </FieldRow>
          <FieldRow label={`Доработок максимум · ${c.maxAttempts ?? 2}`} hint="Не прошёл — агенты на входе получают замечания и переписывают ответ">
            <Slider min={1} max={5} step={1} value={[c.maxAttempts ?? 2]} onValueChange={([v]) => set({ maxAttempts: v })} />
          </FieldRow>
          <FieldRow label="Модель проверяющего">
            <ModelPicker value={c.model || '@smart'} onChange={(id) => set({ model: id })} />
          </FieldRow>
        </>
      )
  }
}

export function NodeOutput({ run }: { run: NodeRun }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={run.status === 'done' ? 'success' : run.status === 'error' ? 'danger' : run.status === 'running' ? 'accent' : 'neutral'}>
          {{ idle: 'ожидает', running: 'выполняется', done: 'готово', skipped: 'пропущен', error: 'ошибка' }[run.status]}
        </Badge>
        {run.note && <span className="text-xs text-muted">{run.note}</span>}
      </div>
      <UsageLine usage={run.usage} latencyMs={run.startedAt && run.endedAt ? run.endedAt - run.startedAt : undefined} />
      {!!run.tools?.length && <ToolTraceList tools={run.tools} />}
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
}: {
  pipeline: Pipeline
  node: PipelineNode
  run?: NodeRun
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
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Последний запуск</div>
            <NodeOutput run={run} />
          </div>
        )}
      </div>
    </div>
  )
}
