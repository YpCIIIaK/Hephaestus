import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Pipelines directory
const PIPELINES_DIR = path.join(process.cwd(), 'data', 'agent-pipelines');

/** GET all pipelines */
export async function GET() {
  try {
    const pipelinesList: any[] = [];

    if (fs.existsSync(PIPELINES_DIR)) {
      const files = fs.readdirSync(PIPELINES_DIR).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const content = fs.readFileSync(path.join(PIPELINES_DIR, file), 'utf-8');
        try {
          const pipeline = JSON.parse(content);
          pipelinesList.push({
            id: pipeline.id,
            name: pipeline.name,
            description: pipeline.description,
            stepsCount: pipeline.steps?.length || 0,
            updatedAt: pipeline.updatedAt,
          });
        } catch (e) {
          console.error(`Error parsing ${file}:`, e);
        }
      }
    }

    return NextResponse.json({ pipelines: pipelinesList });
  } catch (error) {
    console.error('Error listing pipelines:', error);
    return NextResponse.json({ error: 'Failed to list pipelines' }, { status: 500 });
  }
}

/** POST save pipeline */
export async function POST(req: Request) {
  try {
    const pipeline = await req.json();

    if (!pipeline.id || !pipeline.name) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name' },
        { status: 400 }
      );
    }

    // Ensure directory exists
    if (!fs.existsSync(PIPELINES_DIR)) {
      fs.mkdirSync(PIPELINES_DIR, { recursive: true });
    }

    const filePath = path.join(PIPELINES_DIR, `${pipeline.id}.json`);

    // Add timestamps
    const now = new Date().toISOString();
    pipeline.createdAt = pipeline.createdAt || now;
    pipeline.updatedAt = now;

    // Write file
    fs.writeFileSync(filePath, JSON.stringify(pipeline, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      pipeline: {
        id: pipeline.id,
        name: pipeline.name,
        description: pipeline.description,
        stepsCount: pipeline.steps?.length || 0,
        updatedAt: pipeline.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error saving pipeline:', error);
    return NextResponse.json({ error: 'Failed to save pipeline' }, { status: 500 });
  }
}

/** DELETE pipeline */
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }

    const filePath = path.join(PIPELINES_DIR, `${id}.json`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return NextResponse.json({ success: true, message: 'Pipeline deleted' });
    }

    return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
  } catch (error) {
    console.error('Error deleting pipeline:', error);
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 });
  }
}

/** GET specific pipeline */
export async function GET_ID(req: Request, { params }: { params: { id: string } }) {
  try {
    const filePath = path.join(PIPELINES_DIR, `${params.id}.json`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const pipeline = JSON.parse(content);

    return NextResponse.json({ pipeline });
  } catch (error) {
    console.error('Error loading pipeline:', error);
    return NextResponse.json({ error: 'Failed to load pipeline' }, { status: 500 });
  }
}