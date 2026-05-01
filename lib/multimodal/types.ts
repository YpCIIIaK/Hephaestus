/**
 * Типы для мультимодального ИИ
 */

export type MultimodalModel = 
  // Vision models
  | 'gpt-4-vision-preview'
  | 'gpt-4o'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'llava-13b'
  | 'llava-34b'
  
  // Speech models
  | 'whisper-1'
  | 'tts-1'
  | 'tts-1-hd'
  
  // Document models
  | 'gpt-4'
  | 'claude-3-opus'
  
  // Local models (Ollama)
  | 'llava:13b'
  | 'llava:34b'
  | 'whisper:base'
  | 'whisper:medium'
  | 'whisper:large';

export type MultimodalProvider = 'openrouter' | 'ollama';

export type VisionTask = 'describe' | 'analyze' | 'extract-text' | 'detect-objects' | 'classify';

export type SpeechTask = 'transcribe' | 'translate' | 'generate';

export type DocumentTask = 'extract' | 'summarize' | 'qa' | 'classify';

export interface VisionRequest {
  model?: MultimodalModel;
  task: VisionTask;
  image: string; // base64 encoded or URL
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  provider?: MultimodalProvider;
}

export interface VisionResponse {
  success: boolean;
  description?: string;
  analysis?: {
    objects: Array<{
      label: string;
      confidence: number;
      bbox?: [number, number, number, number];
    }>;
    text?: string;
    classification?: string;
  };
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

export interface SpeechToTextRequest {
  model?: MultimodalModel;
  audio: string; // base64 encoded or URL
  language?: string;
  format?: 'text' | 'srt' | 'vtt';
  temperature?: number;
  provider?: MultimodalProvider;
}

export interface SpeechToTextResponse {
  success: boolean;
  text?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
  tokens?: {
    audio: number;
    total: number;
  };
  cost?: number;
  provider: MultimodalProvider;
  model: MultimodalModel;
  error?: string;
}

export interface TextToSpeechRequest {
  model?: MultimodalModel;
  text: string;
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  format?: 'mp3' | 'wav' | 'flac' | 'ogg';
  speed?: number;
  provider?: MultimodalProvider;
}

export interface TextToSpeechResponse {
  success: boolean;
  audio?: string; // base64 encoded
  format?: string;
  duration?: number;
  cost?: number;
  provider: MultimodalProvider;
  model: MultimodalModel;
  error?: string;
}

export interface DocumentRequest {
  model?: MultimodalModel;
  task: DocumentTask;
  document: string; // base64 encoded or URL
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  provider?: MultimodalProvider;
  extractOptions?: {
    includeImages?: boolean;
    includeTables?: boolean;
    preserveStructure?: boolean;
  };
}

export interface DocumentResponse {
  success: boolean;
  content?: string;
  extractedText?: string;
  summary?: string;
  structuredData?: {
    title?: string;
    author?: string;
    pages?: number;
    sections?: Array<{
      title: string;
      content: string;
      page: number;
    }>;
    tables?: Array<{
      data: any[][];
      caption?: string;
    }>;
  };
  answer?: string;
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

export interface VideoRequest {
  model?: MultimodalModel;
  video: string; // URL or path
  task: 'summarize' | 'analyze' | 'extract-scenes' | 'describe';
  prompt?: string;
  maxTokens?: number;
  sampleInterval?: number; // seconds between frame samples
  provider?: MultimodalProvider;
}

export interface VideoResponse {
  success: boolean;
  summary?: string;
  analysis?: {
    scenes: Array<{
      start: number;
      end: number;
      description: string;
      objects?: string[];
    }>;
    keyMoments?: Array<{
      timestamp: number;
      description: string;
    }>;
  };
  description?: string;
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

export interface MultimodalHealth {
  provider: MultimodalProvider;
  model: MultimodalModel;
  status: 'available' | 'degraded' | 'unavailable';
  lastCheck: string;
  responseTime?: number;
  error?: string;
}
