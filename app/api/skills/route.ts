import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parseSkillFile, serializeSkillFile } from '@/lib/skills/types';

// Skills directory - using project root skills folder
const SKILLS_DIR = path.join(process.cwd(), 'skills');

/** GET all skills */
export async function GET() {
  try {
    const skillsList: any[] = [];

    if (fs.existsSync(SKILLS_DIR)) {
      const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillId = entry.name;
          const skillMarkdownPath = path.join(SKILLS_DIR, skillId, 'SKILL.md');

          if (fs.existsSync(skillMarkdownPath)) {
            const content = fs.readFileSync(skillMarkdownPath, 'utf-8');
            const parsed = parseSkillFile(content);

            if (parsed) {
              skillsList.push({
                id: skillId,
                name: parsed.metadata.name,
                description: parsed.metadata.description,
                category: parsed.metadata.category,
                updatedAt: fs.statSync(skillMarkdownPath).mtime.toISOString(),
              });
            }
          }
        }
      }
    }

    return NextResponse.json({ skills: skillsList });
  } catch (error) {
    console.error('Error listing skills:', error);
    return NextResponse.json({ error: 'Failed to list skills' }, { status: 500 });
  }
}

/** POST create new skill */
export async function POST(req: Request) {
  try {
    const { skillId, name, description, category, content } = await req.json();

    if (!skillId || !name || !description || content === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: skillId, name, description, content' },
        { status: 400 }
      );
    }

    // Validate skillId (alphanumeric + hyphens/underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(skillId)) {
      return NextResponse.json(
        { error: 'Invalid skillId. Use only letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    // Ensure skills directory exists
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }

    const skillDir = path.join(SKILLS_DIR, skillId);
    const skillFilePath = path.join(skillDir, 'SKILL.md');

    // Check if skill already exists
    if (fs.existsSync(skillFilePath)) {
      return NextResponse.json(
        { error: `Skill '${skillId}' already exists` },
        { status: 409 }
      );
    }

    // Create skill directory
    fs.mkdirSync(skillDir, { recursive: true });

    // Serialize skill file
    const fileContent = serializeSkillFile({
      metadata: { name, description, category },
      content,
    });

    // Write file
    fs.writeFileSync(skillFilePath, fileContent, 'utf-8');

    return NextResponse.json({
      success: true,
      skill: {
        id: skillId,
        name,
        description,
        category,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error creating skill:', error);
    return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 });
  }
}

/** DELETE a specific skill by ID */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      // If no id provided, delete all skills (for cleanup)
      if (fs.existsSync(SKILLS_DIR)) {
        fs.rmSync(SKILLS_DIR, { recursive: true });
      }
      return NextResponse.json({ success: true, message: 'All skills deleted' });
    }

    const skillDir = path.join(SKILLS_DIR, id);
    
    if (!fs.existsSync(skillDir)) {
      return NextResponse.json({ error: `Skill '${id}' not found` }, { status: 404 });
    }

    fs.rmSync(skillDir, { recursive: true });
    
    return NextResponse.json({ success: true, message: `Skill '${id}' deleted` });
  } catch (error) {
    console.error('Error deleting skill:', error);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
