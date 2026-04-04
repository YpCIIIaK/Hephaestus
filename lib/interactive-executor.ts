/**
 * Interactive Pipeline Executor — пошаговое выполнение с паузой/продолжением
 * 
 * Ключевые особенности:
 * 1. Пошаговое выполнение — один узел за раз, как чат
 * 2. Пауза/Продолжить — остановить и продолжить без потери контекста
 * 3. Сохранение контекста — файлы и данные не перечитываются заново
 * 4. Переключение между пайплайнами с сохранением состояния
 */

import { ArenaNode, ArenaEdge, NodeStatus, PipelineStep } from './types'
import { getTopologicalOrder } from './executor'
import { getTokenCount } from './tokenizer'

// ==================== TYPES ====================

export interface PipelineState {
  id: string
  configId: string
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  currentStepIndex: number
  totalSteps: number
  steps: PipelineStep[]
  // Контекст, который сохраняется между шагами
  context: Record<string, string> // nodeId -> result
  // Загруженные файлы (кэш — не перечитываются)
  fileCache: Record<string, string> // filePath -> content
  // KB контент (кэш)
  kbContent: string
  // Abort controller для текущей операции
  abortController: AbortController | null
  // Время начала/паузы
  startedAt: number | null
  pausedAt: number | null
  totalPausedMs: number
  // Ошибка если есть
  error?: string
}

export interface StepExecutionResult {
  nodeId: string
  status: NodeStatus
  result: string
  tokens: number
  promptTokens?: number
  completionTokens?: number
  promptCost?: number
  completionCost?: number
  latencyMs: number
}

// ==================== STATE MANAGEMENT ====================

const pipelineStates = new Map<string, PipelineState>()
let activePipelineId: string | null = null

/** Создать новое состояние пайплайна */
export function createPipelineState(
  configId: string,
  nodes: ArenaNode[],
  edges: ArenaEdge[],
  kbContent: string = ''
): PipelineState {
  const topoOrder = getTopologicalOrder(nodes, edges)
  const steps: PipelineStep[] = topoOrder.map(nodeId => {
    const node = nodes.find(n => n.id === nodeId)!
    return {
      nodeId,
      label: node.data.label || node.label,
      type: node.type,
      status: 'idle' as NodeStatus,
    }
  })

  const state: PipelineState = {
    id: `pipeline-${Date.now()}`,
    configId,
    status: 'idle',
    currentStepIndex: 0,
    totalSteps: steps.length,
    steps,
    context: {},
    fileCache: {},
    kbContent,
    abortController: null,
    startedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
  }

  pipelineStates.set(state.id, state)
  activePipelineId = state.id
  return state
}

/** Получить состояние пайплайна */
export function getPipelineState(id: string): PipelineState | undefined {
  return pipelineStates.get(id)
}

/** Получить активный пайплайн */
export function getActivePipelineState(): PipelineState | undefined {
  if (!activePipelineId) return undefined
  return pipelineStates.get(activePipelineId)
}

/** Переключиться на другой пайплайн */
export function switchPipeline(id: string): PipelineState | undefined {
  const state = pipelineStates.get(id)
  if (state) {
    activePipelineId = id
  }
  return state
}

/** Удалить пайплайн */
export function removePipelineState(id: string): void {
  pipelineStates.delete(id)
  if (activePipelineId === id) {
    activePipelineId = null
  }
}

/** Получить все состояния */
export function getAllPipelineStates(): PipelineState[] {
  return Array.from(pipelineStates.values())
}

// ==================== EXECUTION CONTROL ====================

/** Запустить пайплайн (первый шаг) */
export function startPipeline(
  state: PipelineState,
  nodes: ArenaNode[],
  edges: ArenaEdge[]
): PipelineState {
  if (state.status === 'running') return state
  
  state.status = 'running'
  state.startedAt = Date.now()
  state.pausedAt = null
  state.totalPausedMs = 0
  state.abortController = new AbortController()
  state.currentStepIndex = 0

  // Обновить первый шаг
  if (state.steps.length > 0) {
    state.steps[0].status = 'running'
    state.steps[0].startTime = Date.now()
  }

  return state
}

/** Пауза пайплайна */
export function pausePipeline(state: PipelineState): PipelineState {
  if (state.status !== 'running') return state

  state.status = 'paused'
  state.pausedAt = Date.now()

  // Abort текущую операцию
  if (state.abortController) {
    state.abortController.abort()
    state.abortController = null
  }

  // Пометить текущий шаг как paused
  if (state.currentStepIndex < state.steps.length) {
    const step = state.steps[state.currentStepIndex]
    if (step.status === 'running') {
      step.status = 'idle' // Вернуть в idle для повторного запуска
      step.result = step.result ? `${step.result}\n\n[Paused]` : '[Paused]'
    }
  }

  return state
}

/** Продолжить пайплайн */
export function resumePipeline(state: PipelineState): PipelineState {
  if (state.status !== 'paused') return state

  state.status = 'running'
  
  // Посчитать время паузы
  if (state.pausedAt) {
    state.totalPausedMs += Date.now() - state.pausedAt
    state.pausedAt = null
  }

  // Новый abort controller
  state.abortController = new AbortController()

  // Найти первый невыполненный шаг
  const nextStepIndex = state.steps.findIndex(s => s.status === 'idle' || s.status === 'error')
  if (nextStepIndex >= 0) {
    state.currentStepIndex = nextStepIndex
    state.steps[nextStepIndex].status = 'running'
    state.steps[nextStepIndex].startTime = Date.now()
  } else {
    // Все шаги выполнены
    state.status = 'completed'
  }

  return state
}

/** Остановить пайплайн полностью */
export function stopPipeline(state: PipelineState): PipelineState {
  state.status = 'idle'
  
  if (state.abortController) {
    state.abortController.abort()
    state.abortController = null
  }

  // Сбросить все running/idle шаги
  for (const step of state.steps) {
    if (step.status === 'running' || step.status === 'idle') {
      step.status = 'idle'
    }
  }

  return state
}

/** Сбросить пайплайн (начать заново) */
export function resetPipeline(state: PipelineState): PipelineState {
  state.status = 'idle'
  state.currentStepIndex = 0
  state.context = {}
  state.startedAt = null
  state.pausedAt = null
  state.totalPausedMs = 0
  state.abortController = null
  state.error = undefined

  for (const step of state.steps) {
    step.status = 'idle'
    step.result = undefined
    step.tokens = undefined
    step.latencyMs = undefined
    step.startTime = undefined
    step.endTime = undefined
  }

  return state
}

// ==================== STEP EXECUTION ====================

/** Получить контекст для текущего шага */
export function getStepContext(
  state: PipelineState,
  nodes: ArenaNode[],
  edges: ArenaEdge[]
): string {
  const currentStep = state.steps[state.currentStepIndex]
  if (!currentStep) return ''

  const currentNode = nodes.find(n => n.id === currentStep.nodeId)
  if (!currentNode) return ''

  // Собрать результаты входных узлов
  const inputEdges = edges.filter(e => e.target === currentNode.id)
  const contextParts: string[] = []

  for (const edge of inputEdges) {
    const sourceResult = state.context[edge.source]
    if (sourceResult) {
      const sourceNode = nodes.find(n => n.id === edge.source)
      const label = sourceNode?.data.label || edge.source
      contextParts.push(`[${label}]:\n${sourceResult}`)
    }
  }

  // Добавить KB контент если есть
  if (state.kbContent) {
    contextParts.push(`[Knowledge Base]:\n${state.kbContent}`)
  }

  return contextParts.join('\n\n---\n\n')
}

/** Записать результат шага */
export function recordStepResult(
  state: PipelineState,
  result: StepExecutionResult
): PipelineState {
  const step = state.steps[state.currentStepIndex]
  if (!step) return state

  // Обновить шаг
  step.status = result.status
  step.result = result.result
  step.tokens = result.tokens
  step.latencyMs = result.latencyMs
  step.endTime = Date.now()
  step.promptTokens = result.promptTokens
  step.completionTokens = result.completionTokens
  step.promptCost = result.promptCost
  step.completionCost = result.completionCost

  // Сохранить в контекст
  state.context[result.nodeId] = result.result

  // Перейти к следующему шагу
  state.currentStepIndex++

  if (state.currentStepIndex >= state.steps.length) {
    // Все шаги выполнены
    state.status = 'completed'
  } else {
    // Подготовить следующий шаг
    const nextStep = state.steps[state.currentStepIndex]
    nextStep.status = 'running'
    nextStep.startTime = Date.now()
  }

  return state
}

/** Записать ошибку шага */
export function recordStepError(
  state: PipelineState,
  nodeId: string,
  error: string
): PipelineState {
  const step = state.steps[state.currentStepIndex]
  if (!step) return state

  step.status = 'error'
  step.result = error
  step.endTime = Date.now()

  state.status = 'error'
  state.error = error

  if (state.abortController) {
    state.abortController.abort()
    state.abortController = null
  }

  return state
}

/** Пропустить текущий шаг */
export function skipStep(state: PipelineState): PipelineState {
  const step = state.steps[state.currentStepIndex]
  if (!step) return state

  step.status = 'skipped'
  step.result = '[Skipped by user]'
  step.endTime = Date.now()

  // Перейти к следующему шагу
  state.currentStepIndex++

  if (state.currentStepIndex >= state.steps.length) {
    state.status = 'completed'
  } else {
    const nextStep = state.steps[state.currentStepIndex]
    nextStep.status = 'running'
    nextStep.startTime = Date.now()
  }

  return state
}

// ==================== FILE CACHE ====================

/** Добавить файл в кэш */
export function cacheFile(state: PipelineState, filePath: string, content: string): void {
  state.fileCache[filePath] = content
}

/** Получить файл из кэша */
export function getCachedFile(state: PipelineState, filePath: string): string | undefined {
  return state.fileCache[filePath]
}

/** Проверить кэш */
export function isFileCached(state: PipelineState, filePath: string): boolean {
  return filePath in state.fileCache
}

// ==================== PROGRESS ====================

export function getProgress(state: PipelineState): {
  completed: number
  total: number
  percentage: number
  currentStep: PipelineStep | null
} {
  const completed = state.steps.filter(s => s.status === 'completed').length
  const currentStep = state.steps[state.currentStepIndex] || null
  
  return {
    completed,
    total: state.steps.length,
    percentage: state.steps.length > 0 ? Math.round((completed / state.steps.length) * 100) : 0,
    currentStep,
  }
}

export function getEstimatedTimeRemaining(state: PipelineState): number | null {
  if (!state.startedAt || state.steps.length === 0) return null
  
  const completed = state.steps.filter(s => s.status === 'completed' || s.status === 'error').length
  if (completed === 0) return null

  const elapsed = Date.now() - state.startedAt - state.totalPausedMs
  const avgTimePerStep = elapsed / completed
  const remaining = state.steps.length - completed
  
  return Math.round(avgTimePerStep * remaining)
}