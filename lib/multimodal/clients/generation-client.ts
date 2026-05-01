/**
 * Клиент для генерации текста с поддержкой мультимодальных входов
 */

import { MultimodalModel, MultimodalProvider } from './types';
import { MULTIMODAL_CONFIGS, MULTIMODAL_ENDPOINTS } from './config';

export interface GenerationRequest {
  model?: MultimodalModel;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: {
        url: string;
      };
    }>;
  }>;
  maxTokens?: number;
  temperature?: number;
  provider?: MultimodalProvider;
}

export interface GenerationResponse {
  success: boolean;
  content?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;
  provider: MultimodalProvider;
  model: MultimodalModel;
  error?: string;
}

export class GenerationClient {
  private provider: MultimodalProvider;
  private apiKey?: string;

  constructor(provider: MultimodalProvider = 'openrouter', apiKey?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    try {
      if (this.provider === 'openrouter') {
        return await this.generateWithOpenRouter(request);
      } else {
        return await this.generateWithOllama(request);
      }
    } catch (error) {
      console.error('Generation error:', error);
      
      if (this.provider === 'openrouter') {
        console.log('Falling back to Ollama...');
        return await this.generateWithOllama(request);
      }
      
      return {
        success: false,
        provider: this.provider,
        model: request.model || 'gpt-4o',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async generateWithOpenRouter(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model || 'gpt-4o';
    const config = MULTIMODAL_CONFIGS.openrouter.generation[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.generation] ||
                   MULTIMODAL_CONFIGS.openrouter.vision[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.vision];
    
    if (!config) {
      throw new Error(`Model ${model} not supported`);
    }

    const messages = await this.buildMessages(request);
    
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
    
    return this.parseGenerationResponse(data, model);
  }

  private async generateWithOllama(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model || 'llama3:8b';
    const config = MULTIMODAL_CONFIGS.ollama.generation[model as keyof typeof MULTIMODAL_CONFIGS.ollama.generation];
    
    if (!config) {
      throw new Error(`Model ${model} not supported`);
    }

    const prompt = await this.buildOllamaPrompt(request);
    
    const response = await fetch(MULTIMODAL_ENDPOINTS.ollama.baseURL + '/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        max_tokens: config.maxTokens,
        temperature: request.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return this.parseOllamaGenerationResponse(data, model);
  }

  private async buildMessages(request: GenerationRequest) {
    const processedMessages = [];
    
    for (const message of request.messages) {
      if (typeof message.content === 'string') {
        processedMessages.push({
          role: message.role,
          content: message.content,
        });
      } else {
        const contentParts = [];
        
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            contentParts.push({
              type: 'text',
              text: part.text,
            });
          } else if (part.type === 'image_url' && part.image_url) {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: part.image_url.url,
              },
            });
          }
        }
        
        processedMessages.push({
          role: message.role,
          content: contentParts,
        });
      }
    }
    
    return processedMessages;
  }

  private async buildOllamaPrompt(request: GenerationRequest): Promise<string> {
    let prompt = '';
    
    for (const message of request.messages) {
      if (message.role === 'system') {
        prompt += `System: ${typeof message.content === 'string' ? message.content : ''}\n\n`;
      } else if (message.role === 'user') {
        if (typeof message.content === 'string') {
          prompt += `User: ${message.content}\n\n`;
        } else {
          for (const part of message.content) {
            if (part.type === 'text' && part.text) {
              prompt += `User: ${part.text}\n\n`;
            }
          }
        }
      }
    }
    
    prompt += 'Assistant: ';
    
    return prompt;
  }

  private parseGenerationResponse(data: any, model: string): GenerationResponse {
    const content = data.choices[0]?.message?.content || '';
    
    return {
      success: true,
      content,
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

  private parseOllamaGenerationResponse(data: any, model: string): GenerationResponse {
    const content = data.response || '';
    
    return {
      success: true,
      content,
      provider: 'ollama',
      model,
    };
  }

  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const visionConfig = MULTIMODAL_CONFIGS.openrouter.vision[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.vision];
    const generationConfig = MULTIMODAL_CONFIGS.openrouter.generation[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.generation];
    
    const config = visionConfig || generationConfig;
    
    if (!config) return 0;
    
    const promptCost = (promptTokens / 1000) * config.costPer1KPrompt;
    const completionCost = (completionTokens / 1000) * config.costPer1KCompletion;
    
    return promptCost + completionCost;
  }
}