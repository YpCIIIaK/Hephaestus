'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FieldRow, NativeSelect, Textarea } from '@/components/ui/field'
import { Dialog, Switch } from '@/components/ui/overlay'
import { api } from '@/lib/client/llm'
import { transferSession } from '@/lib/client/chat-runner'
import { useChats } from '@/lib/stores/chats'

/**
 * Память сессии: заметки, которые модели этого диалога записали сами
 * (session_note) или которые вписал пользователь. Подключаются к каждому
 * следующему запросу диалога; их можно перенести в другой диалог.
 */
export function SessionDialog({ open, onOpenChange, convId }: { open: boolean; onOpenChange: (v: boolean) => void; convId: string }) {
  const router = useRouter()
  const conversations = useChats((s) => s.conversations)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState('')
  const [target, setTarget] = useState('new')
  const [digest, setDigest] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    api<{ text: string }>(`/api/sessions?id=${encodeURIComponent(convId)}`)
      .then((r) => {
        if (!alive) return
        setText(r.text)
        setLoaded(r.text)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [open, convId])

  const save = async (value = text) => {
    await api('/api/sessions', { method: 'POST', json: { action: 'save', id: convId, text: value } })
    setLoaded(value)
  }

  const transfer = async () => {
    setBusy(true)
    try {
      if (text !== loaded) await save()
      const r = await transferSession(convId, target === 'new' ? null : target, digest)
      toast.success(r.chars ? `Перенесено ${r.chars.toLocaleString('ru')} символов` : 'Переносить нечего — память и диалог пусты')
      onOpenChange(false)
      router.push(`/chat?c=${r.to}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const others = conversations.filter((c) => c.id !== convId)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Память сессии"
      description="Заметки этого диалога: модели записывают сюда находки и выводы инструментом session_note и видят их в каждом следующем ходе. Можно поправить вручную."
      className="max-w-2xl"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!text.trim()}
            onClick={() => {
              setText('')
              void save('').then(() => toast.success('Память сессии очищена'))
            }}
          >
            Очистить
          </Button>
          <Button
            variant="primary"
            disabled={text === loaded}
            onClick={() =>
              void save()
                .then(() => toast.success('Сохранено'))
                .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
            }
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          className="font-mono text-xs"
          placeholder="Пока пусто. Модели с инструментами сами записывают сюда важное по ходу работы; можно вписать и своё — например, контекст задачи."
        />
        <FieldRow label="Перенести в другой диалог" hint="Память дописывается в конец памяти выбранного диалога — модели там увидят её в следующем ходе">
          <div className="space-y-2">
            <div className="flex gap-2">
              <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1">
                <option value="new">Новый диалог с теми же участниками</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </NativeSelect>
              <Button disabled={busy} onClick={() => void transfer()}>
                Перенести
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch checked={digest} onCheckedChange={setDigest} />
              Добавить выжимку диалога: резюме сжатий и последние 4 хода
            </label>
          </div>
        </FieldRow>
      </div>
    </Dialog>
  )
}
