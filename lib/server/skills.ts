import fs from 'node:fs/promises'
import path from 'node:path'
import type { Skill, SkillMeta } from '../types'
import { SKILLS_DIR } from './paths'

// Навыки — папки skills/<id>/SKILL.md с YAML-шапкой (name, description, category).
// Модель видит список навыков и загружает нужный инструментом load_skill.

export function parseSkill(id: string, raw: string): Omit<Skill, 'updatedAt'> {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const meta: Record<string, string> = {}
  let body = raw
  if (m) {
    body = m[2]
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/)
      if (!kv) continue
      const v = kv[2].trim()
      if (v.startsWith('"') && v.endsWith('"') && v.length > 1) {
        try {
          meta[kv[1]] = JSON.parse(v)
          continue
        } catch {
          // не JSON-строка — снимем кавычки ниже
        }
      }
      meta[kv[1]] = v.replace(/^["']|["']$/g, '')
    }
  }
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    category: meta.category || undefined,
    content: body.trim(),
  }
}

export function serializeSkill(s: Pick<Skill, 'name' | 'description' | 'category' | 'content'>): string {
  const esc = (v: string) => (/[:#"']/.test(v) ? JSON.stringify(v) : v)
  const head = [`name: ${esc(s.name)}`, `description: ${esc(s.description.replace(/\n/g, ' '))}`]
  if (s.category) head.push(`category: ${esc(s.category)}`)
  return `---\n${head.join('\n')}\n---\n\n${s.content.trim()}\n`
}

export function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return (
    name
      .toLowerCase()
      .split('')
      .map((c) => map[c] ?? c)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'skill'
  )
}

function validId(id: string) {
  return /^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id)
}

export async function listSkills(): Promise<Skill[]> {
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const skills: Skill[] = []
  for (const e of entries) {
    if (!e.isDirectory() || !validId(e.name)) continue
    const file = path.join(SKILLS_DIR, e.name, 'SKILL.md')
    try {
      const [raw, st] = await Promise.all([fs.readFile(file, 'utf-8'), fs.stat(file)])
      skills.push({ ...parseSkill(e.name, raw), updatedAt: st.mtime.toISOString() })
    } catch {
      // папка без SKILL.md — пропускаем
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export async function getSkill(idOrName: string): Promise<Skill | null> {
  const all = await listSkills()
  const q = idOrName.trim().toLowerCase()
  return all.find((s) => s.id.toLowerCase() === q) ?? all.find((s) => s.name.toLowerCase() === q) ?? null
}

export async function saveSkill(input: { id?: string; name: string; description: string; category?: string; content: string }): Promise<Skill> {
  const id = input.id && validId(input.id) ? input.id : slugify(input.name)
  const dir = path.join(SKILLS_DIR, id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), serializeSkill(input), 'utf-8')
  return { id, name: input.name, description: input.description, category: input.category, content: input.content.trim(), updatedAt: new Date().toISOString() }
}

export async function deleteSkill(id: string): Promise<void> {
  if (!validId(id)) throw new Error('Некорректный id навыка')
  await fs.rm(path.join(SKILLS_DIR, id), { recursive: true, force: true })
}

export function skillsCatalogText(skills: SkillMeta[]): string {
  return skills.map((s) => `- ${s.id}: ${s.name} — ${s.description}`).join('\n')
}
