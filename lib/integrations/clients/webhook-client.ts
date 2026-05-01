/**
 * Универсальный Webhook клиент
 */

interface WebhookOptions {
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  payloadTemplate?: string;
}

export class WebhookClient {
  private url: string;
  private options: WebhookOptions;

  constructor(url: string, options: WebhookOptions = {}) {
    this.url = url;
    this.options = {
      method: 'POST',
      ...options,
    };
  }

  // Отправка webhook
  async send(data: any, event?: string) {
    const payload = this.buildPayload(data, event);
    
    const response = await fetch(this.url, {
      method: this.options.method,
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status} ${response.statusText}`);
    }

    return { 
      success: true,
      status: response.status,
      data: await response.json().catch(() => null)
    };
  }

  // Формирование payload по шаблону
  private buildPayload(data: any, event?: string): any {
    if (!this.options.payloadTemplate) {
      return {
        event,
        data,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      // Замена переменных в шаблоне
      let template = this.options.payloadTemplate;
      template = template.replace(/\{\{event\}\}/g, event || '');
      template = template.replace(/\{\{data\}\}/g, JSON.stringify(data));
      template = template.replace(/\{\{timestamp\}\}/g, new Date().toISOString());

      // Рекурсивная замена вложенных полей
      const replaceNested = (obj: any, data: any): any => {
        if (typeof obj === 'string') {
          return obj.replace(/\{\{(\w+)\}\}/g, (match: string, key: string) => {
            return key.split('.').reduce((o: any, k: string) => o?.[k], data) || match;
          });
        }
        
        if (Array.isArray(obj)) {
          return obj.map((item: any) => replaceNested(item, data));
        }
        
        if (typeof obj === 'object' && obj !== null) {
          const result: any = {};
          for (const [key, value] of Object.entries(obj)) {
            result[key] = replaceNested(value, data);
          }
          return result;
        }
        
        return obj;
      };

      return JSON.parse(template);
    } catch (error) {
      console.error('Error parsing webhook template:', error);
      return {
        event,
        data,
        timestamp: new Date().toISOString(),
        error: 'Template parsing failed',
      };
    }
  }

  // Тестирование подключения
  async testConnection() {
    try {
      const testData = {
        test: true,
        message: 'Test webhook from Hephaestus',
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testData),
      });

      return {
        success: response.ok,
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}