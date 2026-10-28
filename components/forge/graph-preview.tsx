import type { Pipeline } from '@/lib/engine/pipeline'
import { NODE_STYLE } from './node-meta'

/** Миниатюра графа для карточек */
export function GraphPreview({ pipeline, className }: { pipeline: Pick<Pipeline, 'nodes' | 'edges'>; className?: string }) {
  const { nodes, edges } = pipeline
  if (!nodes.length) return <div className={className} />
  const xs = nodes.map((n) => n.position.x)
  const ys = nodes.map((n) => n.position.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX + 230
  const h = Math.max(...ys) - minY + 90
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return (
    <svg viewBox={`${minX - 20} ${minY - 20} ${w + 40} ${h + 40}`} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {edges.map((e) => {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) return null
        const x1 = a.position.x + 230
        const y1 = a.position.y + 40
        const x2 = b.position.x
        const y2 = b.position.y + 40
        const mx = (x1 + x2) / 2
        return <path key={e.id} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth={6} />
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.position.x} y={n.position.y} width={230} height={80} rx={18} fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={4} />
          <rect x={n.position.x + 16} y={n.position.y + 22} width={36} height={36} rx={10} fill={NODE_STYLE[n.kind].color} opacity={0.85} />
          <rect x={n.position.x + 66} y={n.position.y + 30} width={120} height={10} rx={5} fill="var(--border-strong)" />
          <rect x={n.position.x + 66} y={n.position.y + 48} width={80} height={8} rx={4} fill="var(--border)" />
        </g>
      ))}
    </svg>
  )
}
