'use client'

import { useEffect, useState } from 'react'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { FieldRow, Textarea } from '@/components/ui/field'
import { Dialog, Switch } from '@/components/ui/overlay'
import { DEFAULT_JUDGE, type ChatJudge } from '@/lib/engine/chat'
import { useSettings } from '@/lib/stores/settings'
import { cn } from '@/lib/utils'

/** Готовые инструкции для судьи — пользователь может взять и поправить */
const PRESETS: { title: string; text: string }[] = [
  { title: 'Лучший ответ', text: '' },
  { title: 'Общий вывод', text: 'Сведи ответы всех участников в один общий вывод: что они утверждают единогласно, где расходятся и почему. В конце — итоговая рекомендация.' },
  { title: 'Голосование', text: 'Определи, какой вариант поддерживает большинство участников. Покажи, кто за что, и итоговое решение по большинству голосов. Если голоса разделились поровну — скажи об этом и объясни, какой вариант сильнее аргументирован.' },
  { title: 'Таблица сравнения', text: 'Составь таблицу сравнения ответов: строки — ключевые пункты, столбцы — участники. Под таблицей — краткий вывод, у кого полнее и точнее.' },
  { title: 'Только согласованное', text: 'Выпиши только то, в чём согласны все участники. Всё спорное и упомянутое лишь одним участником перечисли отдельно как «требует проверки».' },
  { title: 'Поиск ошибок', text: 'Найди в ответах фактические и логические ошибки, противоречия между участниками и неподтверждённые утверждения. По каждой — кто ошибся и как правильно.' },
]

export function JudgeDialog({ open, onOpenChange, value, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; value: ChatJudge | undefined; onSave: (judge: ChatJudge) => void }) {
  const globalAuto = useSettings((s) => s.chat.autoJudge)
  const [draft, setDraft] = useState<ChatJudge>(() => value ?? { ...DEFAULT_JUDGE, enabled: globalAuto })
  // Каждый раз открываем с текущими настройками диалога
  useEffect(() => {
    if (open) setDraft(value ?? { ...DEFAULT_JUDGE, enabled: globalAuto })
  }, [open, value, globalAuto])
  const set = (patch: Partial<ChatJudge>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Судья диалога"
      description="Собирает ответы всех участников и делает вывод по вашей инструкции. Настройка действует только в этом диалоге."
      className="max-w-2xl"
      footer={
        <Button
          variant="primary"
          onClick={() => {
            onSave(draft)
            onOpenChange(false)
          }}
        >
          Сохранить
        </Button>
      }
    >
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-4 text-[13px]">
          <span>
            Запускать автоматически
            <span className="block text-xs text-muted">Когда все участники ответили. Иначе — кнопкой под ответами</span>
          </span>
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        </label>
        <FieldRow label="Модель судьи" hint="Пусто — модель судьи из общих настроек">
          <div className="flex gap-2">
            <ModelPicker value={draft.model} onChange={(model) => set({ model })} placeholder="Модель судьи из настроек" />
            {draft.model && (
              <Button variant="ghost" onClick={() => set({ model: '' })}>
                Сбросить
              </Button>
            )}
          </div>
        </FieldRow>
        <FieldRow label="Инструкция для вывода" hint="Пусто — сравнить ответы и собрать из них лучший. Со своей инструкцией судья работает и с одним участником, и в режиме «разные задачи»">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.title}
                  onClick={() => set({ instructions: p.text })}
                  className={cn('rounded-lg border px-2 py-1 text-xs', draft.instructions === p.text ? 'border-accent bg-accent-soft text-fg' : 'border-border text-muted hover:border-border-strong hover:text-fg')}
                >
                  {p.title}
                </button>
              ))}
            </div>
            <Textarea rows={5} value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Например: собери из ответов план работ по шагам и отметь, кто какой шаг предложил" />
          </div>
        </FieldRow>
        <label className="flex items-center justify-between gap-4 text-[13px]">
          <span>
            Оценки участникам
            <span className="block text-xs text-muted">Перед выводом судья ставит каждому участнику балл 0–10 с плюсами и минусами</span>
          </span>
          <Switch checked={draft.ranking} onCheckedChange={(ranking) => set({ ranking })} />
        </label>
      </div>
    </Dialog>
  )
}
