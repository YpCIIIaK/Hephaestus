'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Plus, FolderOpen, Trash2, Edit2, Save, X, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Skill {
  id: string
  name: string
  description: string
  category?: string
  updatedAt: string
}

interface ToolSkill {
  id: string
  name: string
  description: string
  category?: string
  actionId: string
  updatedAt: string
}

export function SkillManager() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [toolSkills, setToolSkills] = useState<ToolSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [toolLoading, setToolLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newSkill, setNewSkill] = useState({ name: '', description: '', category: '', content: '' })
  const [editContent, setEditContent] = useState('')

  const [runOpen, setRunOpen] = useState(false)
  const [selectedToolSkillId, setSelectedToolSkillId] = useState<string>('')
  const [toolInputs, setToolInputs] = useState<string>('{}')
  const [toolResult, setToolResult] = useState<string>('')

  const [searchQuery, setSearchQuery] = useState<string>('')

  useEffect(() => {
    fetchSkills()
    fetchToolSkills()
  }, [])

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills')
      const data = await res.json()
      if (data.skills) setSkills(data.skills)
    } catch (e) {
      console.error('Failed to fetch skills:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchToolSkills = async () => {
    try {
      const res = await fetch('/api/tool-skills')
      const data = await res.json()
      if (data.toolSkills) setToolSkills(data.toolSkills)
    } catch (e) {
      console.error('Failed to fetch tool skills:', e)
    } finally {
      setToolLoading(false)
    }
  }

  const runToolSkill = async () => {
    if (!selectedToolSkillId) return

    let parsedInputs: any = {}
    try {
      parsedInputs = toolInputs?.trim() ? JSON.parse(toolInputs) : {}
    } catch (e) {
      setToolResult('Invalid JSON in inputs')
      return
    }

    try {
      setToolResult('Running...')
      const res = await fetch('/api/tool-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedToolSkillId,
          inputs: parsedInputs,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setToolResult(JSON.stringify(data, null, 2))
        return
      }

      setToolResult(JSON.stringify(data.result, null, 2))
    } catch (e: any) {
      setToolResult(e?.message || 'Failed to run tool skill')
    }
  }

  const createSkill = async () => {
    if (!newSkill.name || !newSkill.description || !newSkill.content) return

    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: newSkill.name.toLowerCase().replace(/\s+/g, '-'),
          name: newSkill.name,
          description: newSkill.description,
          category: newSkill.category || undefined,
          content: newSkill.content,
        }),
      })

      if (res.ok) {
        setCreateOpen(false)
        setNewSkill({ name: '', description: '', category: '', content: '' })
        fetchSkills()
      }
    } catch (e) {
      console.error('Failed to create skill:', e)
    }
  }

  const deleteSkill = async (id: string) => {
    if (!confirm('Delete this skill?')) return

    try {
      const res = await fetch(`/api/skills?id=${id}`, { method: 'DELETE' })
      if (res.ok) fetchSkills()
    } catch (e) {
      console.error('Failed to delete skill:', e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderOpen className="w-4 h-4 text-violet-400" />
          Skills & Tools
        </div>
        <Dialog open={runOpen} onOpenChange={setRunOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Run Tool Skill
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Run Tool Skill</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 flex-1 overflow-hidden">
              <div className="space-y-2">
                <Label>Tool Skill ID</Label>
                <Input
                  value={selectedToolSkillId}
                  onChange={(e) => setSelectedToolSkillId(e.target.value)}
                  placeholder="e.g., rapidapi-weather"
                />
                <p className="text-[11px] text-muted-foreground">
                  Available: {toolSkills.map((t) => t.id).slice(0, 6).join(', ')}{toolSkills.length > 6 ? '…' : ''}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Inputs (JSON)</Label>
                <Textarea
                  value={toolInputs}
                  onChange={(e) => setToolInputs(e.target.value)}
                  className="min-h-[140px] font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Example for weather: {`{"q":"Moscow"}`}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Result</Label>
                <Textarea value={toolResult} readOnly className="min-h-[140px] font-mono text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setRunOpen(false)}>Close</Button>
              <Button onClick={runToolSkill} disabled={!selectedToolSkillId}>Run</Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <Plus className="w-3 h-3 mr-1" /> Create Skill
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Create New Skill</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 flex-1 overflow-hidden">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={newSkill.name} onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} placeholder="my-skill" />
                </div>
                <div className="space-y-2">
                  <Label>Category (optional)</Label>
                  <Input value={newSkill.category} onChange={e => setNewSkill({ ...newSkill, category: e.target.value })} placeholder="e.g., devops, analysis" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={newSkill.description} onChange={e => setNewSkill({ ...newSkill, description: e.target.value })} placeholder="What does this skill do?" />
              </div>
              <div className="space-y-2 flex-1 min-h-0">
                <Label>Skill Content (SKILL.md body)</Label>
                <Textarea
                  value={newSkill.content}
                  onChange={e => setNewSkill({ ...newSkill, content: e.target.value })}
                  placeholder={`## What is this skill?

This skill helps you...

## How to use

1. Step one
2. Step two

## Examples

\`\`\`
Example usage here
\`\`\``}
                  className="flex-1 min-h-[200px] font-mono text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={createSkill}>Create Skill</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search skills by name, description or ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-8 text-sm"
        />
      </div>

      {loading || toolLoading ? (
        <p className="text-xs text-muted-foreground">Loading skills...</p>
      ) : skills.length === 0 && toolSkills.length === 0 ? (
        <div className="p-8 rounded-lg border-2 border-dashed border-border text-center">
          <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No skills created yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Skills are reusable capabilities your agent can use.</p>
        </div>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {toolSkills.filter(tool =>
              !searchQuery ||
              tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
              tool.id.toLowerCase().includes(searchQuery.toLowerCase())
            ).map(tool => (
              <div key={tool.id} className="p-3 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{tool.name}</span>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">tool</Badge>
                      {tool.category && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{tool.category}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">ID: {tool.id} • Action: {tool.actionId}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Run"
                      onClick={() => {
                        setSelectedToolSkillId(tool.id)
                        setToolInputs('{}')
                        setToolResult('')
                        setRunOpen(true)
                      }}
                    >
                      <PlayIcon />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {skills.filter(skill =>
              !searchQuery ||
              skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
              skill.id.toLowerCase().includes(searchQuery.toLowerCase())
            ).map(skill => (
              <div key={skill.id} className="p-3 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{skill.name}</span>
                      {skill.category && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{skill.category}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">ID: {skill.id}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit">
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" title="Delete" onClick={() => deleteSkill(skill.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-3 h-3"
    >
      <path
        d="M8 5v14l11-7L8 5z"
        fill="currentColor"
      />
    </svg>
  )
}