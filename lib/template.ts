import { extractJson } from './json'

// Подстановка переменных в промпты пайплайнов:
//   {{input}}  — исходный запрос
//   {{prev}}   — выходы всех входящих узлов
//   {{Имя узла}} — выход конкретного узла по его названию (регистр не важен)
//   {{Имя узла.поле}} — поле из JSON-ответа узла, например {{Выбор репозитория.target}}

export interface TemplateContext {
  input: string
  prev: string
  byLabel: Record<string, string>
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  const labels = new Map(Object.entries(ctx.byLabel).map(([k, v]) => [k.trim().toLowerCase(), v]))
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.trim().toLowerCase()
    if (key === 'input' || key === 'вход') return ctx.input
    if (key === 'prev' || key === 'входы') return ctx.prev
    const hit = labels.get(key)
    if (hit != null) return hit
    // «Узел.поле» — поле JSON; точка может быть и в названии узла («1.1 Add repos»), поэтому сначала точное имя
    const dot = key.lastIndexOf('.')
    if (dot > 0) {
      const out = labels.get(key.slice(0, dot).trim())
      const data = out != null ? extractJson<Record<string, unknown>>(out) : null
      const field = rawKey.trim().slice(dot + 1).trim()
      const value = data && typeof data === 'object' && !Array.isArray(data) ? data[field] : undefined
      if (value != null) return typeof value === 'string' ? value : JSON.stringify(value)
    }
    return whole
  })
}

export function templateVariables(template: string): string[] {
  return Array.from(new Set(Array.from(template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (m) => m[1].trim())))
}
