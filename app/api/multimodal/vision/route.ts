import { NextResponse } from 'next/server';
import { VisionClient } from '@/lib/multimodal/clients/vision-client';
import { VisionRequest } from '@/lib/multimodal/types';

// POST /api/multimodal/vision - Анализ изображения
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      image, 
      task, 
      model, 
      prompt, 
      maxTokens, 
      temperature,
      provider = 'openrouter' 
    } = body as VisionRequest;

    if (!image || !task) {
      return NextResponse.json(
        { error: 'Image and task are required' },
        { status: 400 }
      );
    }

    // Проверка размера изображения
    if (typeof image === 'string' && image.length > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Image size exceeds 20MB limit' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const visionClient = new VisionClient(provider, apiKey);
    
    const result = await visionClient.analyze({
      image,
      task,
      model,
      prompt,
      maxTokens,
      temperature,
      provider,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Vision analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze image' },
      { status: 500 }
    );
  }
}

// GET /api/multimodal/vision/health - Проверка доступности сервиса
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = (searchParams.get('provider') || 'openrouter') as 'openrouter' | 'ollama';
    const model = searchParams.get('model') || 'gpt-4o';

    const apiKey = process.env.OPENROUTER_API_KEY;
    const visionClient = new VisionClient(provider, apiKey);

    // Тестовый запрос с простым изображением
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    const result = await visionClient.analyze({
      image: testImage,
      task: 'describe',
      model,
      prompt: 'Describe this simple image',
    });

    return NextResponse.json({
      status: result.success ? 'available' : 'degraded',
      provider,
      model,
      lastCheck: new Date().toISOString(),
      responseTime: result.tokens ? result.tokens.total * 10 : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { 
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'Unknown error',
        lastCheck: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}