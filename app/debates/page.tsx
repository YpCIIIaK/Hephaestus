import type { Metadata } from 'next'
import { Suspense } from 'react'
import { DebatesView } from '@/components/debates/debates-view'

export const metadata: Metadata = { title: 'Дебаты' }

export default function DebatesPage() {
  return (
    <Suspense>
      <DebatesView />
    </Suspense>
  )
}
