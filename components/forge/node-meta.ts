import { BookOpenText, Bot, FilePen, FileText, Flag, Globe, LogIn, Merge, Repeat, ShieldCheck, Split, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { NodeKind } from '@/lib/engine/pipeline'

export const NODE_STYLE: Record<NodeKind, { icon: LucideIcon; color: string }> = {
  input: { icon: LogIn, color: 'var(--p4)' },
  agent: { icon: Bot, color: 'var(--p1)' },
  foreach: { icon: Repeat, color: 'var(--p1)' },
  command: { icon: SquareTerminal, color: 'var(--p6)' },
  search: { icon: Globe, color: 'var(--p2)' },
  knowledge: { icon: BookOpenText, color: 'var(--p6)' },
  file: { icon: FileText, color: 'var(--p7)' },
  router: { icon: Split, color: 'var(--p3)' },
  merge: { icon: Merge, color: 'var(--p8)' },
  validator: { icon: ShieldCheck, color: 'var(--p5)' },
  write: { icon: FilePen, color: 'var(--p7)' },
  output: { icon: Flag, color: 'var(--success)' },
}

export const PALETTE_ORDER: NodeKind[] = ['input', 'agent', 'foreach', 'command', 'search', 'knowledge', 'file', 'router', 'merge', 'validator', 'write', 'output']
