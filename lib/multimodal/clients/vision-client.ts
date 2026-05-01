/**
 * Vision API клиент для мультимодального анализа
 */

import { VisionRequest, VisionResponse, MultimodalProvider } from './types';
import { MULTIMODAL_CONFIGS, MULTIMODAL_ENDPOINTS } from './config';

export class VisionClient {
  private provider: MultimodalProvider;
  private apiKey?: string;

  constructor(provider: MultimodalProvider = 'openrouter', apiKey?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
  }

  // Анализ изображения
  async analyze(request: VisionRequest): Promise<VisionResponse> {
    try {
      if (this.provider === 'openrouter') {
        return await this.analyzeWithOpenRouter(request);
      } else {
        return await this.analyzeWithOllama(request);
      }
    } catch (error) {
      console.error('Vision analysis error:', error);
      
      // Попытка использовать резервный провайдер
      if (this.provider === 'openrouter') {
        console.log('Falling back to Ollama...');
        return await this.analyzeWithOllama(request);
      }
      
      return {
        success: false,
        provider: this.provider,
        model: request.model || 'gpt-4o',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Анализ через OpenRouter
  private async analyzeWithOpenRouter(request: VisionRequest): Promise<VisionResponse> {
    const model = request.model || 'gpt-4o';
    const config = MULTIMODAL_CONFIGS.openrouter.vision[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.vision];
    
    if (!config) {
      throw new Error(`Model ${model} not supported`);
    }

    const messages = this.buildVisionMessages(request);
    
    const response = await fetch(MULTIMODAL_ENDPOINTS.openrouter.baseURL + MULTIMODAL_ENDPOINTS.openrouter.vision, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Hephaestus Multimodal',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens || config.maxTokens,
        temperature: request.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return this.parseVisionResponse(data, model, request.task);
  }

  // Анализ через Ollama
  private async analyzeWithOllama(request: VisionRequest): Promise<VisionResponse> {
    const model = request.model || 'llava:13b';
    const config = MULTIMODAL_CONFIGS.ollama.vision[model as keyof typeof MULTIMODAL_CONFIGS.ollama.vision];
    
    if (!config) {
      throw new Error(`Model ${model} not supported`);
    }

    const prompt = this.buildOllamaPrompt(request);
    
    const response = await fetch(MULTIMODAL_ENDPOINTS.ollama.baseURL + MULTIMODAL_ENDPOINTS.ollama.vision, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        images: [request.image],
        max_tokens: config.maxTokens,
        temperature: request.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return this.parseOllamaVisionResponse(data, model, request.task);
  }

  // Формирование сообщений для OpenRouter
  private buildVisionMessages(request: VisionRequest) {
    const content = this.getImageContent(request.image);
    
    const messages: any[] = [
      {
        role: 'system',
        content: this.getSystemPrompt(request.task),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: request.prompt || this.getDefaultPrompt(request.task),
          },
          {
            type: 'image_url',
            image_url: {
              url: content,
            },
          },
        ],
      },
    ];

    return messages;
  }

  // Формирование промпта для Ollama
  private buildOllamaPrompt(request: VisionRequest): string {
    const systemPrompt = this.getSystemPrompt(request.task);
    const userPrompt = request.prompt || this.getDefaultPrompt(request.task);
    
    return `${systemPrompt}\n\n${userPrompt}`;
  }

  // Получение контента изображения
  private getImageContent(image: string): string {
    if (image.startsWith('http://') || image.startsWith('https://')) {
      return image;
    }
    return `data:image/jpeg;base64,${image}`;
  }

  // Системный промпт
  private getSystemPrompt(task: VisionTask): string {
    const prompts: Record<VisionTask, string> = {
      describe: 'You are an expert at describing images in detail. Provide a comprehensive description of what you see.',
      analyze: 'You are an expert at analyzing images. Provide detailed analysis including objects, context, and insights.',
      'extract-text': 'Extract all text from the image accurately. Preserve formatting when possible.',
      'detect-objects': 'Detect and list all objects in the image with their locations and confidence scores.',
      classify: 'Classify the image and provide the most likely categories with confidence scores.',
    };
    
    return prompts[task];
  }

  // Промпт по умолчанию
  private getDefaultPrompt(task: VisionTask): string {
    const prompts: Record<VisionTask, string> = {
      describe: 'Please describe this image in detail.',
      analyze: 'Please analyze this image and provide insights.',
      'extract-text': 'Please extract all text from this image.',
      'detect-objects': 'Please detect all objects in this image.',
      classify: 'Please classify this image.',
    };
    
    return prompts[task];
  }

  // Парсинг ответа OpenRouter
  private parseVisionResponse(data: any, model: string, task: VisionTask): VisionResponse {
    const content = data.choices[0]?.message?.content || '';
    
    let analysis: VisionResponse['analysis'] = undefined;
    
    if (task === 'detect-objects') {
      analysis = this.parseObjectDetection(content);
    } else if (task === 'extract-text') {
      analysis = { text: content };
    } else if (task === 'classify') {
      analysis = { classification: content };
    }
    
    return {
      success: true,
      description: task === 'describe' || task === 'analyze' ? content : undefined,
      analysis,
      tokens: {
        prompt: data.usage?.prompt_tokens || 0,
        completion: data.usage?.completion_tokens || 0,
        total: data.usage?.total_tokens || 0,
      },
      cost: this.calculateCost(model, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0),
      provider: 'openrouter',
      model,
    };
  }

  // Парсинг ответа Ollama
  private parseOllamaVisionResponse(data: any, model: string, task: VisionTask): VisionResponse {
    const content = data.response || '';
    
    let analysis: VisionResponse['analysis'] = undefined;
    
    if (task === 'extract-text') {
      analysis = { text: content };
    } else if (task === 'classify') {
      analysis = { classification: content };
    }
    
    return {
      success: true,
      description: task === 'describe' || task === 'analyze' ? content : undefined,
      analysis,
      provider: 'ollama',
      model,
    };
  }

  // Парсинг детекции объектов
  private parseObjectDetection(content: string): VisionResponse['analysis'] {
    try {
      const objects = JSON.parse(content);
      return { objects };
    } catch {
      return { objects: [] };
    }
  }

  // Расчет стоимости
  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const config = MULTIMODAL_CONFIGS.openrouter.vision[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.vision];
    
    if (!config) return 0;
    
    const promptCost = (promptTokens / 1000) * config.costPer1KPrompt;
    const completionCost = (completionTokens / 1000) * config.costPer1KCompletion;
    
    return promptCost + completionCost;
  }
}