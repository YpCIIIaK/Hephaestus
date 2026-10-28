import type { ToolsetId } from './types'

export const TOOL_LABELS: Record<string, string> = {
  web_search: 'Поиск в сети',
  fetch_url: 'Чтение страницы',
  list_files: 'Список файлов',
  read_file: 'Чтение файла',
  write_file: 'Запись файла',
  edit_file: 'Правка файла',
  delete_file: 'Удаление',
  knowledge_search: 'База знаний',
  load_skill: 'Навык',
}

export const TOOLSET_INFO: Record<ToolsetId, { label: string; hint: string }> = {
  web: { label: 'Интернет', hint: 'Поиск и чтение веб-страниц' },
  files_read: { label: 'Чтение файлов', hint: 'Доступ на чтение к папке workspace' },
  files_write: { label: 'Запись файлов', hint: 'Создание и правка файлов в workspace' },
  knowledge: { label: 'База знаний', hint: 'Поиск по загруженным документам' },
  skills: { label: 'Навыки', hint: 'Инструкции из папки skills/' },
}

export const ALL_TOOLSETS: ToolsetId[] = ['web', 'knowledge', 'files_read', 'files_write', 'skills']
