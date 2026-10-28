'use client'

import { KeyRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCatalog } from '@/lib/stores/catalog'

/** Подсказка, пока не подключён ни один источник моделей */
export function SetupBanner() {
  const status = useCatalog((s) => s.status)
  const pathname = usePathname()
  if (!status || status.openrouter.configured || status.ollama.reachable || status.custom.configured) return null
  if (pathname.startsWith('/settings')) return null
  return (
    <div data-setup-banner className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/25 bg-warning/8 px-4 py-2 text-sm">
      <KeyRound className="size-4 text-warning" />
      <span>Модели не подключены: добавьте ключ OpenRouter или запустите Ollama.</span>
      <Link href="/settings" className="font-medium text-accent hover:underline">
        Открыть настройки →
      </Link>
    </div>
  )
}
