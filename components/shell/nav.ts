import { Bot, ChartColumn, Library, MessageSquareText, Settings2, Swords, Telescope, Workflow, type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  hint: string
  icon: LucideIcon
}

export const NAV: NavItem[] = [
  { href: '/chat', label: 'Чат', hint: 'Сравнение моделей и агентов', icon: MessageSquareText },
  { href: '/forge', label: 'Кузница', hint: 'Визуальные пайплайны', icon: Workflow },
  { href: '/debates', label: 'Дебаты', hint: 'Модели спорят, судья решает', icon: Swords },
  { href: '/scenarios', label: 'Сценарии', hint: 'Прогноз последствий событий', icon: Telescope },
  { href: '/agents', label: 'Агенты', hint: 'Роли и навыки', icon: Bot },
  { href: '/knowledge', label: 'Знания', hint: 'Документы и файлы', icon: Library },
  { href: '/analytics', label: 'Аналитика', hint: 'Расходы и токены', icon: ChartColumn },
]

export const SETTINGS_NAV: NavItem = { href: '/settings', label: 'Настройки', hint: 'Ключи, модели, лимиты', icon: Settings2 }
