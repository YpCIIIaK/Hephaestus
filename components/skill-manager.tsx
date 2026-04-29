'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Plus, FolderOpen, Trash2, Edit2, Save, X, Search, Eye, Play, FileText, Wrench, BookOpen, Tag, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useArenaStore } from '@/lib/store'

interface Skill { id: string; name: string; description: string; category?: string; updatedAt: string }
interface ToolSkill { id: string; name: string; description: string; category?: string; actionId: string; updatedAt: string }
interface FullSkill extends Skill { content: string }

export function SkillManager() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [toolSkills, setToolSkills] = useState<ToolSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [toolLoading, setToolLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', description: '', category: '', content: '' })

  const [viewOpen, setViewOpen] = useState(false)
  const [viewSkill, setViewSkill] = useState<FullSkill | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editSkill, setEditSkill] = useState<FullSkill | null>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '', category: '', content: '' })

  const [runOpen, setRunOpen] = useState(false)
  const [selectedToolSkillId, setSelectedToolSkillId] = useState<string>('')
  const [toolInputs, setToolInputs] = useState<string>('{}')
  const [toolResult, setToolResult] = useState<string>('')

  const [searchQuery, setSearchQuery] = useState<string>('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

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

  const fetchSkillDetail = async (id: string): Promise<FullSkill | null> => {
    try {
      const res = await fetch(`/api/skills?id=${id}`)
      const data = await res.json()
      return data.skill || null
    } catch (e) {
      console.error('Failed to fetch skill detail:', e)
      return null
    }
  }

  const openView = async (skill: Skill) => {
    setViewLoading(true)
    setViewOpen(true)
    const detail = await fetchSkillDetail(skill.id)
    setViewSkill(detail || { ...skill, content: 'Failed to load content.' })
    setViewLoading(false)
  }

  const openEdit = async (skill: Skill) => {
    setViewLoading(true)
    setEditOpen(true)
    const detail = await fetchSkillDetail(skill.id)
    if (detail) {
      setEditSkill(detail)
      setEditForm({
        name: detail.name,
        description: detail.description,
        category: detail.category || '',
        content: detail.content,
      })
    }
    setViewLoading(false)
  }

  const saveEdit = async () => {
    if (!editSkill) return
    try {
      const res = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editSkill.id,
          name: editForm.name,
          description: editForm.description,
          category: editForm.category || undefined,
          content: editForm.content,
        }),
      })
      if (res.ok) {
        setEditOpen(false)
        setEditSkill(null)
        fetchSkills()
      }
    } catch (e) {
      console.error('Failed to update skill:', e)
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

  const useSkillInChat = (skillId: string) => {
    const setActiveTab = useArenaStore.getState().setActiveTab
    const setChatInput = useArenaStore.getState().setChatInput
    setActiveTab('chat')
    setChatInput(`skill(skill_name="${skillId}")\n\n`)
  }

  const categories = ['all', ...Array.from(new Set([
    ...skills.map(s => s.category).filter(Boolean),
    ...toolSkills.map(t => t.category).filter(Boolean)
  ] as string[]))]

  const filteredSkills = skills.filter(skill => {
    const matchesSearch = !searchQuery ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.id.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === 'all' || skill.category === activeCategory
    return matchesSearch && matchesCategory
  })

  const filteredToolSkills = toolSkills.filter(tool => {
    const matchesSearch = !searchQuery ||
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.id.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <BookOpen className="w-4 h-4 text-violet-400" />
          Skills & Tools
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{skills.length + toolSkills.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRunOpen(true)}>
            <Wrench className="w-3 h-3 mr-1" /> Run Tool
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3 h-3 mr-1" /> Create Skill
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search skills by name, description or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        {categories.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium transition-colors border',
                  activeCategory === cat
                    ? 'bg-violet-500/10 border-violet-500/30 text-violet-500'
                    : 'bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60'
                )}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {loading || toolLoading ? (
        <div className="flex items-center justify-center py-12"><div className="text-xs text-muted-foreground">Loading skills...</div></div>
      ) : filteredSkills.length === 0 && filteredToolSkills.length === 0 ? (
        <div className="p-8 rounded-lg border-2 border-dashed border-border text-center">
          <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No skills found.</p>
          <p className="text-xs text-muted-foreground mt-1">{searchQuery || activeCategory !== 'all' ? 'Try adjusting your search or filters.' : 'Create your first skill to get started.'}</p>
        </div>
      ) : (
        <ScrollArea className="h-[420px]">
          <div className="space-y-3">
            {/* Tool Skills Section */}
            {filteredToolSkills.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider"><Wrench className="w-3 h-3" /> Tool Skills ({filteredToolSkills.length})</div>
                <div className="grid grid-cols-1 gap-2">
                  {filteredToolSkills.map(tool => (
                    <div key={tool.id} className="p-3 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openView(tool as any)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">{tool.name}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-orange-500/30 text-orange-500">tool</Badge>
                            {tool.category && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{tool.category}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">ID: {tool.id} • Action: {tool.actionId}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:text-primary" title="Use in Chat" onClick={() => useSkillInChat(tool.id)}><MessageSquare className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Run" onClick={() => { setSelectedToolSkillId(tool.id); setToolInputs('{}'); setToolResult(''); setRunOpen(true); }}>
                            <Play className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Knowledge Skills Section */}
            {filteredSkills.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider"><FileText className="w-3 h-3" /> Knowledge Skills ({filteredSkills.length})</div>
                <div className="grid grid-cols-1 gap-2">
                  {filteredSkills.map(skill => (
                    <div key={skill.id} className="p-3 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openView(skill)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">{skill.name}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-violet-500/30 text-violet-500">skill</Badge>
                            {skill.category && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{skill.category}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">ID: {skill.id}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:text-primary" title="Use in Chat" onClick={() => useSkillInChat(skill.id)}><MessageSquare className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => openView(skill)}><Eye className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => openEdit(skill)}><Edit2 className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete" onClick={() => deleteSkill(skill.id)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* View Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-4 h-4 text-violet-400" />{viewSkill?.name || 'Skill Detail'}</DialogTitle>
          </DialogHeader>
          {viewLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">Loading...</div>
          ) : viewSkill ? (
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center gap-2">
                {viewSkill.category && <Badge variant="secondary" className="text-[10px]"><Tag className="w-3 h-3 mr-1" />{viewSkill.category}</Badge>}
                <span className="text-[10px] text-muted-foreground">ID: {viewSkill.id}</span>
              </div>
              <p className="text-sm text-muted-foreground">{viewSkill.description}</p>
              <ScrollArea className="flex-1 border rounded-md bg-secondary/30 p-4"><pre className="text-xs font-mono whitespace-pre-wrap">{viewSkill.content}</pre></ScrollArea>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setViewOpen(false)}>Close</Button>
                <Button variant="outline" size="sm" onClick={() => { setViewOpen(false); useSkillInChat(viewSkill.id); }}><MessageSquare className="w-3 h-3 mr-1" /> Use in Chat</Button>
                <Button size="sm" onClick={() => { setViewOpen(false); openEdit(viewSkill); }}><Edit2 className="w-3 h-3 mr-1" /> Edit</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit2 className="w-4 h-4 text-violet-400" /> Edit Skill</DialogTitle>
          </DialogHeader>
          {viewLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">Loading...</div>
          ) : editSkill ? (
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Name</Label><Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Category (optional)</Label><Input value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Description</Label><Input value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></div>
              <div className="space-y-2 flex-1 min-h-0"><Label>Content</Label><Textarea value={editForm.content} onChange={e => setEditForm({ ...editForm, content: e.target.value })} className="flex-1 min-h-[220px] font-mono text-sm resize-none" /></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={saveEdit}><Save className="w-3 h-3 mr-1" /> Save Changes</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Create New Skill</DialogTitle></DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name</Label><Input value={newSkill.name} onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} placeholder="my-skill" /></div>
              <div className="space-y-2"><Label>Category (optional)</Label><Input value={newSkill.category} onChange={e => setNewSkill({ ...newSkill, category: e.target.value })} placeholder="e.g., devops, analysis" /></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Input value={newSkill.description} onChange={e => setNewSkill({ ...newSkill, description: e.target.value })} placeholder="What does this skill do?" /></div>
            <div className="space-y-2 flex-1 min-h-0"><Label>Skill Content (SKILL.md body)</Label>
              <Textarea value={newSkill.content} onChange={e => setNewSkill({ ...newSkill, content: e.target.value })} placeholder={`## What is this skill?\n\nThis skill helps you...\n\n## How to use\n\n1. Step one\n2. Step two\n\n## Examples\n\n\`\`\`\nExample usage here\n\`\`\``} className="flex-1 min-h-[200px] font-mono text-sm resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createSkill}>Create Skill</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run Tool Dialog */}
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Run Tool Skill</DialogTitle></DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="space-y-2"><Label>Tool Skill ID</Label><Input value={selectedToolSkillId} onChange={(e) => setSelectedToolSkillId(e.target.value)} placeholder="e.g., rapidapi-weather" />
              <p className="text-[11px] text-muted-foreground">Available: {toolSkills.map(t => t.id).slice(0, 6).join(', ')}{toolSkills.length > 6 ? '…' : ''}</p>
            </div>
            <div className="space-y-2"><Label>Inputs (JSON)</Label><Textarea value={toolInputs} onChange={(e) => setToolInputs(e.target.value)} className="min-h-[140px] font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">Example for weather: {`{"q":"Moscow"}`}</p>
            </div>
            <div className="space-y-2"><Label>Result</Label><Textarea value={toolResult} readOnly className="min-h-[140px] font-mono text-sm" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setRunOpen(false)}>Close</Button>
            <Button onClick={runToolSkill} disabled={!selectedToolSkillId}>Run</Button>
          </div>
        </DialogContent>
      </Dialog>
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