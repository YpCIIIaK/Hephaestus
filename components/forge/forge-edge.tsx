'use client'

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, type Edge, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'

export type ForgeEdgeData = { onDelete?: (id: string) => void }
export type ForgeFlowEdge = Edge<ForgeEdgeData, 'forge'>

/**
 * Связь между блоками. Клик по линии выделяет её — посередине появляется
 * кнопка «Удалить связь» (или Delete на клавиатуре). Широкая невидимая зона
 * вокруг линии, чтобы в неё было легко попасть мышью.
 */
export function ForgeEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style, data }: EdgeProps<ForgeFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  // Кнопка — обычного размера при любом масштабе схемы
  const zoom = useStore((s) => s.transform[2])
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={22} style={selected ? { ...style, stroke: 'var(--accent)', strokeWidth: 2.5 } : style} />
      {selected && data?.onDelete && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan pointer-events-auto absolute" style={{ transform: `translate(${labelX}px, ${labelY}px) scale(${1 / zoom}) translate(10px, -50%)`, transformOrigin: '0 0', zIndex: 1001 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                data.onDelete?.(id)
              }}
              className="flex items-center gap-1 rounded-lg border border-danger/40 bg-surface px-2 py-1 text-[11.5px] font-medium text-danger shadow-float hover:bg-danger/10"
            >
              <X className="size-3.5" /> Удалить связь
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
