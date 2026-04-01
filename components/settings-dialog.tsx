'use client'

import { useArenaStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Trash2, MessageSquare, Clock } from 'lucide-react'

export function SettingsDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { historicalChats, loadHistoricalChat, deleteHistoricalChat } = useArenaStore()

  const handleLoadChat = (id: string) => {
    loadHistoricalChat(id)
    onOpenChange(false)
  }

  const handleClearAll = () => {
    if (confirm("Are you sure you want to clear all data? This cannot be undone.")) {
       localStorage.removeItem('arena-storage')
       window.location.reload()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="history" className="flex-1 flex flex-col mt-4 overflow-hidden">
          <TabsList className="w-full bg-secondary">
            <TabsTrigger value="history" className="flex-1">Chat History</TabsTrigger>
            <TabsTrigger value="data" className="flex-1">Data Management</TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-4">
              {historicalChats.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No chat history found.
                </div>
              ) : (
                <div className="space-y-3">
                  {historicalChats.map(chat => (
                    <div key={chat.id} className="border border-border rounded-lg p-4 flex items-center justify-between hover:bg-secondary/50 transition-colors">
                      <div className="flex-1 min-w-0 pr-4 cursor-pointer" onClick={() => handleLoadChat(chat.id)}>
                        <h4 className="text-sm font-medium text-foreground truncate">{chat.title}</h4>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {new Date(chat.date).toLocaleString()}
                          <span className="mx-1">•</span>
                          <MessageSquare className="w-3 h-3" />
                          {chat.messages.length} messages
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => deleteHistoricalChat(chat.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="data" className="flex-1 mt-4">
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-destructive">Wipe All Data</h3>
                <p className="text-sm text-muted-foreground">
                  This will delete all your settings, models, pipelines, and chat history.
                </p>
                <Button variant="destructive" onClick={handleClearAll}>
                  Clear Local Storage
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
