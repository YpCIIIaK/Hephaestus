'use client'

import { create } from 'zustand'
import { runPipeline, type NodeRun, type Pipeline, type PipelineNode } from '../engine/pipeline'
import { getAgent } from '../stores/agents'
import { usePipelines } from '../stores/pipelines'
import { uid } from '../utils'
import { callLLM, callTool } from './llm'

// Запуск пайплайна из редактора: состояние узлов пишется в историю запусков,
// пошаговый режим ждёт нажатия «Дальше» перед каждым узлом.

interface RunnerState {
  active: Record<string, { runId: string; waitingFor?: string; step: boolean }>
  set: (pipelineId: string, v: RunnerState['active'][string] | null) => void
}

export const usePipelineRunner = create<RunnerState>((set) => ({
  active: {},
  set: (id, v) =>
    set((s) => {
      const active = { ...s.active }
      if (v) active[id] = v
      else delete active[id]
      return { active }
    }),
}))

const controllers = new Map<string, AbortController>()
const stepResolvers = new Map<string, () => void>()

export function continueStep(pipelineId: string) {
  stepResolvers.get(pipelineId)?.()
}

export function stopPipeline(pipelineId: string) {
  controllers.get(pipelineId)?.abort()
  stepResolvers.get(pipelineId)?.()
}

export function setStepMode(pipelineId: string, step: boolean) {
  const cur = usePipelineRunner.getState().active[pipelineId]
  if (cur) usePipelineRunner.getState().set(pipelineId, { ...cur, step })
  if (!step) continueStep(pipelineId)
}

export async function startPipeline(pipeline: Pipeline, input: string, step = false) {
  const runId = uid('run')
  const ac = new AbortController()
  controllers.set(pipeline.id, ac)
  const store = usePipelines.getState()
  store.addRun({
    id: runId,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    input,
    status: 'running',
    startedAt: Date.now(),
    nodes: Object.fromEntries(pipeline.nodes.map((n) => [n.id, { status: 'idle' as const }])),
    usage: { promptTokens: 0, completionTokens: 0, cost: 0 },
  })
  const runner = usePipelineRunner.getState()
  runner.set(pipeline.id, { runId, step })

  const beforeNode = async (node: PipelineNode) => {
    const cur = usePipelineRunner.getState().active[pipeline.id]
    if (!cur?.step || node.kind === 'input' || ac.signal.aborted) return
    usePipelineRunner.getState().set(pipeline.id, { ...cur, waitingFor: node.id })
    await new Promise<void>((resolve) => stepResolvers.set(pipeline.id, resolve))
    stepResolvers.delete(pipeline.id)
    const after = usePipelineRunner.getState().active[pipeline.id]
    if (after) usePipelineRunner.getState().set(pipeline.id, { ...after, waitingFor: undefined })
  }

  // Поток токенов по узлам склеиваем, чтобы не перерисовывать холст на каждый токен
  const buffer = new Map<string, Partial<NodeRun>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    for (const [nodeId, patch] of buffer) usePipelines.getState().patchNodeRun(runId, nodeId, patch)
    buffer.clear()
  }
  const onNode = (nodeId: string, patch: Partial<NodeRun>) => {
    buffer.set(nodeId, { ...buffer.get(nodeId), ...patch })
    if (patch.status && patch.status !== 'running') flush()
    else timer ??= setTimeout(flush, 70)
  }

  try {
    const run = await runPipeline(
      pipeline,
      input,
      { llm: callLLM, tool: callTool, getAgent },
      { onNode, beforeNode },
      { signal: ac.signal, runId, concurrency: step ? 1 : 4 },
    )
    usePipelines.getState().patchRun(runId, { status: run.status, endedAt: run.endedAt, output: run.output, error: run.error, usage: run.usage })
    return run
  } finally {
    if (timer) clearTimeout(timer)
    flush()
    controllers.delete(pipeline.id)
    usePipelineRunner.getState().set(pipeline.id, null)
  }
}
