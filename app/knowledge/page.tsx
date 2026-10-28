import type { Metadata } from 'next'
import { KnowledgeView } from '@/components/knowledge/knowledge-view'

export const metadata: Metadata = { title: 'Знания' }

export default function KnowledgePage() {
  return <KnowledgeView />
}
