/**
 * Клиент для обработки документов (OCR, извлечение структуры, суммаризация)
 */

import { DocumentRequest, DocumentResponse, MultimodalModel, MultimodalProvider, DocumentTask } from './types';
import { MULTIMODAL_CONFIGS, MULTIMODAL_ENDPOINTS } from './config';

export class DocumentClient {
  private provider: MultimodalProvider;
  private apiKey?: string;

  constructor(provider: MultimodalProvider = 'openrouter', apiKey?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
  }

  async process(request: DocumentRequest): Promise<DocumentResponse> {
    try {
      if (this.provider === 'openrouter') {
        return await this.processWithOpenRouter(request);
      } else {
        return await this.processWithOllama(request);
      }
    } catch (error) {
      console.error('Document processing error:', error);
      
      if (this.provider === 'openrouter') {
        console.log('Falling back to Ollama...');
        return await this.processWithOllama(request);
      }
      
      return {
        success: false,
        provider: this.provider,
        model: request.model || 'gpt-4',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async processWithOpenRouter(request: DocumentRequest): Promise<DocumentResponse> {
    const model = request.model || 'gpt-4';
    const config = MULTIMODAL_CONFIGS.openrouter.document[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.document] ||
                   MULTIMODAL_CONFIGS.openrouter.vision[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.vision];
    
    if (!config) {
      throw new Error(`Model ${model} not supported for documents`);
    }

    const messages = this.buildMessages(request);
    
    const response = await fetch(MULTIMODAL_ENDPOINTS.openrouter.baseURL + MULTIMODAL_ENDPOINTS.openrouter.vision, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Hephaestus Document Processing',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens || config.maxTokens,
        temperature: request.temperature || 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return this.parseDocumentResponse(data, model, request.task);
  }

  private async processWithOllama(request: DocumentRequest): Promise<DocumentResponse> {
    const model = request.model || 'llama3:8b';
    const config = MULTIMODAL_CONFIGS.ollama.generation[model as keyof typeof MULTIMODAL_CONFIGS.ollama.generation];
    
    if (!config) {
      throw new Error(`Model ${model} not supported`);
    }

    const prompt = this.buildOllamaPrompt(request);
    
    const response = await fetch(MULTIMODAL_ENDPOINTS.ollama.baseURL + '/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        max_tokens: config.maxTokens,
        temperature: request.temperature || 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return this.parseOllamaDocumentResponse(data, model, request.task);
  }

  private buildMessages(request: DocumentRequest) {
    const content = this.getDocumentContent(request.document);
    
    const systemPrompt = this.getSystemPrompt(request.task, request.extractOptions);
    const userPrompt = request.prompt || this.getDefaultPrompt(request.task);
    
    return [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPrompt,
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
  }

  private buildOllamaPrompt(request: DocumentRequest): string {
    const systemPrompt = this.getSystemPrompt(request.task, request.extractOptions);
    const userPrompt = request.prompt || this.getDefaultPrompt(request.task);
    
    return `${systemPrompt}\n\nDocument: [uploaded]\n\n${userPrompt}\n\nAnswer:`;
  }

  private getDocumentContent(document: string): string {
    if (document.startsWith('http://') || document.startsWith('https://')) {
      return document;
    }
    // Предполагаем, что это PDF или изображение в base64
    if (document.startsWith('data:')) {
      return document;
    }
    return `data:application/pdf;base64,${document}`;
  }

  private getSystemPrompt(task: DocumentTask, options?: DocumentRequest['extractOptions']): string {
    const prompts: Record<DocumentTask, string> = {
      extract: `Extract all text from the document accurately. 
        ${options?.includeImages ? 'Also describe any images found.' : ''}
        ${options?.includeTables ? 'Preserve table structure in markdown format.' : ''}
        ${options?.preserveStructure ? 'Maintain document structure with headings and paragraphs.' : ''}`,
      summarize: 'Summarize the document concisely, capturing key points and main ideas.',
      qa: 'Answer questions based on the document content. Be precise and reference specific sections when possible.',
      classify: 'Classify the document type and provide relevant categories with confidence scores.',
    };
    
    return prompts[task];
  }

  private getDefaultPrompt(task: DocumentTask): string {
    const prompts: Record<DocumentTask, string> = {
      extract: 'Please extract all content from this document.',
      summarize: 'Please summarize this document.',
      qa: 'Please answer questions about this document.',
      classify: 'Please classify this document.',
    };
    
    return prompts[task];
  }

  private parseDocumentResponse(data: any, model: string, task: DocumentTask): DocumentResponse {
    const content = data.choices[0]?.message?.content || '';
    
    let structuredData: DocumentResponse['structuredData'] = undefined;
    
    if (task === 'extract') {
      structuredData = this.parseExtractedContent(content);
    } else if (task === 'classify') {
      structuredData = this.parseClassification(content);
    }
    
    return {
      success: true,
      content: task === 'extract' ? undefined : content,
      extractedText: task === 'extract' ? content : undefined,
      summary: task === 'summarize' ? content : undefined,
      structuredData,
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

  private parseOllamaDocumentResponse(data: any, model: string, task: DocumentTask): DocumentResponse {
    const content = data.response || '';
    
    let structuredData: DocumentResponse['structuredData'] = undefined;
    
    if (task === 'extract') {
      structuredData = this.parseExtractedContent(content);
    }
    
    return {
      success: true,
      content: task === 'extract' ? undefined : content,
      extractedText: task === 'extract' ? content : undefined,
      summary: task === 'summarize' ? content : undefined,
      structuredData,
      provider: 'ollama',
      model,
    };
  }

  private parseExtractedContent(content: string): DocumentResponse['structuredData'] {
    // Простой парсинг структуры
    const lines = content.split('\n');
    const sections: any[] = [];
    let currentSection: any = null;
    let currentPage = 1;
    
    for (const line of lines) {
      if (line.match(/^#+ /)) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: line.replace(/^#+ /, '').trim(),
          content: '',
          page: currentPage,
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else if (line.trim()) {
        currentSection = {
          title: 'Untitled Section',
          content: line + '\n',
          page: currentPage,
        };
      }
    }
    
    if (currentSection) {
      sections.push(currentSection);
    }
    
    return {
      sections,
    };
  }

  private parseClassification(content: string): DocumentResponse['structuredData'] {
    // Простой парсинг классификации
    const categories = content.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const match = line.match(/^(.+?):\s*(\d+%|\d+\.\d+)/);
        if (match) {
          return {
            category: match[1].trim(),
            confidence: parseFloat(match[2]) / 100,
          };
        }
        return null;
      })
      .filter(Boolean);
    
    return {
      categories: categories.length ? categories : undefined,
    };
  }

  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const config = MULTIMODAL_CONFIGS.openrouter.document[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.document] ||
                   MULTIMODAL_CONFIGS.openrouter.vision[model as keyof typeof MULTIMODAL_CONFIGS.openrouter.vision];
    
    if (!config) return 0;
    
    const promptCost = (promptTokens / 1000) * config.costPer1KPrompt;
    const completionCost = (completionTokens / 1000) * config.costPer1KCompletion;
    
    return promptCost + completionCost;
  }
}