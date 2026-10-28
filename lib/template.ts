// Подстановка переменных в промпты пайплайнов:
//   {{input}}  — исходный запрос
//   {{prev}}   — выходы всех входящих узлов
//   {{Имя узла}} — выход конкретного узла по его названию (регистр не важен)

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
    return hit ?? whole
  })
}

export function templateVariables(template: string): string[] {
  return Array.from(new Set(Array.from(template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (m) => m[1].trim())))
}
