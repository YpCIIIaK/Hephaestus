/**
 * Аналитика использования интеграций и мультимодальных запросов
 */

interface IntegrationEvent {
  id: string;
  type: string;
  success: boolean;
  timestamp: string;
  duration?: number;
  error?: string;
  metadata?: {
    model?: string;
    provider?: string;
    tokens?: number;
    cost?: number;
    task?: string;
    modality?: 'vision' | 'speech' | 'text' | 'document' | 'video';
  };
}

interface MultimodalEvent {
  id: string;
  type: 'vision' | 'speech' | 'generation' | 'document' | 'video';
  subtype: string;
  success: boolean;
  timestamp: string;
  duration?: number;
  error?: string;
  metadata: {
    model: string;
    provider: string;
    tokens?: number;
    cost?: number;
    task?: string;
    inputSize?: number;
  };
}

interface IntegrationAnalytics {
  integrationId: string;
  name: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageResponseTime: number;
  lastUsed: string;
  successRate: number;
}

interface MultimodalAnalytics {
  modality: 'vision' | 'speech' | 'generation' | 'document' | 'video';
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageResponseTime: number;
  totalTokens: number;
  totalCost: number;
  models: Array<{
    model: string;
    calls: number;
    successRate: number;
    averageCost: number;
  }>;
  tasks: Array<{
    task: string;
    calls: number;
    successRate: number;
  }>;
}

interface AnalyticsPeriod {
  period: 'day' | 'week' | 'month' | 'year';
  startDate: string;
  endDate: string;
}

export class IntegrationAnalyticsService {
  private events: IntegrationEvent[] = [];
  private multimodalEvents: MultimodalEvent[] = [];
  private readonly MAX_EVENTS = 10000;

  addEvent(event: IntegrationEvent) {
    this.events.unshift(event);
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(0, this.MAX_EVENTS);
    }
  }

  addMultimodalEvent(event: MultimodalEvent) {
    this.multimodalEvents.unshift(event);
    if (this.multimodalEvents.length > this.MAX_EVENTS) {
      this.multimodalEvents = this.multimodalEvents.slice(0, this.MAX_EVENTS);
    }
  }

  getAnalytics(period: AnalyticsPeriod): {
    totalIntegrations: number;
    activeIntegrations: number;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    integrations: IntegrationAnalytics[];
  } {
    const filteredEvents = this.events.filter(event => {
      const eventDate = new Date(event.timestamp);
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      return eventDate >= startDate && eventDate <= endDate;
    });

    const integrationStats = new Map<string, {
      total: number;
      successful: number;
      failed: number;
      totalDuration: number;
      lastUsed: string;
    }>();

    filteredEvents.forEach(event => {
      const stats = integrationStats.get(event.id) || {
        total: 0,
        successful: 0,
        failed: 0,
        totalDuration: 0,
        lastUsed: '',
      };
      stats.total++;
      if (event.success) {
        stats.successful++;
      } else {
        stats.failed++;
      }
      if (event.duration) {
        stats.totalDuration += event.duration;
      }
      stats.lastUsed = event.timestamp;
      integrationStats.set(event.id, stats);
    });

    const integrations: IntegrationAnalytics[] = [];
    integrationStats.forEach((stats, id) => {
      integrations.push({
        integrationId: id,
        name: this.getIntegrationName(id),
        totalCalls: stats.total,
        successfulCalls: stats.successful,
        failedCalls: stats.failed,
        averageResponseTime: stats.total > 0 ? stats.totalDuration / stats.total : 0,
        lastUsed: stats.lastUsed,
        successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
      });
    });

    integrations.sort((a, b) => b.totalCalls - a.totalCalls);

    return {
      totalIntegrations: integrationStats.size,
      activeIntegrations: Array.from(integrationStats.values()).filter(s => s.total > 0).length,
      totalCalls: filteredEvents.length,
      successfulCalls: filteredEvents.filter(e => e.success).length,
      failedCalls: filteredEvents.filter(e => !e.success).length,
      integrations,
    };
  }

  getHealth(integrationId: string): {
    status: 'active' | 'inactive' | 'error';
    lastCheck: string;
    responseTime?: number;
    errorCount: number;
    successCount: number;
  } {
    const recentEvents = this.events
      .filter(e => e.id === integrationId)
      .slice(0, 100);

    if (recentEvents.length === 0) {
      return {
        status: 'inactive',
        lastCheck: new Date().toISOString(),
        errorCount: 0,
        successCount: 0,
      };
    }

    const errorCount = recentEvents.filter(e => !e.success).length;
    const successCount = recentEvents.filter(e => e.success).length;
    const errorRate = errorCount / recentEvents.length;

    let status: 'active' | 'inactive' | 'error' = 'active';
    if (errorRate > 0.5) {
      status = 'error';
    } else if (successCount === 0) {
      status = 'inactive';
    }

    const avgResponseTime = recentEvents
      .filter(e => e.duration)
      .reduce((sum, e) => sum + (e.duration || 0), 0) / recentEvents.length;

    return {
      status,
      lastCheck: new Date().toISOString(),
      responseTime: avgResponseTime,
      errorCount,
      successCount,
    };
  }

  getPopularIntegrations(limit: number = 5): IntegrationAnalytics[] {
    const analytics = this.getAnalytics({
      period: 'month',
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString(),
    });
    return analytics.integrations.slice(0, limit);
  }

  cleanup(daysToKeep: number = 90) {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    this.events = this.events.filter(event => 
      new Date(event.timestamp) > cutoffDate
    );
    this.multimodalEvents = this.multimodalEvents.filter(event => 
      new Date(event.timestamp) > cutoffDate
    );
  }

  getMultimodalAnalytics(period: AnalyticsPeriod, modality?: 'vision' | 'speech' | 'generation' | 'document' | 'video'): MultimodalAnalytics[] {
    const filteredEvents = this.multimodalEvents.filter(event => {
      const eventDate = new Date(event.timestamp);
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      return eventDate >= startDate && eventDate <= endDate &&
             (!modality || event.type === modality);
    });

    const modalityStats = new Map<string, {
      total: number;
      successful: number;
      failed: number;
      totalDuration: number;
      totalTokens: number;
      totalCost: number;
      models: Map<string, { calls: number; successful: number; totalCost: number }>;
      tasks: Map<string, { calls: number; successful: number }>;
    }>();

    filteredEvents.forEach(event => {
      const stats = modalityStats.get(event.type) || {
        total: 0,
        successful: 0,
        failed: 0,
        totalDuration: 0,
        totalTokens: 0,
        totalCost: 0,
        models: new Map(),
        tasks: new Map(),
      };
      stats.total++;
      if (event.success) {
        stats.successful++;
      } else {
        stats.failed++;
      }
      if (event.duration) {
        stats.totalDuration += event.duration;
      }
      if (event.metadata.tokens) {
        stats.totalTokens += event.metadata.tokens;
      }
      if (event.metadata.cost) {
        stats.totalCost += event.metadata.cost;
      }
      const modelKey = event.metadata.model;
      const modelStats = stats.models.get(modelKey) || { calls: 0, successful: 0, totalCost: 0 };
      modelStats.calls++;
      if (event.success) modelStats.successful++;
      if (event.metadata.cost) modelStats.totalCost += event.metadata.cost;
      stats.models.set(modelKey, modelStats);
      if (event.metadata.task) {
        const taskStats = stats.tasks.get(event.metadata.task) || { calls: 0, successful: 0 };
        taskStats.calls++;
        if (event.success) taskStats.successful++;
        stats.tasks.set(event.metadata.task, taskStats);
      }
      modalityStats.set(event.type, stats);
    });

    const result: MultimodalAnalytics[] = [];
    modalityStats.forEach((stats, modality) => {
      result.push({
        modality: modality as 'vision' | 'speech' | 'generation' | 'document' | 'video',
        totalCalls: stats.total,
        successfulCalls: stats.successful,
        failedCalls: stats.failed,
        averageResponseTime: stats.total > 0 ? stats.totalDuration / stats.total : 0,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        models: Array.from(stats.models.entries()).map(([model, modelStats]) => ({
          model,
          calls: modelStats.calls,
          successRate: modelStats.calls > 0 ? (modelStats.successful / modelStats.calls) * 100 : 0,
          averageCost: modelStats.calls > 0 ? modelStats.totalCost / modelStats.calls : 0,
        })).sort((a, b) => b.calls - a.calls),
        tasks: Array.from(stats.tasks.entries()).map(([task, taskStats]) => ({
          task,
          calls: taskStats.calls,
          successRate: taskStats.calls > 0 ? (taskStats.successful / taskStats.calls) * 100 : 0,
        })).sort((a, b) => b.calls - a.calls),
      });
    });
    return result.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  getMultimodalHealth(modality: 'vision' | 'speech' | 'generation' | 'document' | 'video'): {
    status: 'available' | 'degraded' | 'unavailable';
    lastCheck: string;
    responseTime?: number;
    errorCount: number;
    successCount: number;
    totalCalls: number;
  } {
    const recentEvents = this.multimodalEvents
      .filter(e => e.type === modality)
      .slice(0, 100);
    if (recentEvents.length === 0) {
      return {
        status: 'unavailable',
        lastCheck: new Date().toISOString(),
        errorCount: 0,
        successCount: 0,
        totalCalls: 0,
      };
    }
    const errorCount = recentEvents.filter(e => !e.success).length;
    const successCount = recentEvents.filter(e => e.success).length;
    const errorRate = errorCount / recentEvents.length;
    let status: 'available' | 'degraded' | 'unavailable' = 'available';
    if (errorRate > 0.5) {
      status = 'degraded';
    }
    if (errorRate > 0.8) {
      status = 'unavailable';
    }
    const avgResponseTime = recentEvents
      .filter(e => e.duration)
      .reduce((sum, e) => sum + (e.duration || 0), 0) / recentEvents.length;
    return {
      status,
      lastCheck: new Date().toISOString(),
      responseTime: avgResponseTime,
      errorCount,
      successCount,
      totalCalls: recentEvents.length,
    };
  }

  private getIntegrationName(id: string): string {
    const names: Record<string, string> = {
      'github': 'GitHub Integration',
      'jira': 'Jira Integration',
      'linear': 'Linear Integration',
      'notion': 'Notion Integration',
      'slack': 'Slack Integration',
      'discord': 'Discord Integration',
      'webhook': 'Custom Webhook',
      'zapier': 'Zapier Integration',
      'make': 'Make.com Integration',
    };
    return names[id] || id;
  }
}

export const integrationAnalytics = new IntegrationAnalyticsService();