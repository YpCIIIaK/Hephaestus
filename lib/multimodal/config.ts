import { MultimodalModel, MultimodalProvider } from './types';

export const MULTIMODAL_CONFIGS = {
  openrouter: {
    vision: {
      // GPT models
      'gpt-4o': {
        maxTokens: 4096,
        costPer1KPrompt: 0.005,
        costPer1KCompletion: 0.015,
        supportsVision: true,
      },
      'gpt-4-vision-preview': {
        maxTokens: 4096,
        costPer1KPrompt: 0.01,
        costPer1KCompletion: 0.03,
        supportsVision: true,
      },
      'gpt-4': {
        maxTokens: 8192,
        costPer1KPrompt: 0.03,
        costPer1KCompletion: 0.06,
        supportsVision: false,
      },
      // Claude models
      'claude-3-opus-20240229': {
        maxTokens: 4096,
        costPer1KPrompt: 0.015,
        costPer1KCompletion: 0.075,
        supportsVision: true,
      },
      'claude-3-sonnet-20240229': {
        maxTokens: 4096,
        costPer1KPrompt: 0.003,
        costPer1KCompletion: 0.015,
        supportsVision: true,
      },
      'claude-3-haiku-20240307': {
        maxTokens: 4096,
        costPer1KPrompt: 0.00025,
        costPer1KCompletion: 0.00125,
        supportsVision: true,
      },
      // LLaVA models
      'llava-13b': {
        maxTokens: 2048,
        costPer1KPrompt: 0.0003,
        costPer1KCompletion: 0.0003,
        supportsVision: true,
      },
      'llava-34b': {
        maxTokens: 4096,
        costPer1KPrompt: 0.0006,
        costPer1KCompletion: 0.0006,
        supportsVision: true,
      },
      // Other vision models
      'qwen-vl-plus': {
        maxTokens: 4096,
        costPer1KPrompt: 0.002,
        costPer1KCompletion: 0.002,
        supportsVision: true,
      },
      'qwen-vl-max': {
        maxTokens: 4096,
        costPer1KPrompt: 0.008,
        costPer1KCompletion: 0.008,
        supportsVision: true,
      },
    },
    speech: {
      'whisper-1': {
        costPerMinute: 0.006,
      },
      'tts-1': {
        costPer1KCharacters: 0.015,
      },
      'tts-1-hd': {
        costPer1KCharacters: 0.03,
      },
    },
    document: {
      'gpt-4': {
        maxTokens: 8192,
        costPer1KPrompt: 0.03,
        costPer1KCompletion: 0.06,
      },
      'claude-3-opus-20240229': {
        maxTokens: 4096,
        costPer1KPrompt: 0.015,
        costPer1KCompletion: 0.075,
      },
    },
    generation: {
      'gpt-4o': {
        maxTokens: 4096,
        costPer1KPrompt: 0.005,
        costPer1KCompletion: 0.015,
      },
      'claude-3-sonnet-20240229': {
        maxTokens: 4096,
        costPer1KPrompt: 0.003,
        costPer1KCompletion: 0.015,
      },
    },
  },
  ollama: {
    vision: {
      'llava:13b': {
        maxTokens: 2048,
        supportsVision: true,
      },
      'llava:34b': {
        maxTokens: 4096,
        supportsVision: true,
      },
      'moondream:latest': {
        maxTokens: 2048,
        supportsVision: true,
      },
    },
    speech: {
      'whisper:base': {
        maxLength: 30,
      },
      'whisper:medium': {
        maxLength: 60,
      },
      'whisper:large': {
        maxLength: 120,
      },
    },
    generation: {
      'llama3:8b': {
        maxTokens: 4096,
      },
      'mistral:7b': {
        maxTokens: 4096,
      },
    },
  },
} as const;

export const DEFAULT_MULTIMODAL_CONFIG = {
  vision: {
    defaultModel: 'gpt-4o' as MultimodalModel,
    fallbackModel: 'llava:13b' as MultimodalModel,
    maxImageSize: 20 * 1024 * 1024,
    supportedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  },
  speech: {
    defaultModel: 'whisper-1' as MultimodalModel,
    fallbackModel: 'whisper:medium' as MultimodalModel,
    maxAudioSize: 25 * 1024 * 1024,
    maxDuration: 60 * 60,
    supportedFormats: ['mp3', 'wav', 'm4a', 'flac', 'ogg'],
  },
  document: {
    defaultModel: 'gpt-4' as MultimodalModel,
    fallbackModel: 'gpt-4' as MultimodalModel,
    maxFileSize: 50 * 1024 * 1024,
    supportedFormats: ['pdf', 'docx', 'txt', 'md'],
  },
  video: {
    defaultModel: 'gpt-4o' as MultimodalModel,
    fallbackModel: 'gpt-4o' as MultimodalModel,
    maxFileSize: 100 * 1024 * 1024,
    maxDuration: 30 * 60,
    supportedFormats: ['mp4', 'webm', 'avi', 'mov'],
    defaultSampleInterval: 1,
  },
  generation: {
    defaultModel: 'gpt-4o' as MultimodalModel,
    fallbackModel: 'llama3:8b' as MultimodalModel,
  },
};

// Динамическое получение моделей из OpenRouter
export async function fetchOpenRouterModels(): Promise<string[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Hephaestus Multimodal',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    
    // Фильтруем только модели с поддержкой vision
    const visionModels = data.data
      .filter((model: any) => 
        model.id.includes('vision') || 
        model.id.includes('gpt-4') ||
        model.id.includes('claude-3') ||
        model.id.includes('llava') ||
        model.id.includes('qwen-vl')
      )
      .map((model: any) => model.id);

    return visionModels;
  } catch (error) {
    console.error('Error fetching OpenRouter models:', error);
    return [];
  }
}
