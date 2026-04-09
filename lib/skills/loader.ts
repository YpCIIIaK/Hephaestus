// Skill Loader - discovers and loads skills from the filesystem
import { Skill, SkillMetadata, parseSkillFile } from './types';
import fs from 'fs';
import path from 'path';

export class SkillLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private enabled: boolean;

  constructor(skillsDir: string = './skills', enabled: boolean = true) {
    this.skillsDir = skillsDir;
    this.enabled = enabled;
  }

  /** Discover all available skills from the skills directory */
  async discoverSkills(): Promise<SkillMetadata[]> {
    if (!this.enabled) return [];

    const metadataList: SkillMetadata[] = [];

    try {
      if (!fs.existsSync(this.skillsDir)) {
        console.log(`[Skills] Directory not found: ${this.skillsDir}`);
        return [];
      }

      const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillId = entry.name;
          const skillMarkdownPath = path.join(this.skillsDir, skillId, 'SKILL.md');

          if (fs.existsSync(skillMarkdownPath)) {
            const content = fs.readFileSync(skillMarkdownPath, 'utf-8');
            const parsed = parseSkillFile(content);

            if (parsed) {
              const skill: Skill = {
                metadata: {
                  ...parsed.metadata,
                  id: skillId,
                  enabled: true,
                },
                content: parsed.content,
                createdAt: fs.statSync(skillMarkdownPath).mtime.toISOString(),
                updatedAt: fs.statSync(skillMarkdownPath).mtime.toISOString(),
              };

              this.skills.set(skillId, skill);
              metadataList.push(skill.metadata);
            }
          }
        }
      }

      console.log(`[Skills] Discovered ${metadataList.length} skills`);
    } catch (error) {
      console.error('[Skills] Error discovering skills:', error);
    }

    return metadataList;
  }

  /** Load a specific skill by ID */
  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /** Check if a skill exists */
  hasSkill(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  /** Get all skill metadata */
  getAllMetadata(): SkillMetadata[] {
    return Array.from(this.skills.values()).map(s => s.metadata);
  }

  /** Get all skills */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** Reload skills from disk */
  async reload(): Promise<void> {
    this.skills.clear();
    await this.discoverSkills();
  }

  /** Create a new skill */
  createSkill(skillId: string, metadata: Omit<SkillMetadata, 'id'>, content: string): Skill | null {
    try {
      const skillDir = path.join(this.skillsDir, skillId);
      const skillFilePath = path.join(skillDir, 'SKILL.md');

      // Create skill directory if it doesn't exist
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      const skill: Skill = {
        metadata: {
          ...metadata,
          id: skillId,
        },
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Write SKILL.md file
      const fileContent = serializeSkillFile({
        metadata: skill.metadata,
        content: skill.content,
      });

      fs.writeFileSync(skillFilePath, fileContent, 'utf-8');

      this.skills.set(skillId, skill);

      return skill;
    } catch (error) {
      console.error('[Skills] Error creating skill:', error);
      return null;
    }
  }

  /** Update an existing skill */
  updateSkill(skillId: string, updates: Partial<Skill>): Skill | null {
    const existing = this.skills.get(skillId);
    if (!existing) return null;

    try {
      const skillFilePath = path.join(this.skillsDir, skillId, 'SKILL.md');

      const updated: Skill = {
        ...existing,
        ...updates,
        metadata: {
          ...existing.metadata,
          ...updates.metadata,
          id: skillId,
        },
        updatedAt: new Date().toISOString(),
      };

      const fileContent = serializeSkillFile({
        metadata: updated.metadata,
        content: updated.content,
      });

      fs.writeFileSync(skillFilePath, fileContent, 'utf-8');

      this.skills.set(skillId, updated);

      return updated;
    } catch (error) {
      console.error('[Skills] Error updating skill:', error);
      return null;
    }
  }

  /** Delete a skill */
  deleteSkill(skillId: string): boolean {
    try {
      const skillDir = path.join(this.skillsDir, skillId);

      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true });
        this.skills.delete(skillId);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[Skills] Error deleting skill:', error);
      return false;
    }
  }
}

// Helper function to build skill tool schema
export function buildSkillToolSchema(skills: SkillMetadata[]): any {
  if (skills.length === 0) {
    return null;
  }

  // Build XML description of available skills
  const skillsXml = skills.map(s => `  <skill name="${s.name}">${s.description}</skill>`).join('\n');

  // Build enum of skill IDs
  const skillEnum = skills.map(s => s.id);

  return {
    type: 'function',
    function: {
      name: 'skill',
      description: `Load and invoke a specialized skill.\n\n<skills>\n${skillsXml}\n</skills>`,
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            enum: skillEnum,
            description: 'The name/ID of the skill to load',
          },
        },
        required: ['skill_name'],
      },
    },
  };
}

function serializeSkillFile(skill: { metadata: { name: string; description: string; category?: string }; content: string }): string {
  const frontmatter = [
    '---',
    `name: ${skill.metadata.name}`,
    `description: ${skill.metadata.description}`,
    skill.metadata.category ? `category: ${skill.metadata.category}` : null,
    '---',
  ].filter(Boolean).join('\n');

  return `${frontmatter}\n\n${skill.content}`;
}