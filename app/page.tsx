'use client'

import { Sidebar } from '@/components/sidebar'
import { ChatPanel } from '@/components/chat-panel'
import { ArenaPanel } from '@/components/arena-panel'
import { AnalyticsPanel } from '@/components/analytics-panel'
import { TelegramPanel } from '@/components/telegram-panel'
import { EventSimulator } from '@/components/event-simulator'
import { IDEChatPanel } from '@/components/ide-chat-panel'
import { useArenaStore } from '@/lib/store'
import { Menu, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { 
  Sheet, 
  SheetContent, 
  SheetTrigger,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'

export default function Home() {
  const { activeTab, isSidebarOpen, setSidebarOpen } = useArenaStore()
  
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile Top Header */}
      <div className="lg:hidden absolute top-0 left-0 right-0 h-14 border-b border-border bg-sidebar flex items-center px-4 z-40">
        <Sheet open={isSidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-3">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-r-sidebar-border bg-sidebar">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation Menu</SheetTitle>
            </SheetHeader>
            <Sidebar isMobile />
          </SheetContent>
        </Sheet>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <span className="font-semibold text-foreground uppercase tracking-wider text-xs">LLM Arena</span>
        </div>
      </div>

      {/* Desktop Sidebar (Sidebar handles its own width/collapse) */}
      <div className="hidden lg:flex relative h-full">
        <Sidebar />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden pt-14 lg:pt-0">
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'ide' && <IDEChatPanel />}
        {activeTab === 'arena' && <ArenaPanel />}
        {activeTab === 'dashboard' && <AnalyticsPanel />}
        {activeTab === 'telegram' && <TelegramPanel />}
        {activeTab === 'events' && <EventSimulator />}
      </main>
    </div>
  )
}
