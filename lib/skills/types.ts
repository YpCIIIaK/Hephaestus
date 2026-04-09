// Skill system types for Hephaestus

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  category?: string;
  enabled: boolean;
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// SKILL.md format: YAML frontmatter + markdown body
export interface SkillFile {
  metadata: {
    name: string;
    description: string;
    category?: string;
  };
  content: string;
}

export function parseSkillFile(content: string): SkillFile | null {
  try {
    // Check for YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const body = match[2];

    // Parse YAML frontmatter
    const metadata: Record<string, string> = {};
    for (const line of frontmatter.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        metadata[key] = value;
      }
    }

    if (!metadata.name || !metadata.description) {
      return null;
    }

    return {
      metadata: {
        name: metadata.name,
        description: metadata.description,
        category: metadata.category,
      },
      content: body.trim(),
    };
  } catch {
    return null;
  }
}

export function serializeSkillFile(skill: SkillFile): string {
  const frontmatter = [
    '---',
    `name: ${skill.metadata.name}`,
    `description: ${skill.metadata.description}`,
    skill.metadata.category ? `category: ${skill.metadata.category}` : null,
    '---',
  ].filter(Boolean).join('\n');

  return `${frontmatter}\n\n${skill.content}`;
}