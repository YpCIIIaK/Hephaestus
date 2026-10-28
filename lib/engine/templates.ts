import type { NodeConfig, NodeKind, Pipeline, PipelineEdge, PipelineNode } from './pipeline'

// Готовые пайплайны: стартовые точки, которые можно открыть и переделать.

type NodeSpec = [id: string, kind: NodeKind, label: string, col: number, row: number, config?: NodeConfig]
type EdgeSpec = [source: string, target: string, handle?: string]

const COL = 300
const ROW = 150

function build(spec: { id: string; name: string; emoji: string; description: string; nodes: NodeSpec[]; edges: EdgeSpec[] }): Pipeline {
  const nodes: PipelineNode[] = spec.nodes.map(([id, kind, label, col, row, config]) => ({
    id,
    kind,
    label,
    position: { x: col * COL, y: row * ROW },
    config: config ?? {},
  }))
  const edges: PipelineEdge[] = spec.edges.map(([source, target, handle], i) => ({ id: `e${i}_${source}_${target}`, source, target, sourceHandle: handle ?? null }))
  const now = new Date(0).toISOString()
  return { id: spec.id, name: spec.name, emoji: spec.emoji, description: spec.description, nodes, edges, createdAt: now, updatedAt: now }
}

export const PIPELINE_TEMPLATES: Pipeline[] = [
  build({
    id: 'tpl-council',
    name: 'Совет трёх моделей',
    emoji: '🏛️',
    description: 'Три модели отвечают независимо, синтезатор собирает лучший ответ (mixture of agents)',
    nodes: [
      ['in', 'input', 'Вопрос', 0, 1],
      ['a', 'agent', 'Умная модель', 1, 0, { model: '@smart', temperature: 0.6 }],
      ['b', 'agent', 'Основная модель', 1, 1, { model: '@default', temperature: 0.7 }],
      ['c', 'agent', 'Быстрая модель', 1, 2, { model: '@fast', temperature: 0.8 }],
      ['syn', 'agent', 'Синтез', 2, 1, { agentId: 'synthesizer', prompt: 'Исходный вопрос:\n{{input}}\n\nОтветы экспертов:\n{{prev}}\n\nСоставь лучший итоговый ответ.' }],
      ['out', 'output', 'Результат', 3, 1],
    ],
    edges: [['in', 'a'], ['in', 'b'], ['in', 'c'], ['a', 'syn'], ['b', 'syn'], ['c', 'syn'], ['syn', 'out']],
  }),
  build({
    id: 'tpl-research',
    name: 'Исследование с проверкой',
    emoji: '🔎',
    description: 'Поиск в сети → исследователь пишет ответ со ссылками → проверка отправляет на доработку',
    nodes: [
      ['in', 'input', 'Вопрос', 0, 1],
      ['web', 'search', 'Поиск', 1, 1, { query: '{{input}}', readPages: 2 }],
      ['res', 'agent', 'Исследователь', 2, 1, { agentId: 'researcher', tools: [], prompt: 'Вопрос: {{input}}\n\nМатериалы из поиска:\n{{Поиск}}\n\nНапиши обстоятельный ответ, опираясь на материалы. Указывай ссылки на источники.' }],
      ['chk', 'validator', 'Проверка', 3, 1, { criteria: 'Ответ отвечает на вопрос, опирается на источники и приводит ссылки, не содержит выдумок.', maxAttempts: 2 }],
      ['out', 'output', 'Результат', 4, 1],
    ],
    edges: [['in', 'web'], ['web', 'res'], ['res', 'chk'], ['chk', 'out']],
  }),
  build({
    id: 'tpl-brainstorm',
    name: 'Идеи → критика → план',
    emoji: '💡',
    description: 'Два генератора идей, критик отсеивает слабые, стратег строит план',
    nodes: [
      ['in', 'input', 'Задача', 0, 1],
      ['g1', 'agent', 'Смелые идеи', 1, 0, { model: '@default', temperature: 1, systemPrompt: 'Ты — генератор смелых, нестандартных идей. Предложи 5 идей, о которых большинство не подумает.' }],
      ['g2', 'agent', 'Практичные идеи', 1, 2, { model: '@default', temperature: 0.6, systemPrompt: 'Ты — прагматик. Предложи 5 реалистичных идей, которые можно начать делать на этой неделе.' }],
      ['crit', 'agent', 'Критик', 2, 1, { agentId: 'critic', prompt: 'Задача: {{input}}\n\nИдеи:\n{{prev}}\n\nОцени каждую идею (1–10) по пользе и реализуемости, отбери 3 лучшие и объясни выбор.' }],
      ['plan', 'agent', 'План', 3, 1, { agentId: 'strategist', prompt: 'Задача: {{input}}\n\nОтобранные идеи и критика:\n{{Критик}}\n\nПреврати лучшие идеи в пошаговый план.' }],
      ['out', 'output', 'Результат', 4, 1],
    ],
    edges: [['in', 'g1'], ['in', 'g2'], ['g1', 'crit'], ['g2', 'crit'], ['crit', 'plan'], ['plan', 'out']],
  }),
  build({
    id: 'tpl-router',
    name: 'Умный маршрут',
    emoji: '🧭',
    description: 'Маршрутизатор отправляет запрос нужному специалисту: программисту, редактору или аналитику',
    nodes: [
      ['in', 'input', 'Запрос', 0, 1],
      [
        'r',
        'router',
        'Тип задачи',
        1,
        1,
        {
          routerMode: 'llm',
          routes: [
            { id: 'code', label: 'Код', keywords: 'программирование, код, баги, скрипты' },
            { id: 'text', label: 'Текст', keywords: 'написать, отредактировать, перевести текст' },
            { id: 'other', label: 'Анализ', keywords: 'всё остальное: вопросы, анализ, решения' },
          ],
        },
      ],
      ['dev', 'agent', 'Программист', 2, 0, { agentId: 'coder', tools: [] }],
      ['ed', 'agent', 'Редактор', 2, 1, { agentId: 'editor' }],
      ['an', 'agent', 'Аналитик', 2, 2, { agentId: 'analyst' }],
      ['out', 'output', 'Результат', 3, 1],
    ],
    edges: [['in', 'r'], ['r', 'dev', 'code'], ['r', 'ed', 'text'], ['r', 'an', 'other'], ['dev', 'out'], ['ed', 'out'], ['an', 'out']],
  }),
  build({
    id: 'tpl-kb',
    name: 'Ответ по базе знаний',
    emoji: '📚',
    description: 'Находит фрагменты в ваших документах и отвечает строго по ним',
    nodes: [
      ['in', 'input', 'Вопрос', 0, 0],
      ['kb', 'knowledge', 'Фрагменты', 1, 0, { query: '{{input}}', limit: 6 }],
      ['lib', 'agent', 'Ответ', 2, 0, { agentId: 'librarian', tools: [], prompt: 'Вопрос: {{input}}\n\nФрагменты из базы знаний:\n{{Фрагменты}}\n\nОтветь только по фрагментам и укажи документы-источники. Если ответа нет — так и скажи.' }],
      ['out', 'output', 'Результат', 3, 0],
    ],
    edges: [['in', 'kb'], ['kb', 'lib'], ['lib', 'out']],
  }),
  build({
    id: 'tpl-event',
    name: 'Анализ события',
    emoji: '🌐',
    description: 'Факты из сети, три отраслевых аналитика и стратегический синтез',
    nodes: [
      ['in', 'input', 'Событие', 0, 1],
      ['web', 'search', 'Факты', 1, 1, { query: '{{input}}', readPages: 1 }],
      ['pol', 'agent', 'Политика', 2, 0, { agentId: 'analyst', prompt: 'Событие: {{input}}\n\nФакты:\n{{Факты}}\n\nПроанализируй политические и дипломатические последствия.' }],
      ['eco', 'agent', 'Экономика', 2, 1, { agentId: 'analyst', prompt: 'Событие: {{input}}\n\nФакты:\n{{Факты}}\n\nПроанализируй экономические последствия: рынки, торговля, цены.' }],
      ['sec', 'agent', 'Безопасность', 2, 2, { agentId: 'analyst', prompt: 'Событие: {{input}}\n\nФакты:\n{{Факты}}\n\nПроанализируй риски безопасности и эскалации.' }],
      ['syn', 'agent', 'Стратегический синтез', 3, 1, { agentId: 'synthesizer', prompt: 'Событие: {{input}}\n\nОтраслевые анализы:\n{{prev}}\n\nСведи их в общую картину: три сценария с вероятностями, ключевые риски и что отслеживать.' }],
      ['out', 'output', 'Результат', 4, 1],
    ],
    edges: [['in', 'web'], ['web', 'pol'], ['web', 'eco'], ['web', 'sec'], ['pol', 'syn'], ['eco', 'syn'], ['sec', 'syn'], ['syn', 'out']],
  }),
  build({
    id: 'tpl-review',
    name: 'Ревью файла',
    emoji: '🧪',
    description: 'Читает файл из workspace (путь — во входе), делает ревью и сохраняет отчёт',
    nodes: [
      ['in', 'input', 'Путь к файлу', 0, 0],
      ['f', 'file', 'Код', 1, 0, { path: '{{input}}' }],
      ['rev', 'agent', 'Ревьюер', 2, 0, { model: '@smart', tools: ['skills'], systemPrompt: 'Ты — опытный ревьюер кода. Если есть навык code-review, загрузи его и следуй его формату.', prompt: 'Сделай ревью файла:\n\n{{Код}}' }],
      ['save', 'write', 'Сохранить отчёт', 3, 0, { path: 'reviews/{{input}}.md' }],
      ['out', 'output', 'Результат', 4, 0, { template: '{{Ревьюер}}' }],
    ],
    edges: [['in', 'f'], ['f', 'rev'], ['rev', 'save'], ['save', 'out']],
  }),
]

export function blankPipeline(id: string): Pipeline {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Новый пайплайн',
    emoji: '⚒️',
    description: '',
    nodes: [
      { id: 'in', kind: 'input', label: 'Вход', position: { x: 0, y: 0 }, config: {} },
      { id: 'agent', kind: 'agent', label: 'Агент', position: { x: COL, y: 0 }, config: { model: '@default' } },
      { id: 'out', kind: 'output', label: 'Результат', position: { x: COL * 2, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e_in_agent', source: 'in', target: 'agent' },
      { id: 'e_agent_out', source: 'agent', target: 'out' },
    ],
    createdAt: now,
    updatedAt: now,
  }
}
