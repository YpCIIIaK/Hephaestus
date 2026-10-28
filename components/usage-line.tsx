import { Clock, Coins, Hash } from 'lucide-react'
import type { Usage } from '@/lib/types'
import { cn, formatCost, formatMs, formatTokens } from '@/lib/utils'

export function UsageLine({ usage, latencyMs, className }: { usage?: Usage; latencyMs?: number; className?: string }) {
  if (!usage && latencyMs == null) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-faint [&_svg]:size-3', className)}>
      {usage && (
        <span className="inline-flex items-center gap-1" title={`Вход ${usage.promptTokens} · выход ${usage.completionTokens} токенов`}>
          <Hash />
          {formatTokens(usage.promptTokens)}→{formatTokens(usage.completionTokens)}
        </span>
      )}
      {usage && (
        <span className="inline-flex items-center gap-1" title="Стоимость">
          <Coins />
          {formatCost(usage.cost)}
        </span>
      )}
      {latencyMs != null && (
        <span className="inline-flex items-center gap-1" title="Время ответа">
          <Clock />
          {formatMs(latencyMs)}
        </span>
      )}
    </div>
  )
}
