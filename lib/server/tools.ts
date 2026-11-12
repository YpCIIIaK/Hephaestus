import type { ToolsetId } from '../types'
import { formatKnowledgeHits, searchKnowledge } from './knowledge'
import { getSkill, listSkills, skillsCatalogText } from './skills'
import { webSearch } from './search'
import { fetchPage, formatSearchResults } from './web'
import { codebaseSearch, findFiles, formatCodeHits, formatGrepHits, searchCode } from './code-search'
import { getTerminalSettings } from './settings'
import { formatCommandResult, listBackground, readBackground, runCommand, startBackground, stopBackground } from './terminal'
import {
  deleteWorkspacePath,
  editWorkspaceFile,
  flattenTree,
  listTree,
  moveWorkspacePath,
  numberLines,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './workspace'

// Инструменты, которые модель может вызывать (OpenAI function calling).
// Наборы включаются переключателями в интерфейсе.

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
  }
}

const str = (description: string) => ({ type: 'string', description })
const int = (description: string) => ({ type: 'integer', description })
const bool = (description: string) => ({ type: 'boolean', description })

function def(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } }
}

const TOOLSETS: Record<ToolsetId, ToolDefinition[]> = {
  web: [
    def('web_search', 'Поиск в интернете. Возвращает заголовки, ссылки и сниппеты.', { query: str('Поисковый запрос') }, ['query']),
    def('fetch_url', 'Загрузить веб-страницу и получить её текст. Используй после web_search, чтобы прочитать источник.', { url: str('Полный URL') }, ['url']),
  ],
  files_read: [
    def(
      'list_files',
      'Файлы рабочей папки (без node_modules, .git и сборок). Для большого проекта начни с depth 2 и смотри подпапки отдельно.',
      { path: str('Подпапка, по умолчанию корень'), depth: int('Глубина обхода, по умолчанию без ограничения') },
    ),
    def(
      'read_file',
      'Прочитать файл рабочей папки. Строки пронумерованы («12│ текст»), номера не входят в текст файла. Для больших файлов укажи диапазон строк.',
      { path: str('Путь относительно рабочей папки'), start_line: int('Первая строка (с 1)'), end_line: int('Последняя строка') },
      ['path'],
    ),
  ],
  files_write: [
    def('write_file', 'Создать или полностью перезаписать файл. Для небольших правок существующего файла используй edit_file.', { path: str('Путь'), content: str('Новое содержимое') }, ['path', 'content']),
    def(
      'edit_file',
      'Заменить фрагмент в файле. old_text — точный текст из файла (без номеров строк), должен встречаться ровно один раз; иначе добавь контекст или укажи replace_all.',
      { path: str('Путь'), old_text: str('Точный фрагмент, который заменить'), new_text: str('Новый фрагмент'), replace_all: bool('Заменить все вхождения') },
      ['path', 'old_text', 'new_text'],
    ),
    def('move_file', 'Переместить или переименовать файл или папку.', { from: str('Откуда'), to: str('Куда') }, ['from', 'to']),
    def('delete_file', 'Удалить файл или папку.', { path: str('Путь') }, ['path']),
  ],
  code: [
    def(
      'search_code',
      'Точный поиск по коду (как grep/ripgrep): все строки, где встречается шаблон. Лучший способ найти определение, использования функции, текст ошибки.',
      {
        pattern: str('Регулярное выражение или текст'),
        literal: bool('Искать как обычный текст, а не регулярное выражение'),
        ignore_case: bool('Без учёта регистра'),
        glob: str('Маска файлов, например *.ts или src/**/*.py'),
        path: str('Подпапка или файл'),
        max_results: int('Максимум строк, по умолчанию 100'),
      },
      ['pattern'],
    ),
    def('find_files', 'Найти файлы по маске имени или пути, например *.test.ts или src/**/config.*', { glob: str('Маска'), path: str('Подпапка') }, ['glob']),
    def(
      'codebase_search',
      'Поиск по смыслу: найти места в коде по описанию на естественном языке («где проверяется авторизация», «parse config file»). Возвращает самые подходящие фрагменты с номерами строк.',
      { query: str('Что ищем'), limit: int('Сколько фрагментов, по умолчанию 8') },
      ['query'],
    ),
  ],
  terminal: [
    def(
      'run_command',
      'Выполнить команду в терминале в рабочей папке и дождаться завершения: тесты, сборка, линтер, git, установка зависимостей, запуск скриптов. Без интерактивного ввода. Для серверов и watch-режимов используй start_process.',
      { command: str('Команда оболочки'), cwd: str('Подпапка, где выполнить, по умолчанию корень'), timeout_sec: int('Лимит времени в секундах') },
      ['command'],
    ),
    def(
      'start_process',
      'Запустить долгий процесс в фоне (dev-сервер, watch) и сразу получить первые строки вывода и его id.',
      { command: str('Команда оболочки'), cwd: str('Подпапка') },
      ['command'],
    ),
    def('process_output', 'Новый вывод фонового процесса; без id — список фоновых процессов.', { id: str('id процесса, например p1') }),
    def('stop_process', 'Остановить фоновый процесс.', { id: str('id процесса') }, ['id']),
  ],
  knowledge: [
    def('knowledge_search', 'Поиск по базе знаний пользователя (загруженные документы). Возвращает релевантные фрагменты.', { query: str('Запрос'), limit: int('Сколько фрагментов, по умолчанию 5') }, ['query']),
  ],
  skills: [],
}

export async function buildTools(sets: ToolsetId[] | undefined): Promise<ToolDefinition[]> {
  if (!sets?.length) return []
  const tools: ToolDefinition[] = []
  for (const s of new Set(sets)) {
    // Выключенный терминал модели не предлагаем вовсе
    if (s === 'terminal' && (await getTerminalSettings()).mode === 'off') continue
    if (s === 'skills') {
      const skills = await listSkills()
      if (skills.length) {
        tools.push(
          def(
            'load_skill',
            `Загрузить инструкцию навыка, когда задача ему соответствует. Доступные навыки:\n${skillsCatalogText(skills)}`,
            { skill: { type: 'string', enum: skills.map((x) => x.id), description: 'id навыка' } },
            ['skill'],
          ),
        )
      }
    } else {
      tools.push(...TOOLSETS[s])
    }
  }
  return tools
}

const MAX_TOOL_OUTPUT = 16_000

/** Обрезает длинный вывод, сохраняя начало и конец: в конце обычно итог и ошибки */
function clip(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT) return s
  const head = Math.floor(MAX_TOOL_OUTPUT * 0.3)
  return `${s.slice(0, head)}\n…[пропущено ${s.length - MAX_TOOL_OUTPUT} символов]…\n${s.slice(-(MAX_TOOL_OUTPUT - head))}`
}

/** Выполняет инструмент. Ошибки возвращаются текстом, чтобы модель могла исправиться */
export async function runTool(name: string, rawArgs: string | Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
  let args: Record<string, unknown>
  try {
    args = typeof rawArgs === 'string' ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : rawArgs
  } catch {
    return { ok: false, output: `Аргументы не являются корректным JSON: ${String(rawArgs).slice(0, 200)}` }
  }
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : args[k] == null ? '' : String(args[k]))
  const n = (k: string) => (args[k] == null || args[k] === '' ? undefined : Number(args[k]))
  try {
    switch (name) {
      case 'web_search': {
        const q = s('query')
        return { ok: true, output: formatSearchResults(q, await webSearch(q, 6, signal)) }
      }
      case 'fetch_url':
        return { ok: true, output: await fetchPage(s('url'), 12_000, signal) }
      case 'list_files': {
        const files = flattenTree(await listTree(s('path'), n('depth') ?? Infinity))
        return { ok: true, output: clip(files.length ? files.join('\n') : 'Папка пуста.') }
      }
      case 'read_file': {
        const start = n('start_line') ?? 1
        const r = await readWorkspaceFile(s('path'), { startLine: n('start_line'), endLine: n('end_line') })
        const range = n('start_line') || n('end_line') ? `, показаны строки ${start}–${start + r.content.split('\n').length - 1}` : ''
        return { ok: true, output: clip(`${r.path} (${r.totalLines} строк${range})\n\n${numberLines(r.content, start)}`) }
      }
      case 'write_file': {
        const r = await writeWorkspaceFile(s('path'), s('content'))
        return { ok: true, output: `${r.created ? 'Создан' : 'Перезаписан'} ${r.path} (${r.bytes} байт)` }
      }
      case 'edit_file': {
        const r = await editWorkspaceFile(s('path'), s('old_text'), s('new_text'), { replaceAll: args.replace_all === true })
        return { ok: true, output: `Изменён ${r.path}${r.replacements > 1 ? ` (замен: ${r.replacements})` : ''}` }
      }
      case 'move_file': {
        const r = await moveWorkspacePath(s('from'), s('to'))
        return { ok: true, output: `Перемещено: ${r.from} → ${r.to}` }
      }
      case 'search_code': {
        const max = n('max_results') ?? 100
        const hits = await searchCode(s('pattern'), {
          literal: args.literal === true,
          ignoreCase: args.ignore_case === true,
          glob: s('glob') || undefined,
          path: s('path') || undefined,
          maxResults: max,
          signal,
        })
        return { ok: true, output: clip(formatGrepHits(s('pattern'), hits, max)) }
      }
      case 'find_files': {
        const files = await findFiles(s('glob'), s('path'))
        return { ok: true, output: files.length ? files.join('\n') : `Файлов по маске «${s('glob')}» нет.` }
      }
      case 'codebase_search': {
        const q = s('query')
        return { ok: true, output: clip(formatCodeHits(q, await codebaseSearch(q, n('limit') ?? 8))) }
      }
      case 'run_command': {
        const r = await runCommand(s('command'), { cwd: s('cwd') || undefined, timeoutSec: n('timeout_sec'), signal })
        return { ok: !r.timedOut && r.exitCode === 0, output: clip(formatCommandResult(r)) }
      }
      case 'start_process': {
        const r = await startBackground(s('command'), s('cwd') || undefined)
        return { ok: true, output: clip(r.output) }
      }
      case 'process_output':
        return { ok: true, output: clip(s('id') ? readBackground(s('id')) : listBackground()) }
      case 'stop_process':
        return { ok: true, output: stopBackground(s('id')) }
      case 'delete_file': {
        const r = await deleteWorkspacePath(s('path'))
        return { ok: true, output: `Удалён ${r.path}` }
      }
      case 'knowledge_search': {
        const q = s('query')
        return { ok: true, output: clip(formatKnowledgeHits(q, await searchKnowledge(q, n('limit') ?? 5))) }
      }
      case 'load_skill': {
        const skill = await getSkill(s('skill'))
        if (!skill) return { ok: false, output: `Навык «${s('skill')}» не найден` }
        return { ok: true, output: `# Навык: ${skill.name}\n${skill.description}\n\n${skill.content}` }
      }
      default:
        return { ok: false, output: `Неизвестный инструмент: ${name}` }
    }
  } catch (e) {
    return { ok: false, output: `Ошибка: ${e instanceof Error ? e.message : String(e)}` }
  }
}
