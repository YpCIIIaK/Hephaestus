import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    const models = data.data.map((model: any) => ({
      id: model.id,
      name: model.name,
      provider: getProviderFromId(model.id),
      description: model.description || `Context: ${model.context_length}, Prompt: $${(model.pricing.prompt * 1000000).toFixed(2)} / 1M`,
      enabled: true,
      level: 1,
      temperature: 0.7,
      maxTokens: 4096,
      pricing: {
        prompt: parseFloat(model.pricing.prompt),
        completion: parseFloat(model.pricing.completion),
        request: parseFloat(model.pricing.request)
      }
    }));
    
    // Filter out some unstable or deprecated models
    const sortedModels = models.sort((a: any, b: any) => a.name.localeCompare(b.name));
    
    return NextResponse.json({ models: sortedModels });
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}

function getProviderFromId(id: string): string {
  if (id.startsWith('openai/')) return 'openai';
  if (id.startsWith('anthropic/')) return 'anthropic';
  if (id.startsWith('google/')) return 'google';
  if (id.startsWith('meta-llama/')) return 'meta';
  if (id.startsWith('mistralai/')) return 'mistral';
  return 'custom';
}
