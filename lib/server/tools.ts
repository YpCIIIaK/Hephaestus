import type { ToolsetId } from '../types'
import { formatKnowledgeHits, searchKnowledge } from './knowledge'
import { getSkill, listSkills, skillsCatalogText } from './skills'
import { fetchPage, formatSearchResults, webSearch } from './web'
import {
  deleteWorkspacePath,
  editWorkspaceFile,
  flattenTree,
  listTree,
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

function def(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } }
}

const TOOLSETS: Record<ToolsetId, ToolDefinition[]> = {
  web: [
    def('web_search', 'Поиск в интернете. Возвращает заголовки, ссылки и сниппеты.', { query: str('Поисковый запрос') }, ['query']),
    def('fetch_url', 'Загрузить веб-страницу и получить её текст. Используй после web_search, чтобы прочитать источник.', { url: str('Полный URL') }, ['url']),
  ],
  files_read: [
    def('list_files', 'Список файлов в рабочей папке workspace.'),
    def(
      'read_file',
      'Прочитать файл из workspace. Для больших файлов укажи диапазон строк.',
      { path: str('Путь относительно workspace'), start_line: int('Первая строка (с 1)'), end_line: int('Последняя строка') },
      ['path'],
    ),
  ],
  files_write: [
    def('write_file', 'Создать или полностью перезаписать файл в workspace.', { path: str('Путь'), content: str('Новое содержимое') }, ['path', 'content']),
    def(
      'edit_file',
      'Заменить фрагмент в файле. old_text должен встречаться в файле ровно один раз.',
      { path: str('Путь'), old_text: str('Точный фрагмент, который заменить'), new_text: str('Новый фрагмент') },
      ['path', 'old_text', 'new_text'],
    ),
    def('delete_file', 'Удалить файл или папку в workspace.', { path: str('Путь') }, ['path']),
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

function clip(s: string): string {
  return s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + '\n…[вывод обрезан]' : s
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
        const files = flattenTree(await listTree())
        return { ok: true, output: files.length ? files.join('\n') : 'Папка workspace пуста.' }
      }
      case 'read_file': {
        const r = await readWorkspaceFile(s('path'), { startLine: n('start_line'), endLine: n('end_line') })
        return { ok: true, output: clip(`${r.path} (${r.totalLines} строк)\n\n${r.content}`) }
      }
      case 'write_file': {
        const r = await writeWorkspaceFile(s('path'), s('content'))
        return { ok: true, output: `${r.created ? 'Создан' : 'Перезаписан'} ${r.path} (${r.bytes} байт)` }
      }
      case 'edit_file': {
        const r = await editWorkspaceFile(s('path'), s('old_text'), s('new_text'))
        return { ok: true, output: `Изменён ${r.path}` }
      }
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
