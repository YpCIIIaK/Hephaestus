import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ChatView } from '@/components/chat/chat-view'

export const metadata: Metadata = { title: 'Чат' }

export default function ChatPage() {
  return (
    <Suspense>
      <ChatView />
    </Suspense>
  )
}
