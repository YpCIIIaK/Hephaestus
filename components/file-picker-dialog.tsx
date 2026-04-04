'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Search,
  FolderOpen,
  FileText,
  Code,
  FileSpreadsheet,
  File as FileIcon,
  Upload,
  Image,
  Archive,
  Loader2,
  X,
  Paperclip,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileEntry[]
  size?: number
}

interface AttachedFile {
  name: string
  size: number
  type: string
  text: string
  isProcessing: boolean
  error?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(type: string, name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const isImage = type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)
  const isPdf = ext === 'pdf'
  const isExcel = ['xlsx', 'xls', 'csv'].includes(ext)
  const isCode = ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'css', 'html', 'json', 'yaml', 'yml', 'xml', 'sql', 'toml', 'md', 'env', 'sh', 'bash'].includes(ext)
  const isArchive = ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)

  if (isImage) return <Image className="w-4 h-4 text-pink-400" />
  if (isPdf) return <FileText className="w-4 h-4 text-red-400" />
  if (isExcel) return <FileSpreadsheet className="w-4 h-4 text-green-400" />
  if (isCode) return <Code className="w-4 h-4 text-blue-400" />
  if (isArchive) return <Archive className="w-4 h-4 text-yellow-400" />
  return <FileIcon className="w-4 h-4 text-muted-foreground" />
}

// Quick access files for desktop
const QUICK_FILES = [
  { path: 'example.txt', label: 'example.txt' },
  { path: 'package.json', label: 'package.json' },
  { path: 'README.md', label: 'README.md' },
  { path: '.env', label: '.env' },
]

interface FilePickerDialogProps {
  onSelect: (files: FileList | File[]) => void
  triggerButton?: React.ReactNode
}

export function FilePickerDialog({ onSelect, triggerButton }: FilePickerDialogProps) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedLocalFiles, setSelectedLocalFiles] = useState<Set<string>>(new Set())
  const [processingFiles, setProcessingFiles] = useState<Map<string, 'pending' | 'processing' | 'done' | 'error'>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load file tree when dialog opens
  useEffect(() => {
    if (open && files.length === 0) {
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

  // Reset selections when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedLocalFiles(new Set())
      setProcessingFiles(new Map())
    }
  }, [open])

  const toggleExpand = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }))
  }

  // Filter files by search
  const filterFiles = (entries: FileEntry[]): FileEntry[] => {
    if (!search) return entries
    return entries
      .map(entry => {
        const nameMatch = entry.name.toLowerCase().includes(search.toLowerCase())
        if (entry.type === 'file') return nameMatch ? entry : null
        // Directory: keep if name matches or has matching child
        const filteredChildren = entry.children ? filterFiles(entry.children) : []
        if (nameMatch || filteredChildren.length > 0) {
          return { ...entry, children: filteredChildren }
        }
        return null
      })
      .filter(Boolean) as FileEntry[]
  }

  // Select a project file (load its content)
  const handleSelectProjectFile = async (path: string) => {
    if (selectedLocalFiles.has(path) || processingFiles.get(path) === 'processing') return
    
    setProcessingFiles(prev => new Map(prev).set(path, 'processing'))
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: path }),
      })
      const data = await res.json()
      
      if (data.content) {
        // Create a File object from the content
        const name = path.split('/').pop() || path
        const file = new File([data.content], name, { type: 'text/plain' }) as File
        onSelect([file])
        setOpen(false)
      }
    } catch (err) {
      console.error('Failed to load file:', err)
    } finally {
      setProcessingFiles(prev => new Map(prev).set(path, 'error'))
    }
  }

  // Handle local file upload from user's computer
  const handleLocalFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    onSelect(Array.from(files))
    setOpen(false)
  }

  // Render file tree entry
  const renderEntry = (entry: FileEntry, level = 0) => {
    const isProcessing = processingFiles.get(entry.path) === 'processing'
    
    if (entry.type === 'directory') {
      const isExpanded = expanded[entry.path]
      return (
        <div key={entry.path}>
          <button
            onClick={() => toggleExpand(entry.path)}
            className="flex items-center gap-2 w-full p-2 hover:bg-secondary/50 rounded-md transition-colors text-sm group"
            style={{ paddingLeft: `${level * 16 + 8}px` }}
          >
            <span className="text-muted-foreground">
              {isExpanded ? '▼' : '▶'}
            </span>
            <FolderOpen className="w-4 h-4 text-amber-400/70" />
            <span className="text-muted-foreground">{entry.name}</span>
            {entry.children && (
              <span className="ml-auto text-[10px] text-muted-foreground/50">
                {entry.children.length}
              </span>
            )}
          </button>
          
          {isExpanded && entry.children?.map(child => renderEntry(child, level + 1))}
        </div>
      )
    }

    // File entry
    return (
      <button
        key={entry.path}
        onClick={() => handleSelectProjectFile(entry.path)}
        disabled={isProcessing}
        className="flex items-center gap-2 w-full p-2 hover:bg-primary/5 rounded-md transition-colors text-sm group disabled:opacity-50"
        style={{ paddingLeft: `${level * 16 + 28}px` }}
      >
        {getFileIcon('', entry.name)}
        <span className="truncate flex-1 text-left">{entry.name}</span>
        {entry.size && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto">
            {formatFileSize(entry.size)}
          </span>
        )}
        {isProcessing && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
      </button>
    )
  }

  const filteredFiles = filterFiles(files)

  return (
    <>
      {/* Trigger button */}
      <div onClick={() => setOpen(true)}>
        {triggerButton}
      </div>

      {/* Hidden file input for local files */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="*/*"
        className="hidden"
        onChange={(e) => handleLocalFileUpload(e.target.files)}
      />

      {/* File Picker Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-5 pb-2 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Paperclip className="w-4 h-4 text-primary" />
              Attach File
            </DialogTitle>
            <DialogDescription className="text-xs">
              Choose a project file or upload from your computer
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-4 space-y-3">
            {/* Upload from computer button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 border-dashed"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
              Upload from computer
            </Button>

            {/* Quick access files */}
            <div>
              <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1.5 tracking-wider">Quick Access</div>
              <div className="grid grid-cols-4 gap-1.5">
                {QUICK_FILES.map(qf => (
                  <Button
                    key={qf.path}
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] gap-1.5 truncate"
                    onClick={() => handleSelectProjectFile(qf.path)}
                    disabled={processingFiles.get(qf.path) === 'processing'}
                  >
                    {processingFiles.get(qf.path) === 'processing' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FileText className="w-3 h-3" />
                    )}
                    {qf.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search project files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-secondary/50"
              />
            </div>

            {/* File tree */}
            {loading ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <p className="text-xs text-muted-foreground">Loading project files...</p>
              </div>
            ) : filteredFiles.length > 0 ? (
              <div className="space-y-0.5">
                {filteredFiles.map(file => renderEntry(file))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <FileText className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">
                  {search ? 'No files found' : 'No files in project'}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}