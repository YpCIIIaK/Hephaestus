'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { File, Folder, ChevronRight, ChevronDown, Search, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileEntry[]
  size?: number
}

interface FileSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
}

export function FileSelector({ open, onOpenChange, onSelect }: FileSelectorProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) {
      setLoading(true)
      fetch('/api/files')
        .then(res => res.json())
        .then(data => {
          setFiles(data.files || [])
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }
  }, [open])

  const toggleExpand = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }))
  }

  const renderEntry = (entry: FileEntry, level = 0) => {
    const isExpanded = expanded[entry.path]
    const isVisible = entry.name.toLowerCase().includes(search.toLowerCase()) || 
                      (entry.children?.some(c => c.name.toLowerCase().includes(search.toLowerCase())))

    if (!isVisible && search) return null

    if (entry.type === 'directory') {
      return (
        <div key={entry.path}>
          <button
            onClick={() => toggleExpand(entry.path)}
            className="flex items-center gap-2 w-full p-2 hover:bg-secondary/50 rounded-md transition-colors text-sm"
            style={{ paddingLeft: `${level * 16 + 8}px` }}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Folder className="w-4 h-4 text-blue-400 fill-blue-400/20" />
            <span className="font-medium">{entry.name}</span>
          </button>
          
          {isExpanded && entry.children?.map(child => renderEntry(child, level + 1))}
        </div>
      )
    }

    return (
      <button
        key={entry.path}
        onClick={() => {
          onSelect(entry.path)
          onOpenChange(false)
        }}
        className="flex items-center gap-2 w-full p-2 hover:bg-primary/10 rounded-md transition-colors text-sm group"
        style={{ paddingLeft: `${level * 16 + 28}px` }}
      >
        <File className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
        <span>{entry.name}</span>
        {entry.size && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {(entry.size / 1024).toFixed(1)} KB
          </span>
        )}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[600px] flex flex-col p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            Select Local File
          </DialogTitle>
          <DialogDescription>
            Choose a file from your project workspace to process.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4">
          <Input 
            placeholder="Search files..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-secondary/50 border-border/50"
          />
        </div>

        <ScrollArea className="flex-1 px-4 pb-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Indexing workspace...</p>
            </div>
          ) : (
            <div className="space-y-1">
              {files.map(file => renderEntry(file))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
