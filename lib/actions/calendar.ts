// Google Calendar action implementation

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface CalendarEventInputs {
  calendarId?: string
  title: string
  startTime: string // ISO 8601
  endTime: string // ISO 8601
  description?: string
  location?: string
  attendees?: string[] // Email addresses
  reminderMinutes?: number
  colorId?: string // 1-11
  recurrence?: string[] // RRULE strings
}

export const createCalendarEventAction: Action = {
  id: 'create-calendar-event',
  name: 'Create Calendar Event',
  description: 'Создать событие в Google Calendar',
  category: 'productivity',
  icon: 'calendar',
  inputs: [
    { name: 'calendarId', type: 'string', required: false, description: 'ID календаря (default: primary)', default: 'primary' },
    { name: 'title', type: 'string', required: true, description: 'Название события' },
    { name: 'startTime', type: 'string', required: true, description: 'Начало (ISO 8601, например 2024-01-15T10:00:00)' },
    { name: 'endTime', type: 'string', required: true, description: 'Конец (ISO 8601)' },
    { name: 'description', type: 'textarea', required: false, description: 'Описание события' },
    { name: 'location', type: 'string', required: false, description: 'Местоположение' },
    { name: 'attendees', type: 'json', required: false, description: 'JSON массив email участников' },
    { name: 'reminderMinutes', type: 'number', required: false, description: 'Напоминание за N минут', default: 15 },
    { name: 'colorId', type: 'string', required: false, description: 'Цвет (1-11)', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] },
  ],
  outputs: [
    { name: 'eventId', type: 'string', description: 'ID события' },
    { name: 'htmlLink', type: 'string', description: 'Ссылка на событие' },
    { name: 'meetLink', type: 'string', description: 'Google Meet ссылка' },
  ],
  config: { 
    requiresAuth: true, 
    authType: 'oauth',
    retryCount: 3,
    timeoutMs: 30000 
  },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const {
        calendarId = 'primary',
        title,
        startTime: start,
        endTime: end,
        description,
        location,
        attendees,
        reminderMinutes = 15,
        colorId,
      } = inputs as CalendarEventInputs

      if (!title || !start || !end) {
        return {
          success: false,
          error: 'Missing required fields: title, startTime, endTime',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Validate dates
      const startDate = new Date(start)
      const endDate = new Date(end)
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return {
          success: false,
          error: 'Invalid date format. Use ISO 8601 format (e.g., 2024-01-15T10:00:00)',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const accessToken = context.credentials?.googleAccessToken || process.env.GOOGLE_ACCESS_TOKEN
      const refreshToken = context.credentials?.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN
      
      if (!accessToken && !refreshToken) {
        return {
          success: false,
          error: 'Google OAuth not configured. Please authenticate with Google.',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const event: any = {
        summary: title,
        description,
        location,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: reminderMinutes },
            { method: 'popup', minutes: reminderMinutes },
          ],
        },
      }

      if (attendees && attendees.length > 0) {
        event.attendees = attendees.map(email => ({ email }))
      }

      if (colorId) {
        event.colorId = colorId
      }

      // Conference data for Google Meet
      event.conferenceData = {
        createRequest: {
          requestId: `hephaestus-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      }

      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event)
      })

      const data = await res.json()
      
      if (!res.ok) {
        // Token might be expired, try to refresh
        if (res.status === 401 && refreshToken) {
          return {
            success: false,
            error: 'Google token expired. Please re-authenticate.',
            metadata: { duration: Date.now() - startTime }
          }
        }
        
        return {
          success: false,
          error: `Google Calendar API error: ${data.error?.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          eventId: data.id,
          htmlLink: data.htmlLink,
          meetLink: data.conferenceData?.entryPoints?.[0]?.uri,
          created: data.created,
          updated: data.updated,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create calendar event',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// List upcoming events
export const listCalendarEventsAction: Action = {
  id: 'list-calendar-events',
  name: 'List Calendar Events',
  description: 'Получить предстоящие события из Google Calendar',
  category: 'productivity',
  icon: 'calendar-days',
  inputs: [
    { name: 'calendarId', type: 'string', required: false, description: 'ID календаря', default: 'primary' },
    { name: 'maxResults', type: 'number', required: false, description: 'Максимум результатов', default: 10 },
    { name: 'timeMin', type: 'string', required: false, description: 'Минимальное время (ISO 8601)' },
    { name: 'timeMax', type: 'string', required: false, description: 'Максимальное время (ISO 8601)' },
    { name: 'query', type: 'string', required: false, description: 'Поисковый запрос' },
  ],
  outputs: [
    { name: 'events', type: 'array', description: 'Список событий' },
    { name: 'total', type: 'number', description: 'Общее количество' },
  ],
  config: { requiresAuth: true, authType: 'oauth', timeoutMs: 15000 },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { calendarId = 'primary', maxResults = 10, timeMin, timeMax, query } = inputs
      
      const accessToken = context.credentials?.googleAccessToken || process.env.GOOGLE_ACCESS_TOKEN
      
      if (!accessToken) {
        return {
          success: false,
          error: 'Google OAuth not configured',
          metadata: { duration: Date.now() - startTime }
        }
      }

      const params = new URLSearchParams({
        maxResults: maxResults.toString(),
        singleEvents: 'true',
        orderBy: 'startTime',
      })

      if (timeMin) params.append('timeMin', new Date(timeMin).toISOString())
      if (timeMax) params.append('timeMax', new Date(timeMax).toISOString())
      if (query) params.append('q', query)

      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      })

      const data = await res.json()
      
      if (!res.ok) {
        return {
          success: false,
          error: `Google Calendar API error: ${data.error?.message || res.statusText}`,
          metadata: { duration: Date.now() - startTime }
        }
      }

      return {
        success: true,
        data: {
          events: data.items || [],
          total: data.items?.length || 0,
          nextSyncToken: data.nextSyncToken,
        },
        metadata: { duration: Date.now() - startTime }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to list events',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Register actions
actionRegistry.register(createCalendarEventAction)
actionRegistry.register(listCalendarEventsAction)
