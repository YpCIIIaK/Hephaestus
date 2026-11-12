import fs from 'node:fs/promises'
import path from 'node:path'
import type { LLMMessage, ToolsetId } from '../types'
import { getTerminalSettings, getToolsDir, getWorkspaceDir } from './settings'
import { currentScope } from './workspace-scope'
import { withFileLock } from './workspace'

// Память проекта — как CLAUDE.md у Claude Code: файл в корне рабочей папки с
// правилами, командами сборки и тестов, договорённостями. Он автоматически
// подключается к каждому запросу, где модель работает с файлами, а модель
// может дописывать в него заметки инструментом remember.

export const MEMORY_FILES = ['HEPHAESTUS.md', 'AGENTS.md', 'CLAUDE.md']
const MAX_MEMORY_CHARS = 12_000
const NOTES_HEADING = '## Заметки'

const PROJECT_TOOLS: ToolsetId[] = ['files_read', 'files_write', 'code', 'terminal']

export async function findMemoryFile(): Promise<{ name: string; abs: string; content: string } | null> {
  const root = await getWorkspaceDir()
  for (const name of MEMORY_FILES) {
    const abs = path.join(/* turbopackIgnore: true */ root, name)
    const content = await fs.readFile(/* turbopackIgnore: true */ abs, 'utf8').catch(() => null)
    if (content != null) return { name, abs, content }
  }
  return null
}

/** Системный блок о рабочей папке и память проекта — только когда модель работает с проектом */
export async function projectContext(tools: ToolsetId[] | undefined): Promise<string> {
  if (!tools?.some((t) => PROJECT_TOOLS.includes(t))) return ''
  const [root, terminal, memory] = await Promise.all([getWorkspaceDir(), getTerminalSettings(), findMemoryFile()])
  const os = process.platform === 'win32' ? 'Windows (cmd.exe)' : process.platform === 'darwin' ? 'macOS (bash)' : 'Linux (bash)'
  const lines = [
    `Ты работаешь с проектом в рабочей папке ${root}. Пути в инструментах — относительно неё.`,
    `ОС: ${os}. Терминал: ${terminal.mode === 'full' && tools.includes('terminal') ? `доступен (run_command, лимит ${terminal.timeoutSec} с на команду)` : 'недоступен'}.`,
    'Сначала изучи нужные файлы, потом действуй. Не выдумывай содержимое файлов — читай их.',
  ]
  if (currentScope()?.sandbox) {
    lines.push('Это твоя отдельная копия проекта: другие модели работают в своих копиях, а твои правки попадут в проект, только когда пользователь их примет. Делай законченные правки и проверяй их тестами.')
  }
  if (memory) {
    const text = memory.content.length > MAX_MEMORY_CHARS ? memory.content.slice(0, MAX_MEMORY_CHARS) + '\n…[обрезано]' : memory.content
    lines.push(`\nПамять проекта — файл ${memory.name} (правила и договорённости, следуй им):\n<project_memory>\n${text.trim()}\n</project_memory>`)
  }
  if (tools.includes('files_write')) lines.push('Узнал важное и неочевидное о проекте (команды сборки, договорённости, решения пользователя) — сохрани это инструментом remember.')
  lines.push(await capabilities(tools, terminal.mode === 'full'))
  return lines.join('\n')
}

const listDir = (dir: string) =>
  fs
    .readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true })
    .then((es) => es.filter((e) => !e.name.startsWith('.')).map((e) => e.name).sort())
    .catch(() => [] as string[])

/**
 * Что модель реально может сделать — иначе она отвечает «не могу посмотреть
 * репозиторий», хотя может склонировать его и запустить нужную утилиту.
 */
async function capabilities(tools: ToolsetId[], terminal: boolean): Promise<string> {
  const dir = getToolsDir()
  const [repos, bins, venv] = await Promise.all([listDir(path.join(dir, 'repos')), listDir(path.join(dir, 'bin')), listDir(path.join(dir, 'venv'))])
  const can: string[] = []
  if (tools.includes('files_read') || tools.includes('code')) can.push('читать и искать по коду проекта и общей папки инструментов: пути вида @tools/… работают в list_files, read_file, search_code, find_files')
  if (tools.includes('files_write')) can.push('создавать, править, перемещать и удалять файлы')
  if (tools.includes('terminal') && terminal) {
    can.push(
      'клонировать любой публичный репозиторий инструментом git_clone: утилиты — в общую папку @tools/repos (into: tools), проекты для работы и анализа — в repos/ рабочей папки (into: workspace); повторный git_clone не качает заново, а обновляет',
      'выполнять команды (run_command, фоновые — start_process): ставить зависимости, собирать, запускать тесты и утилиты; cwd может быть подпапкой или @tools/…',
      'ставить инструменты один раз для всех проектов: `npm i -g <пакет>` идёт в общую папку @tools (её bin уже в PATH); для Python — общее окружение `python3 -m venv "$HEPHAESTUS_TOOLS/venv"` (создай один раз, дальше `pip install` в него — оно тоже в PATH). Кэши npm и pip общие',
    )
  }
  if (tools.includes('web')) can.push('искать в интернете и читать страницы (web_search, fetch_url)')
  const have = [
    repos.length ? `репозитории в @tools/repos: ${repos.slice(0, 30).join(', ')}` : '',
    bins.length ? `команды в @tools/bin: ${bins.slice(0, 30).join(', ')}` : '',
    venv.length ? 'общее Python-окружение @tools/venv уже создано' : '',
  ].filter(Boolean)
  const lines = [`\nТвои возможности:\n${can.map((c) => `- ${c}`).join('\n')}`]
  if (have.length) lines.push(`Уже установлено в общей папке инструментов (не скачивай заново): ${have.join('; ')}.`)
  if (tools.includes('terminal') && terminal) {
    lines.push(
      'Если просят взять инструмент по ссылке и что-то им проверить (например, «возьми github.com/owner/tool и просканируй репозиторий X, составь отчёт»): склонируй инструмент в @tools, прочитай его README, поставь зависимости и собери один раз, склонируй или найди проверяемый репозиторий, запусти инструмент, прочитай результат и составь отчёт по пунктам. Не отвечай, что не можешь, — у тебя есть всё для этого.',
    )
  }
  return lines.join('\n')
}

export function withSystemBlock(messages: LLMMessage[], block: string): LLMMessage[] {
  if (!block) return messages
  const msgs = [...messages]
  if (msgs[0]?.role === 'system') msgs[0] = { ...msgs[0], content: `${msgs[0].content ?? ''}\n\n${block}`.trim() }
  else msgs.unshift({ role: 'system', content: block })
  return msgs
}

/** Дописывает заметку в раздел «Заметки» файла памяти; создаёт HEPHAESTUS.md, если памяти ещё нет */
export async function remember(note: string): Promise<string> {
  const clean = note.trim().replace(/\s*\n\s*/g, ' ')
  if (!clean) throw new Error('Пустая заметка')
  if (clean.length > 1000) throw new Error('Заметка слишком длинная — сократите до сути (до 1000 символов)')
  const existing = await findMemoryFile()
  const abs = existing?.abs ?? path.join(/* turbopackIgnore: true */ await getWorkspaceDir(), MEMORY_FILES[0])
  const name = existing?.name ?? MEMORY_FILES[0]
  return withFileLock(abs, async () => {
    let content = await fs.readFile(/* turbopackIgnore: true */ abs, 'utf8').catch(() => '')
    if (content.includes(`- ${clean}`)) return `Уже есть в ${name}`
    const date = new Date().toISOString().slice(0, 10)
    const line = `- ${clean} _(${date})_`
    if (!content.trim()) content = `# Память проекта\n\nЭтот файл Hephaestus подключает к каждому запросу моделей, работающих с проектом.\n\n${NOTES_HEADING}\n\n${line}\n`
    else if (!content.includes(NOTES_HEADING)) content = `${content.trimEnd()}\n\n${NOTES_HEADING}\n\n${line}\n`
    else {
      // Вставляем в конец раздела «Заметки» — до следующего заголовка второго уровня
      const start = content.indexOf(NOTES_HEADING) + NOTES_HEADING.length
      const next = content.slice(start).search(/\n## /)
      const at = next === -1 ? content.length : start + next
      content = `${content.slice(0, at).trimEnd()}\n${line}\n${content.slice(at)}`
    }
    await fs.writeFile(/* turbopackIgnore: true */ abs, content, 'utf8')
    return `Запомнено в ${name}`
  })
}
