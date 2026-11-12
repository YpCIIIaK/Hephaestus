import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './paths'
import { withFileLock } from './workspace'

// Память сессии — заметки одного диалога. Результаты инструментов (прочитанный
// код, вывод команд) в историю диалога не попадают — иначе контекст
// переполнится за пару ходов. Поэтому модель сама записывает важное сюда:
// находки, пути, ключевые фрагменты, решения. Заметки подключаются к каждому
// следующему запросу этого диалога, их можно перенести в другой диалог.

const DIR = path.join(DATA_DIR, 'sessions')
const MAX_NOTE = 4000
/** Сколько памяти сессии подключать к запросу; старое обрезается с начала */
const MAX_CONTEXT = 20_000
const ID_RE = /^[\w-]{1,80}$/

export class SessionError extends Error {}

function fileOf(id: string): string {
  if (!ID_RE.test(id)) throw new SessionError('Некорректный id сессии')
  return path.join(DIR, `${id}.md`)
}

export async function readSession(id: string): Promise<string> {
  return fs.readFile(/* turbopackIgnore: true */ fileOf(id), 'utf8').catch(() => '')
}

export async function writeSession(id: string, text: string): Promise<void> {
  const file = fileOf(id)
  await fs.mkdir(/* turbopackIgnore: true */ DIR, { recursive: true })
  await withFileLock(file, () => fs.writeFile(/* turbopackIgnore: true */ file, text.trimEnd() + (text.trim() ? '\n' : ''), 'utf8'))
}

export async function appendSessionNote(id: string, note: string, author = ''): Promise<string> {
  const clean = note.trim()
  if (!clean) throw new SessionError('Пустая заметка')
  if (clean.length > MAX_NOTE) throw new SessionError(`Заметка длиннее ${MAX_NOTE} символов — сократи до сути или раздели на несколько`)
  const file = fileOf(id)
  await fs.mkdir(/* turbopackIgnore: true */ DIR, { recursive: true })
  return withFileLock(file, async () => {
    const current = await fs.readFile(/* turbopackIgnore: true */ file, 'utf8').catch(() => '')
    if (current.includes(clean)) return 'Уже есть в памяти сессии'
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const who = author.replace(/[\r\n#]/g, ' ').trim().slice(0, 60)
    await fs.writeFile(/* turbopackIgnore: true */ file, `${current.trimEnd()}${current.trim() ? '\n\n' : ''}### ${stamp}${who ? ` · ${who}` : ''}\n${clean}\n`, 'utf8')
    return 'Записано в память сессии'
  })
}

/** Переносит память одной сессии в другую (дописывает в конец), с необязательным дополнением */
export async function copySession(from: string, to: string, extra = ''): Promise<{ chars: number }> {
  const source = (await readSession(from)).trim()
  const add = [source, extra.trim()].filter(Boolean).join('\n\n')
  if (!add) return { chars: 0 }
  const current = (await readSession(to)).trim()
  await writeSession(to, `${current}${current ? '\n\n' : ''}## Перенесено из другого диалога\n\n${add}`)
  return { chars: add.length }
}

/** Системный блок с памятью сессии для запроса модели */
export async function sessionContext(id: string, canWrite: boolean): Promise<string> {
  const text = (await readSession(id)).trim()
  const clipped = text.length > MAX_CONTEXT ? `…[начало обрезано]\n${text.slice(-MAX_CONTEXT)}` : text
  const howto = canWrite
    ? 'Память сессии: результаты инструментов (прочитанный код, вывод команд) в следующих ходах этого диалога тебе не покажут — только краткий список действий. Всё, что понадобится дальше (найденные места в коде с путями и строками, ключевые фрагменты, выводы, решения, что осталось сделать), сразу записывай инструментом session_note.'
    : ''
  if (!clipped) return howto
  return `${howto}\nЗаписи памяти этого диалога (сделаны тобой или другими участниками раньше — опирайся на них, не говори, что прошлых данных у тебя нет):\n<session_memory>\n${clipped}\n</session_memory>`.trim()
}

export const SESSION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'session_note',
    description:
      'Записать в память этого диалога то, что понадобится в следующих ходах: найденные места в коде (путь:строка), ключевые фрагменты, результаты проверок, выводы, план. Результаты инструментов в следующих ходах не видны — только эти записи.',
    parameters: { type: 'object' as const, properties: { note: { type: 'string', description: 'Что запомнить — конкретно, с путями и цифрами' } }, required: ['note'] },
  },
}
