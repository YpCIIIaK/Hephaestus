/**
 * Slack API клиент для интеграции
 */

interface SlackMessage {
  text?: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
  attachments?: any[];
  blocks?: any[];
}

export class SlackClient {
  private webhookUrl: string;
  private defaultChannel?: string;
  private defaultUsername: string;

  constructor(webhookUrl: string, channel?: string, username?: string) {
    this.webhookUrl = webhookUrl;
    this.defaultChannel = channel;
    this.defaultUsername = username || 'Hephaestus Bot';
  }

  // Отправка сообщения
  async sendMessage(message: string, channel?: string, options: Partial<SlackMessage> = {}) {
    const payload: SlackMessage = {
      text: message,
      channel: channel || this.defaultChannel,
      username: this.defaultUsername,
      icon_emoji: ':robot_face:',
      ...options,
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    return { success: true };
  }

  // Отправка сообщения о завершении пайплайна
  async sendPipelineComplete(pipelineName: string, result: any, channel?: string) {
    const message = `🏁 *Pipeline Complete: ${pipelineName}*\n\n${this.formatResult(result)}`;
    return this.sendMessage(message, channel);
  }

  // Отправка сообщения об ошибке
  async sendError(error: string, channel?: string) {
    const message = `🚨 *Error*\n\n${error}`;
    return this.sendMessage(message, channel, {
      icon_emoji: ':x:',
    });
  }

  // Отправка уведомления о новом PR
  async sendPRNotification(prData: any, channel?: string) {
    const message = `🔍 *New Pull Request*\n\n*${prData.title}*\n${prData.html_url}\n\nBy: ${prData.user.login}`;
    return this.sendMessage(message, channel);
  }

  // Отправка результатов анализа кода
  async sendCodeReview(prNumber: number, analysis: string, channel?: string) {
    const message = `🤖 *AI Code Review - PR #${prNumber}*\n\n${analysis}`;
    return this.sendMessage(message, channel);
  }

  // Форматирование результатов
  private formatResult(result: any): string {
    if (typeof result === 'string') {
      return result;
    }
    
    if (Array.isArray(result)) {
      return result.map((item, i) => `${i + 1}. ${item}`).join('\n');
    }
    
    if (typeof result === 'object') {
      return Object.entries(result)
        .map(([key, value]) => `*${key}:* ${value}`)
        .join('\n');
    }
    
    return JSON.stringify(result, null, 2);
  }

  // Проверка подключения
  async testConnection() {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Test message from Hephaestus',
          username: this.defaultUsername,
          icon_emoji: ':robot_face:',
        }),
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