import { NextResponse } from 'next/server';
import { TextToSpeechClient } from '@/lib/multimodal/clients/speech-client';
import { TextToSpeechRequest } from '@/lib/multimodal/types';

// POST /api/multimodal/speech - Text-to-Speech
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      text, 
      model, 
      voice, 
      format, 
      speed,
      provider = 'openrouter'
    } = body as TextToSpeechRequest;

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const speechClient = new TextToSpeechClient(provider, apiKey);
    
    const result = await speechClient.synthesize({
      text,
      model,
      voice,
      format,
      speed,
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
    console.error('Speech synthesis error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech' },
      { status: 500 }
    );
  }
}

// GET /api/multimodal/speech/health - Проверка доступности сервиса
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = (searchParams.get('provider') || 'openrouter') as 'openrouter' | 'ollama';
    const model = searchParams.get('model') || 'tts-1';

    const apiKey = process.env.OPENROUTER_API_KEY;
    const speechClient = new TextToSpeechClient(provider, apiKey);

    const result = await speechClient.synthesize({
      text: 'Test audio generation',
      model,
      voice: 'alloy',
      format: 'mp3',
      speed: 1.0,
      provider,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      status: 'ok',
      provider,
      model,
      hasAudio: !!result.audio
    });
  } catch (error) {
    console.error('Speech service health check error:', error);
    return NextResponse.json(
      { error: 'Speech service unavailable' },
      { status: 500 }
    );
  }
}