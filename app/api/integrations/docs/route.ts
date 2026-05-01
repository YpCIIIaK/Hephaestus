import { NextResponse } from 'next/server';

// OpenAPI/Swagger документация для API интеграций
const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Hephaestus Integrations API',
    description: 'API для управления интеграциями в платформе Hephaestus',
    version: '1.0.0',
    contact: {
      name: 'Support',
      email: 'support@hephaestus.ai',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000/api',
      description: 'Local development server',
    },
    {
      url: 'https://your-domain.com/api',
      description: 'Production server',
    },
  ],
  tags: [
    {
      name: 'Integrations',
      description: 'Управление интеграциями',
    },
    {
      name: 'GitHub',
      description: 'Интеграция с GitHub',
    },
    {
      name: 'Analytics',
      description: 'Аналитика использования',
    },
  ],
  paths: {
    '/integrations': {
      get: {
        tags: ['Integrations'],
        summary: 'Получить список всех интеграций',
        description: 'Возвращает список всех доступных интеграций с их текущим статусом',
        operationId: 'getIntegrations',
        responses: {
          '200': {
            description: 'Успешный ответ',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    integrations: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/Integration',
                      },
                    },
                    message: {
                      type: 'string',
                      example: 'Integrations retrieved successfully',
                    },
                  },
                },
              },
            },
          },
          '500': {
            description: 'Ошибка сервера',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Integrations'],
        summary: 'Создать новую интеграцию',
        description: 'Создает новую интеграцию с указанными настройками',
        operationId: 'createIntegration',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateIntegrationRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Интеграция успешно создана',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    integration: {
                      $ref: '#/components/schemas/Integration',
                    },
                    message: {
                      type: 'string',
                      example: 'Integration created successfully',
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Ошибка валидации',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Integrations'],
        summary: 'Обновить интеграцию',
        description: 'Обновляет настройки существующей интеграции',
        operationId: 'updateIntegration',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdateIntegrationRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Интеграция успешно обновлена',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'Integration updated successfully',
                    },
                    id: {
                      type: 'string',
                      example: 'github-1234567890',
                    },
                    updates: {
                      type: 'object',
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Ошибка валидации',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Integrations'],
        summary: 'Удалить интеграцию',
        description: 'Удаляет интеграцию по её ID',
        operationId: 'deleteIntegration',
        parameters: [
          {
            name: 'id',
            in: 'query',
            description: 'ID интеграции для удаления',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Интеграция успешно удалена',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'Integration deleted successfully',
                    },
                    id: {
                      type: 'string',
                      example: 'github-1234567890',
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Ошибка валидации',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/integrations/{id}/test': {
      post: {
        tags: ['Integrations'],
        summary: 'Тест подключения',
        description: 'Проверяет подключение к внешнему сервису',
        operationId: 'testIntegration',
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'ID интеграции для тестирования',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Тест подключения успешен',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/IntegrationTestResult',
                },
              },
            },
          },
          '400': {
            description: 'Ошибка валидации',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/integrations/{id}/health': {
      get: {
        tags: ['Integrations'],
        summary: 'Статус здоровья интеграции',
        description: 'Возвращает статус и метрики здоровья интеграции',
        operationId: 'getIntegrationHealth',
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'ID интеграции',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Статус здоровья',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/IntegrationHealth',
                },
              },
            },
          },
          '404': {
            description: 'Интеграция не найдена',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/integrations/analytics': {
      get: {
        tags: ['Analytics'],
        summary: 'Аналитика использования интеграций',
        description: 'Возвращает статистику использования всех интеграций',
        operationId: 'getIntegrationsAnalytics',
        parameters: [
          {
            name: 'period',
            in: 'query',
            description: 'Период для аналитики',
            required: false,
            schema: {
              type: 'string',
              enum: ['day', 'week', 'month', 'year'],
              default: 'week',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Данные аналитики',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/IntegrationsAnalytics',
                },
              },
            },
          },
        },
      },
    },
    '/integrations/github/oauth': {
      get: {
        tags: ['GitHub'],
        summary: 'Начать OAuth авторизацию GitHub',
        description: 'Перенаправляет на страницу авторизации GitHub',
        operationId: 'startGitHubOAuth',
        parameters: [
          {
            name: 'redirect_uri',
            in: 'query',
            description: 'URL для возврата после авторизации',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '302': {
            description: 'Перенаправление на GitHub',
          },
        },
      },
    },
    '/integrations/github/oauth/callback': {
      get: {
        tags: ['GitHub'],
        summary: 'Callback для GitHub OAuth',
        description: 'Обрабатывает ответ от GitHub после авторизации',
        operationId: 'handleGitHubOAuthCallback',
        parameters: [
          {
            name: 'code',
            in: 'query',
            description: 'Код авторизации от GitHub',
            required: true,
            schema: {
              type: 'string',
            },
          },
          {
            name: 'state',
            in: 'query',
            description: 'Стейт для защиты от CSRF',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Успешная авторизация',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: {
                      type: 'string',
                      description: 'GitHub access token',
                    },
                    user: {
                      type: 'object',
                      properties: {
                        login: {
                          type: 'string',
                          description: 'GitHub username',
                        },
                        avatar_url: {
                          type: 'string',
                          description: 'User avatar URL',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Ошибка авторизации',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/marketplace/integrations': {
      get: {
        tags: ['Marketplace'],
        summary: 'Каталог интеграций',
        description: 'Возвращает список доступных интеграций в маркетплейсе',
        operationId: 'getMarketplaceIntegrations',
        parameters: [
          {
            name: 'category',
            in: 'query',
            description: 'Фильтр по категории',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            name: 'search',
            in: 'query',
            description: 'Поиск по названию',
            required: false,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Список интеграций',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    integrations: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/MarketplaceIntegration',
                      },
                    },
                    total: {
                      type: 'integer',
                      description: 'Общее количество',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Integration: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'github-1234567890',
          },
          name: {
            type: 'string',
            example: 'GitHub Integration',
          },
          type: {
            type: 'string',
            enum: ['github', 'jira', 'linear', 'notion', 'slack', 'discord', 'webhook', 'zapier', 'make'],
            example: 'github',
          },
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'error'],
            example: 'active',
          },
          settings: {
            type: 'object',
            additionalProperties: true,
          },
          isEnabled: {
            type: 'boolean',
            example: true,
          },
          lastSync: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z',
          },
          lastError: {
            type: 'string',
            example: 'Connection timeout',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:00:00Z',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z',
          },
        },
      },
      CreateIntegrationRequest: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: {
            type: 'string',
            example: 'My GitHub Integration',
          },
          type: {
            type: 'string',
            enum: ['github', 'jira', 'linear', 'notion', 'slack', 'discord', 'webhook', 'zapier', 'make'],
            example: 'github',
          },
          settings: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      UpdateIntegrationRequest: {
        type: 'object',
        required: ['id', 'updates'],
        properties: {
          id: {
            type: 'string',
            example: 'github-1234567890',
          },
          updates: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      IntegrationTestResult: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: 'Connection successful',
          },
          details: {
            type: 'object',
          },
        },
      },
      IntegrationHealth: {
        type: 'object',
        properties: {
          integrationId: {
            type: 'string',
            example: 'github-1234567890',
          },
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'error'],
            example: 'active',
          },
          lastCheck: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z',
          },
          responseTime: {
            type: 'number',
            example: 150.5,
          },
          errorCount: {
            type: 'integer',
            example: 0,
          },
          successCount: {
            type: 'integer',
            example: 150,
          },
        },
      },
      IntegrationsAnalytics: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            example: 'week',
          },
          totalIntegrations: {
            type: 'integer',
            example: 5,
          },
          activeIntegrations: {
            type: 'integer',
            example: 3,
          },
          totalCalls: {
            type: 'integer',
            example: 1250,
          },
          successfulCalls: {
            type: 'integer',
            example: 1200,
          },
          failedCalls: {
            type: 'integer',
            example: 50,
          },
          integrations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  example: 'github-1234567890',
                },
                name: {
                  type: 'string',
                  example: 'GitHub Integration',
                },
                calls: {
                  type: 'integer',
                  example: 500,
                },
                successRate: {
                  type: 'number',
                  example: 98.5,
                },
              },
            },
          },
        },
      },
      MarketplaceIntegration: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'github-official',
          },
          name: {
            type: 'string',
            example: 'GitHub Official',
          },
          description: {
            type: 'string',
            example: 'Official GitHub integration with full API access',
          },
          category: {
            type: 'string',
            example: 'development',
          },
          author: {
            type: 'string',
            example: 'Hephaestus Team',
          },
          rating: {
            type: 'number',
            example: 4.8,
          },
          downloads: {
            type: 'integer',
            example: 15000,
          },
          verified: {
            type: 'boolean',
            example: true,
          },
          installed: {
            type: 'boolean',
            example: false,
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            example: 'Failed to fetch integrations',
          },
        },
      },
    },
  },
};

export default async function handler(req: Request) {
  if (req.method === 'GET') {
    return NextResponse.json(openApiSpec, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}