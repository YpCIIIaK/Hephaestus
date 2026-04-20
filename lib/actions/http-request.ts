// HTTP Request Action - Universal API caller for RapidAPI, webhooks, and custom APIs
import type { Action, ActionResult, ActionContext } from './types'

export interface HttpRequestInputs {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: any
  queryParams?: Record<string, string>
  timeoutMs?: number
  retryCount?: number
}

export const httpRequestAction: Action = {
  id: 'http_request',
  name: 'HTTP Request',
  description: 'Make HTTP requests to any API (RapidAPI, webhooks, REST APIs)',
  category: 'data',
  icon: 'globe',
  inputs: [
    {
      name: 'url',
      type: 'string',
      required: true,
      description: 'Full URL including protocol (e.g., https://api.example.com/v1/data)',
    },
    {
      name: 'method',
      type: 'select',
      required: false,
      description: 'HTTP method',
      default: 'GET',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    {
      name: 'headers',
      type: 'json',
      required: false,
      description: 'JSON object with headers (e.g., {"Authorization": "Bearer token", "X-Api-Key": "key"})',
    },
    {
      name: 'body',
      type: 'json',
      required: false,
      description: 'JSON body for POST/PUT/PATCH requests',
    },
    {
      name: 'queryParams',
      type: 'json',
      required: false,
      description: 'Query parameters as JSON object',
    },
    {
      name: 'timeoutMs',
      type: 'number',
      required: false,
      description: 'Request timeout in milliseconds (default: 30000)',
      default: 30000,
    },
    {
      name: 'retryCount',
      type: 'number',
      required: false,
      description: 'Number of retries on failure (default: 1)',
      default: 1,
    },
  ],
  outputs: [
    {
      name: 'statusCode',
      type: 'number',
      description: 'HTTP response status code',
    },
    {
      name: 'data',
      type: 'any',
      description: 'Parsed JSON response body',
    },
    {
      name: 'headers',
      type: 'object',
      description: 'Response headers',
    },
    {
      name: 'text',
      type: 'string',
      description: 'Raw response text',
    },
  ],
  config: {
    requiresAuth: false,
    timeoutMs: 30000,
    retryCount: 1,
  },
  execute: async (inputs: HttpRequestInputs, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const {
        url,
        method = 'GET',
        headers = {},
        body,
        queryParams,
        timeoutMs = 30000,
        retryCount = 1,
      } = inputs

      // Build URL with query params
      let finalUrl = url
      if (queryParams && Object.keys(queryParams).length > 0) {
        const urlObj = new URL(url)
        Object.entries(queryParams).forEach(([key, value]) => {
          urlObj.searchParams.append(key, value)
        })
        finalUrl = urlObj.toString()
      }

      // Merge with credentials from context if available
      const finalHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      }

      // Add API keys from context credentials if configured
      if (context.credentials?.apiKey) {
        // Support different header formats for different services
        if (!finalHeaders['X-RapidAPI-Key'] && url.includes('rapidapi.com')) {
          finalHeaders['X-RapidAPI-Key'] = context.credentials.apiKey
          finalHeaders['X-RapidAPI-Host'] = new URL(url).hostname
        } else if (!finalHeaders['X-Api-Key']) {
          finalHeaders['X-Api-Key'] = context.credentials.apiKey
        }
      }

      if (context.credentials?.bearerToken) {
        finalHeaders['Authorization'] = `Bearer ${context.credentials.bearerToken}`
      }

      const fetchOptions: RequestInit = {
        method,
        headers: finalHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      }

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body)
      }

      // Execute with retries
      let lastError: Error | null = null
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
          const response = await fetch(finalUrl, fetchOptions)
          
          const responseText = await response.text()
          let responseData: any = responseText
          
          // Try to parse as JSON
          try {
            responseData = JSON.parse(responseText)
          } catch {
            // Keep as text if not valid JSON
          }

          const duration = Date.now() - startTime

          if (!response.ok) {
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}. Body: ${responseText.slice(0, 500)}`,
              data: {
                statusCode: response.status,
                text: responseText,
                headers: Object.fromEntries(response.headers.entries()),
              },
              metadata: {
                duration,
                retryCount: attempt,
              },
            }
          }

          return {
            success: true,
            data: {
              statusCode: response.status,
              data: responseData,
              headers: Object.fromEntries(response.headers.entries()),
              text: responseText,
            },
            metadata: {
              duration,
              retryCount: attempt,
            },
          }
        } catch (error) {
          lastError = error as Error
          if (attempt < retryCount) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }

      throw lastError || new Error('Request failed after retries')

    } catch (error) {
      const duration = Date.now() - startTime
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          duration,
        },
      }
    }
  },
}
