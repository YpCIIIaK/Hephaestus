'use client'

import { BrainCircuit, Code2, Lightbulb, Scale } from 'lucide-react'
import type { ChatTarget } from '@/lib/engine/chat'
import type { ToolsetId } from '@/lib/types'

export interface ChatPreset {
  targets: ChatTarget[]
  tools?: ToolsetId[]
  isolate?: boolean
}

const PRESETS: ({ title: string; hint: string } & ChatPreset)[] = [
  { title: 'Одна модель', hint: 'Обычный чат', targets: [{ kind: 'model', id: '@default' }] },
  {
    title: 'Арена трёх',
    hint: 'Умная, основная и быстрая — бок о бок',
    targets: [
      { kind: 'model', id: '@smart' },
      { kind: 'model', id: '@default' },
      { kind: 'model', id: '@fast' },
    ],
  },
  {
    title: 'Исследование',
    hint: 'Исследователь и факт-чекер ищут в сети',
    targets: [
      { kind: 'agent', id: 'researcher' },
      { kind: 'agent', id: 'factchecker' },
    ],
  },
  {
    title: 'Проверка кода',
    hint: 'Ревьюер, аудитор безопасности и тестировщик в рабочей папке',
    targets: [
      { kind: 'agent', id: 'reviewer' },
      { kind: 'agent', id: 'security' },
      { kind: 'agent', id: 'tester' },
    ],
  },
  {
    title: 'Правки командой',
    hint: 'Три модели правят код каждая в своей копии — вы сравниваете и применяете лучшее',
    targets: [
      { kind: 'model', id: '@smart' },
      { kind: 'model', id: '@default' },
      { kind: 'model', id: '@fast' },
    ],
    tools: ['files_read', 'files_write', 'code', 'terminal'],
    isolate: true,
  },
  {
    title: 'Спор с собой',
    hint: 'Аналитик против адвоката дьявола',
    targets: [
      { kind: 'agent', id: 'analyst' },
      { kind: 'agent', id: 'devil' },
    ],
  },
]

const PROMPTS = [
  { icon: Scale, text: 'Сравни PostgreSQL и MongoDB для интернет-магазина: что выбрать и почему?' },
  { icon: Code2, text: 'Напиши на TypeScript функцию debounce с отменой и тестами.' },
  { icon: Lightbulb, text: 'Предложи 5 идей пет-проекта, который можно сделать за выходные.' },
  { icon: BrainCircuit, text: 'Объясни, как работает механизм внимания в трансформерах, на пальцах.' },
]

export function EmptyChat({ onPick, onPreset }: { onPick: (t: string) => void; onPreset: (preset: ChatPreset) => void }) {
  return (
    <div className="forge-glow flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <h2 className="text-center text-3xl font-semibold tracking-tight md:text-4xl">
          Что <span className="ember-text">выкуем</span> сегодня?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[15px] text-muted">Задайте вопрос одной модели или сразу нескольким — ответы придут параллельно, а судья соберёт из них лучший.</p>

        <div className="mt-8 grid grid-cols-2 gap-2 md:grid-cols-3">
          {PRESETS.map((p) => (
            <button key={p.title} onClick={() => onPreset({ targets: p.targets, tools: p.tools, isolate: p.isolate })} className="rounded-xl border border-border bg-surface/70 px-3 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-surface">
              <div className="text-[13px] font-semibold">{p.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted">{p.hint}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-2 md:grid-cols-2">
          {PROMPTS.map(({ icon: Icon, text }) => (
            <button key={text} onClick={() => onPick(text)} className="group flex items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg">
              <Icon className="mt-0.5 size-4 shrink-0 text-faint group-hover:text-accent" />
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
