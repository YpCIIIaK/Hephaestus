/**
 * Типы для системы интеграций
 */

export type IntegrationType = 
  | 'github'
  | 'jira'
  | 'linear'
  | 'notion'
  | 'slack'
  | 'discord'
  | 'webhook'
  | 'zapier'
  | 'make';

export type IntegrationStatus = 'active' | 'inactive' | 'error';

export interface IntegrationSettings {
  // Общие настройки
  apiKey?: string;
  apiUrl?: string;
  webhookUrl?: string;
  
  // GitHub
  repository?: string;
  owner?: string;
  
  // Jira/Linear
  projectKey?: string;
  baseUrl?: string;
  email?: string;
  
  // Notion
  workspaceId?: string;
  databaseId?: string;
  
  // Slack/Discord
  channelId?: string;
  channelName?: string;
  
  // Webhook
  headers?: Record<string, string>;
  payloadTemplate?: string;
  
  // Zapier/Make
  webhookTriggerUrl?: string;
  scenarioId?: string;
  
  // Дополнительные настройки
  [key: string]: any;
}

export interface Integration {
  id: string;
  name: string;
  type: IntegrationType;
  status: IntegrationStatus;
  settings: IntegrationSettings;
  isEnabled: boolean;
  lastSync?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAction {
  type: 
    | 'create_pr'
    | 'comment_pr'
    | 'analyze_code'
    | 'create_issue'
    | 'update_issue'
    | 'create_task'
    | 'update_task'
    | 'save_page'
    | 'send_message'
    | 'trigger_webhook'
    | 'trigger_zapier'
    | 'trigger_make';
  payload: Record<string, any>;
  integrationId: string;
}

export interface IntegrationTestResult {
  success: boolean;
  message: string;
  details?: any;
}

export interface IntegrationHealth {
  integrationId: string;
  status: IntegrationStatus;
  lastCheck: string;
  responseTime?: number;
  errorCount: number;
  successCount: number;
}

// События для триггеров
export interface IntegrationEvent {
  type: 
    | 'pipeline_start'
    | 'pipeline_complete'
    | 'pipeline_error'
    | 'agent_action'
    | 'skill_used'
    | 'file_analyzed'
    | 'chat_message'
    | 'pr_created'
    | 'issue_created'
    | 'task_completed';
  data: Record<string, any>;
  timestamp: string;
}

// Конфигурация интеграции в UI
export interface IntegrationConfig {
  id: string;
  name: string;
  type: IntegrationType;
  description: string;
  icon: string;
  color: string;
  enabled: boolean;
  requiresAuth: boolean;
  settingsSchema: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'textarea' | 'select' | 'boolean';
    placeholder?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    helpText?: string;
  }>;
}

// Интеграция в маркетплейсе
export interface MarketplaceIntegration {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  rating: number;
  downloads: number;
  verified: boolean;
  installed: boolean;
}
