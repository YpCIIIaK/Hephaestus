import { create } from 'zustand'
import type { Pipeline } from '@/lib/engine/pipeline'

/** Черновик входа по пайплайну — общий для панели «Запуск» и настроек блока «Вход» */
export const useRunInputs = create<{ inputs: Record<string, string>; set: (id: string, v: string) => void }>((set) => ({
  inputs: {},
  set: (id, v) => set((s) => ({ inputs: { ...s.inputs, [id]: v } })),
}))

/** Подсказка, что писать во «Вход»: задаётся в блоке «Вход» */
export const inputHint = (pipeline: Pipeline) => pipeline.nodes.find((n) => n.kind === 'input')?.config.hint?.trim() || 'Вход пайплайна — {{input}}'
