'use client'

import { useState, useRef, useEffect } from 'react'
import { useArenaStore } from '@/lib/store'
import {
  createPipelineState,
  startPipeline,
  pausePipeline,
  resumePipeline,
  stopPipeline,
  resetPipeline,
  skipStep,
  getStepContext,
  recordStepResult,
  recordStepError,
  getProgress,
  getEstimatedTimeRemaining,
  cacheFile,
  isFileCached,
  getCachedFile,
  PipelineState,
  StepExecutionResult,
} from '@/lib/interactive-executor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Play,
  Pause,
  SkipForward,
  Square,
  RotateCcw,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FileText,
  Zap,
  Bot,
} from 'lucide-react'

const statusIcons: Record<string, any> = {
  idle: Clock,
  running: Loader2,
  completed: CheckCircle2,
  error: XCircle,
  skipped: SkipForward,
}

const statusColors: Record<string, string> = {
  idle: 'text-muted-foreground',
  running: 'text-blue-400',
  completed: 'text-green-400',
  error: 'text-red-400',
  skipped: 'text-yellow-400',
}

export function InteractivePipeline() {
  const { nodes, edges, knowledgeBase, interactivePipeline, setInteractivePipeline, updateInteractivePipeline } = useArenaStore()
  const [currentOutput, setCurrentOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Автоскролл вниз
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [currentOutput])

  // Инициализация пайплайна
  const handleInit = () => {
    if (nodes.length === 0) return

    // Собрать KB контент
    const kbContent = knowledgeBase.join('\n\n')

    const state = createPipelineState(
      'current',
      nodes,
      edges,
      kbContent
    )

    setInteractivePipeline(state)
    setCurrentOutput('')
  }

  // Загрузить файлы в кэш (один раз — не перечитываются)
  const loadFilesToCache = async (state: PipelineState) => {
    const filePaths = nodes
      .filter(n => n.type === 'file' && n.data.filePath)
      .map(n => n.data.filePath as string)

    for (const filePath of filePaths) {
      if (isFileCached(state, filePath)) continue

      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
        })

        if (res.ok) {
          const data = await res.json()
          cacheFile(state, filePath, data.content)
        }
      } catch (e) {
        console.warn(`Failed to cache file: ${filePath}`, e)
      }
    }
  }

  // Выполнить один шаг
  const executeStep = async (state: PipelineState) => {
    const currentStep = state.steps[state.currentStepIndex]
    if (!currentStep) return

    const currentNode = nodes.find(n => n.id === currentStep.nodeId)
    if (!currentNode) return

    // Получить контекст (результаты предыдущих шагов + KB)
    const context = getStepContext(state, nodes, edges)

    // Собрать промпт
    const systemPrompt = currentNode.data.model?.systemPrompt || ''
    const userPrompt = currentNode.data.prompt
      ? (currentNode.data.prompt as string).replace(/{{input}}/g, context).replace(/{{context}}/g, context)
      : context || 'Analyze the input and provide your response.'

    const modelId = currentNode.data.model?.id || 'google/gemma-2-2b-it:free'
    const temperature = currentNode.data.model?.temperature ?? 0.3
    const maxTokens = currentNode.data.model?.maxTokens ?? 500

    // Добавить информацию о кэшированных файлах
    const cachedFiles = Object.keys(state.fileCache)
    let fileInfo = ''
    if (cachedFiles.length > 0) {
      fileInfo = `\n\n[Cached Files (already loaded, not re-reading):]\n${cachedFiles.map(f => `- ${f}`).join('\n')}`
    }

    const fullPrompt = userPrompt + fileInfo

    setIsStreaming(true)
    setCurrentOutput(prev => prev + `\n\n▶️ [${currentNode.data.label}] Starting...\n`)

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/pipeline/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          modelId,
          systemPrompt,
          userPrompt: fullPrompt,
          temperature,
          maxTokens,
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        throw new Error(error)
      }

      // Stream response
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        fullText += text
        setCurrentOutput(prev => {
          // Заменить последнюю строку на актуальный текст
          const lines = prev.split('\n')
          if (lines[lines.length - 1]?.startsWith('▶️')) {
            return prev + text
          }
          return prev + text
        })
      }

      // Записать результат
      const tokens = Math.ceil(fullText.length / 3.5)
      const result: StepExecutionResult = {
        nodeId: currentStep.nodeId,
        status: 'completed',
        result: fullText,
        tokens,
        latencyMs: Date.now() - (currentStep.startTime || Date.now()),
      }

      recordStepResult(state, result)
      updateInteractivePipeline({ ...state })

      setCurrentOutput(prev => prev + `\n✅ [${currentNode.data.label}] Completed (${tokens} tokens)\n`)

    } catch (error: any) {
      if (error.name === 'AbortError') {
        setCurrentOutput(prev => prev + `\n⏸️ [${currentNode.data.label}] Paused\n`)
        return
      }

      recordStepError(state, currentStep.nodeId, error.message)
      updateInteractivePipeline({ ...state })
      setCurrentOutput(prev => prev + `\n❌ [${currentNode.data.label}] Error: ${error.message}\n`)
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  // Старт
  const handleStart = async () => {
    if (!interactivePipeline) {
      handleInit()
      return
    }

    const state = startPipeline(interactivePipeline, nodes, edges)
    setInteractivePipeline({ ...state })
    setCurrentOutput('🚀 Pipeline started\n')

    // Загрузить файлы в кэш
    setIsLoadingFiles(true)
    await loadFilesToCache(state)
    setIsLoadingFiles(false)

    // Выполнить первый шаг
    await executeStep(state)
  }

  // Пауза
  const handlePause = () => {
    if (!interactivePipeline) return

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const state = pausePipeline(interactivePipeline)
    setInteractivePipeline({ ...state })
    setCurrentOutput(prev => prev + '\n⏸️ Pipeline paused\n')
  }

  // Продолжить
  const handleResume = async () => {
    if (!interactivePipeline) return

    const state = resumePipeline(interactivePipeline)
    setInteractivePipeline({ ...state })
    setCurrentOutput(prev => prev + '\n▶️ Pipeline resumed\n')

    // Выполнить следующий шаг
    await executeStep(state)
  }

  // Остановить
  const handleStop = () => {
    if (!interactivePipeline) return

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const state = stopPipeline(interactivePipeline)
    setInteractivePipeline({ ...state })
    setCurrentOutput(prev => prev + '\n⏹️ Pipeline stopped\n')
  }

  // Сбросить
  const handleReset = () => {
    if (!interactivePipeline) return

    const state = resetPipeline(interactivePipeline)
    setInteractivePipeline({ ...state })
    setCurrentOutput('')
  }

  // Пропустить шаг
  const handleSkip = async () => {
    if (!interactivePipeline) return

    const state = skipStep(interactivePipeline)
    setInteractivePipeline({ ...state })
    setCurrentOutput(prev => prev + `\n⏭️ Step skipped\n`)

    // Выполнить следующий шаг
    if (state.status === 'running') {
      await executeStep(state)
    }
  }

  const progress = interactivePipeline ? getProgress(interactivePipeline) : null
  const eta = interactivePipeline ? getEstimatedTimeRemaining(interactivePipeline) : null

  const formatEta = (ms: number) => {
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-yellow-400" />
          <div>
            <h3 className="font-medium">Interactive Pipeline</h3>
            <p className="text-xs text-muted-foreground">
              {nodes.length} nodes, {edges.length} edges
            </p>
          </div>
        </div>

        {/* Status */}
        {interactivePipeline && (
          <Badge variant={
            interactivePipeline.status === 'running' ? 'default' :
            interactivePipeline.status === 'paused' ? 'secondary' :
            interactivePipeline.status === 'completed' ? 'outline' :
            interactivePipeline.status === 'error' ? 'destructive' :
            'secondary'
          }>
            {interactivePipeline.status === 'running' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            {interactivePipeline.status}
          </Badge>
        )}
      </div>

      {/* Progress */}
      {progress && (
        <div className="p-4 border rounded-lg bg-card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span>Progress</span>
            <span>{progress.completed}/{progress.total} ({progress.percentage}%)</span>
          </div>
          <Progress value={progress.percentage} className="h-2" />

          {progress.currentStep && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ChevronRight className="w-3 h-3" />
              <span>Current: {progress.currentStep.label}</span>
            </div>
          )}

          {eta && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>ETA: {formatEta(eta)}</span>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 p-4 border rounded-lg bg-card">
        {!interactivePipeline || interactivePipeline.status === 'idle' ? (
          <Button onClick={handleStart} disabled={nodes.length === 0 || isLoadingFiles} className="flex-1">
            {isLoadingFiles ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading files...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" />Start Pipeline</>
            )}
          </Button>
        ) : (
          <>
            {interactivePipeline.status === 'running' && (
              <Button variant="outline" onClick={handlePause} className="flex-1">
                <Pause className="w-4 h-4 mr-2" />Pause
              </Button>
            )}
            {interactivePipeline.status === 'paused' && (
              <Button onClick={handleResume} className="flex-1">
                <Play className="w-4 h-4 mr-2" />Resume
              </Button>
            )}
            {interactivePipeline.status === 'running' && (
              <Button variant="secondary" onClick={handleSkip}>
                <SkipForward className="w-4 h-4" />
              </Button>
            )}
            <Button variant="destructive" onClick={handleStop}>
              <Square className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      {/* Steps List */}
      {interactivePipeline && (
        <div className="border rounded-lg bg-card">
          <div className="p-3 border-b">
            <h4 className="text-sm font-medium">Steps</h4>
          </div>
          <ScrollArea className="h-40">
            <div className="p-2 space-y-1">
              {interactivePipeline.steps.map((step, i) => {
                const Icon = statusIcons[step.status] || Clock
                const color = statusColors[step.status] || 'text-muted-foreground'
                const isCurrent = i === interactivePipeline.currentStepIndex

                return (
                  <div
                    key={step.nodeId}
                    className={`flex items-center gap-2 p-2 rounded text-xs ${
                      isCurrent ? 'bg-blue-500/10 border border-blue-500/20' : ''
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${color} ${step.status === 'running' ? 'animate-spin' : ''}`} />
                    <span className="flex-1 truncate">{step.label}</span>
                    {step.tokens && (
                      <Badge variant="outline" className="text-[10px]">{step.tokens}t</Badge>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Output */}
      <div className="flex-1 border rounded-lg bg-card flex flex-col min-h-0">
        <div className="p-3 border-b flex items-center gap-2">
          <Bot className="w-4 h-4" />
          <h4 className="text-sm font-medium">Output</h4>
          {isStreaming && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
        </div>
        <ScrollArea ref={outputRef} className="flex-1 p-3">
          <pre className="text-xs whitespace-pre-wrap font-mono">
            {currentOutput || 'Click "Start Pipeline" to begin...'}
          </pre>
        </ScrollArea>
      </div>

      {/* File Cache Info */}
      {interactivePipeline && Object.keys(interactivePipeline.fileCache).length > 0 && (
        <div className="p-3 border rounded-lg bg-green-500/5 border-green-500/20">
          <div className="flex items-center gap-2 text-xs text-green-400">
            <FileText className="w-3.5 h-3.5" />
            <span>Cached files (won't be re-read):</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {Object.keys(interactivePipeline.fileCache).map(path => (
              <div key={path} className="text-[10px] text-muted-foreground truncate">
                ✓ {path}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}