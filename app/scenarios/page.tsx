import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ScenariosView } from '@/components/scenarios/scenarios-view'

export const metadata: Metadata = { title: 'Сценарии' }

export default function ScenariosPage() {
  return (
    <Suspense>
      <ScenariosView />
    </Suspense>
  )
}
