import type { Metadata } from 'next'
import { PipelineEditor } from '@/components/forge/editor'

export const metadata: Metadata = { title: 'Редактор пайплайна' }

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PipelineEditor id={id} />
}
