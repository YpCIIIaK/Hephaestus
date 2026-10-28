import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ForgeGallery } from '@/components/forge/gallery'

export const metadata: Metadata = { title: 'Кузница' }

export default function ForgePage() {
  return (
    <Suspense>
      <ForgeGallery />
    </Suspense>
  )
}
