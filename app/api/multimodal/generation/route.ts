import { NextResponse } from 'next/server';
import { GenerationClient } from '@/lib/multimodal/clients/generation-client';
import { GenerationRequest } from '@/lib/multimodal/types';

// POST /api/multimodal/generation - Генерация текста с мультимодальными входами
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      messages, 
      model, 
      maxTokens, 
      temperature,
      provider = 'openrouter' 
    } = body as GenerationRequest;

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const generationClient = new GenerationClient(provider, apiKey);
    
    const result = await generationClient.generate({
      messages,
      model,
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
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate text' },
      { status: 500 }
    );
  }
}

// GET /api/multimodal/generation/health - Проверка доступности сервиса
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = (searchParams.get('provider') || 'openrouter') as 'openrouter' | 'ollama';
    const model = searchParams.get('model') || 'gpt-4o';

    const apiKey = process.env.OPENROUTER_API_KEY;
    const generationClient = new GenerationClient(provider, apiKey);

    const result = await generationClient.generate({
      messages: [
        {
          role: 'user',
          content: 'Hello, are you available?',
        },
      ],
      model,
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