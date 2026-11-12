import type { ToolsetId } from '../types'
import type { NodeConfig, Pipeline, PipelineEdge, PipelineNode } from './pipeline'

// Импорт «порядка действий» (runbook) из Markdown в пайплайн Кузницы.
// Формат как у ROUTINE.md/RUNBOOK.md: заголовок, вводный текст, раздел с
// правилами, нумерованные шаги, шаблон отчёта и чек-лист проверки. Каждый шаг
// становится узлом-агентом с инструментами, правила — общим системным
// промптом всех шагов, шаблон отчёта — финальным агентом, чек-лист — узлом
// проверки. Схему потом можно поправить в редакторе как обычный пайплайн.

interface Section {
  level: number
  title: string
  body: string
  children: Section[]
}

export interface RoutineImportOptions {
  id: string
  model?: string
  tools?: ToolsetId[]
  /** Куда сохранить отчёт в рабочей папке; пусто — не сохранять */
  reportPath?: string
  /** Больше шагов сворачиваются соседними парами, чтобы схема оставалась читаемой */
  maxSteps?: number
}

const RULES_RE = /(ground\s*rules|rules|constraints|principles|guidelines|do\s*not|never|правил|ограничен|принцип|запрет|нельзя)/i
const REPORT_RE = /(report|отч[её]т|итог|summary|output\s*format|pr\s*body)/i
const REVIEW_RE = /(review|reviewer|checklist|acceptance|как\s+проверя|проверка\s+(результата|работы)|критери)/i
const MAX_SYSTEM = 8000
const MAX_STEP = 6000
const DEFAULT_TOOLS: ToolsetId[] = ['files_read', 'files_write', 'code', 'terminal', 'web']
const COL = 300
const ROW = 170
const PER_ROW = 4

/** Разбор Markdown в дерево разделов; заголовки внутри блоков кода не считаются */
export function parseSections(md: string): { title: string; intro: string; sections: Section[] } {
  const root: Section = { level: 0, title: '', body: '', children: [] }
  const stack: Section[] = [root]
  let title = ''
  let fence = false
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h) {
      const level = h[1].length
      const text = h[2].trim()
      if (level === 1 && !title && root.children.length === 0) {
        title = text
        continue
      }
      const sec: Section = { level, title: text, body: '', children: [] }
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop()
      stack[stack.length - 1].children.push(sec)
      stack.push(sec)
      continue
    }
    stack[stack.length - 1].body += `${line}\n`
  }
  const trim = (s: Section) => {
    s.body = s.body.trim()
    s.children.forEach(trim)
  }
  root.children.forEach(trim)
  return { title, intro: root.body.trim(), sections: root.children }
}

/** Весь текст раздела вместе с подразделами */
function fullText(s: Section, depth = 0): string {
  const head = depth ? `${'#'.repeat(Math.min(6, s.level))} ${s.title}\n` : ''
  return [head + s.body, ...s.children.map((c) => fullText(c, depth + 1))].filter((t) => t.trim()).join('\n\n').trim()
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[обрезано]` : s)

/** «1.1 Add repos (target 100–200)» → «1.1 Add repos» */
function shortLabel(title: string): string {
  const clean = title
    .replace(/[`*_]/g, '')
    .replace(/\s*[(—–:].*$/, '')
    .trim()
  const base = clean || title
  return base.length > 48 ? `${base.slice(0, 47)}…` : base
}

interface Step {
  title: string
  text: string
}

/** Делит разделы на правила, шаги, шаблон отчёта и критерии проверки */
export function classify(sections: Section[]): { rules: string[]; steps: Step[]; report: string; review: string } {
  const rules: string[] = []
  const steps: Step[] = []
  let report = ''
  let review = ''
  const walk = (list: Section[], context: string) => {
    for (const s of list) {
      if (RULES_RE.test(s.title)) {
        rules.push(fullText(s, 1))
        continue
      }
      if (REVIEW_RE.test(s.title)) {
        review = [review, fullText(s)].filter(Boolean).join('\n\n')
        continue
      }
      if (REPORT_RE.test(s.title)) {
        report = [report, fullText(s)].filter(Boolean).join('\n\n')
        continue
      }
      // Раздел с подшагами: его собственный текст — общий контекст для подшагов
      if (s.children.length) {
        const ctx = [context, s.body ? `Из раздела «${s.title}»:\n${s.body}` : ''].filter(Boolean).join('\n\n')
        walk(s.children, ctx)
        continue
      }
      steps.push({ title: s.title, text: [context, s.body].filter(Boolean).join('\n\n') })
    }
  }
  walk(sections, '')
  return { rules, steps, report, review }
}

/** Слишком много шагов — соседние сливаются в один узел */
function squeeze(steps: Step[], max: number): Step[] {
  let list = steps
  while (list.length > max) {
    const next: Step[] = []
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i]
      const b = list[i + 1]
      next.push(b ? { title: `${shortLabel(a.title)} + ${shortLabel(b.title)}`, text: `## ${a.title}\n${a.text}\n\n## ${b.title}\n${b.text}` } : a)
    }
    list = next
  }
  return list
}

export function routineToPipeline(md: string, opts: RoutineImportOptions): Pipeline {
  const { title, intro, sections } = parseSections(md)
  const { rules, steps: rawSteps, report, review } = classify(sections)
  // Нет ни одного раздела — каждый пункт нумерованного списка становится шагом
  const steps = rawSteps.length ? rawSteps : listSteps(intro)
  if (!steps.length) throw new Error('Не нашли шагов: нужны заголовки разделов (## Шаг…) или нумерованный список')
  const squeezed = squeeze(steps, Math.max(2, opts.maxSteps ?? 12))
  const name = title || 'Импортированный порядок действий'
  const model = opts.model || '@default'
  const tools = opts.tools ?? DEFAULT_TOOLS

  const system = clip(
    [
      `Ты выполняешь порядок действий «${name}» по шагам: на каждом шаге — только свой шаг, работая инструментами в рабочей папке (команды, файлы, поиск). Не выдумывай результаты команд — запускай их и опирайся на реальный вывод. Если шаг выполнить нельзя (нет доступа, нет данных) — так и напиши, с причиной.`,
      intro && `Вводная часть документа:\n${intro}`,
      rules.length ? `Общие правила — соблюдай на каждом шаге:\n${rules.join('\n\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    MAX_SYSTEM,
  )

  const nodes: PipelineNode[] = []
  const edges: PipelineEdge[] = []
  let index = 0
  const place = () => {
    const i = index++
    const row = Math.floor(i / PER_ROW)
    // Змейка: чётные ряды слева направо, нечётные — справа налево
    const col = row % 2 === 0 ? i % PER_ROW : PER_ROW - 1 - (i % PER_ROW)
    return { x: col * COL, y: row * ROW }
  }
  const add = (id: string, kind: PipelineNode['kind'], label: string, config: NodeConfig = {}) => {
    nodes.push({ id, kind, label, position: place(), config })
    return id
  }
  const link = (source: string, target: string) => edges.push({ id: `e_${source}_${target}`, source, target, sourceHandle: null })

  let prev = add('in', 'input', 'Задача')
  const labels = new Set<string>(['Задача'])
  const unique = (l: string) => {
    let label = l
    for (let n = 2; labels.has(label); n++) label = `${l} (${n})`
    labels.add(label)
    return label
  }
  const stepLabels: string[] = []
  squeezed.forEach((step, i) => {
    const label = unique(shortLabel(step.title))
    stepLabels.push(label)
    const prompt = [
      'Задача пользователя: {{input}}',
      `Шаг ${i + 1} из ${squeezed.length}: ${step.title}`,
      clip(step.text, MAX_STEP),
      i ? 'Итог предыдущего шага:\n{{prev}}' : '',
      'Выполни этот шаг. В конце ответа — коротко: что сделано, ключевые цифры и факты, что не получилось и почему, что важно для следующих шагов.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const id = add(`s${i + 1}`, 'agent', label, { model, tools, systemPrompt: system, prompt, maxTokens: 4000, temperature: 0.3 })
    link(prev, id)
    prev = id
  })

  const results = stepLabels.map((l) => `### ${l}\n{{${l}}}`).join('\n\n')
  const reportPrompt = [
    'Задача пользователя: {{input}}',
    `Результаты шагов:\n\n${results}`,
    report
      ? `Составь итоговый отчёт строго по шаблону из документа, заполни каждый раздел реальными данными из результатов шагов. Чего нет в результатах — пиши «нет данных», не выдумывай:\n\n${clip(report, MAX_STEP)}`
      : 'Составь итоговый отчёт: что сделано на каждом шаге, ключевые цифры, проблемы, что не сделано и почему. Только реальные данные из результатов шагов.',
  ].join('\n\n')
  const reportId = add('report', 'agent', unique('Отчёт'), { model, tools: ['files_read', 'code'], prompt: reportPrompt, maxTokens: 6000, temperature: 0.2 })
  link(prev, reportId)
  prev = reportId

  if (review) {
    const id = add('check', 'validator', unique('Проверка отчёта'), {
      model,
      criteria: clip(`Отчёт должен пройти проверку из документа:\n${review}`, MAX_STEP),
      maxAttempts: 1,
    })
    link(prev, id)
    prev = id
  }
  if (opts.reportPath?.trim()) {
    const id = add('save', 'write', unique('Сохранить отчёт'), { path: opts.reportPath.trim() })
    link(prev, id)
    prev = id
  }
  const out = add('out', 'output', unique('Результат'), { template: `{{${nodes.find((n) => n.id === 'report')!.label}}}` })
  link(prev, out)

  const now = new Date().toISOString()
  return {
    id: opts.id,
    name: clip(name, 80).replace(/\n.*$/s, ''),
    emoji: '📋',
    description: `Импорт порядка действий: ${squeezed.length} ${squeezed.length === 1 ? 'шаг' : squeezed.length < 5 ? 'шага' : 'шагов'}${rules.length ? ', общие правила' : ''}${report ? ', шаблон отчёта' : ''}${review ? ', проверка' : ''}`,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  }
}

function listSteps(text: string): Step[] {
  const items = text.split('\n').reduce<Step[]>((acc, line) => {
    const m = line.match(/^\s*(\d+)[.)]\s+(.+)/)
    if (m) acc.push({ title: m[2].replace(/[*_`]/g, '').slice(0, 80), text: m[2] })
    else if (acc.length && line.trim()) acc[acc.length - 1].text += `\n${line.trim()}`
    return acc
  }, [])
  return items.length >= 2 ? items : []
}

/** Ссылка на файл GitHub → прямая ссылка на его содержимое */
export function rawGithubUrl(url: string): string {
  const m = url.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/(.+)$/)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url.trim()
}
