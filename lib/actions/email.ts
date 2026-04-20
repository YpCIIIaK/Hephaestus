// Email action implementation using Nodemailer or Gmail API

import { Action, ActionResult, ActionContext, actionRegistry } from './types'

interface EmailInputs {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  attachments?: Array<{
    filename: string
    content: string | Buffer
    contentType?: string
  }>
  provider?: 'smtp' | 'gmail' | 'sendgrid'
}

export const sendEmailAction: Action = {
  id: 'send-email',
  name: 'Send Email',
  description: 'Отправить email через SMTP, Gmail или другие провайдеры',
  category: 'communication',
  icon: 'mail',
  inputs: [
    { name: 'to', type: 'string', required: true, description: 'Получатель (email или несколько через запятую)' },
    { name: 'subject', type: 'string', required: true, description: 'Тема письма' },
    { name: 'body', type: 'textarea', required: true, description: 'Тело письма (HTML поддерживается)' },
    { name: 'cc', type: 'string', required: false, description: 'Копия' },
    { name: 'bcc', type: 'string', required: false, description: 'Скрытая копия' },
    { name: 'provider', type: 'select', required: false, description: 'Провайдер отправки', default: 'smtp', options: ['smtp', 'gmail', 'sendgrid'] },
  ],
  outputs: [
    { name: 'messageId', type: 'string', description: 'ID отправленного сообщения' },
    { name: 'previewUrl', type: 'string', description: 'URL для предпросмотра (Ethereal)' },
  ],
  config: { 
    requiresAuth: true, 
    authType: 'api_key',
    retryCount: 3,
    timeoutMs: 30000 
  },
  execute: async (inputs: Record<string, any>, context: ActionContext): Promise<ActionResult> => {
    const startTime = Date.now()
    
    try {
      const { to, subject, body, cc, bcc, provider = 'smtp' } = inputs as EmailInputs
      
      // Validate required fields
      if (!to || !subject || !body) {
        return {
          success: false,
          error: 'Missing required fields: to, subject, body',
          metadata: { duration: Date.now() - startTime }
        }
      }

      // Get credentials from context or environment
      const credentials = context.credentials || {}
      
      // Server-side execution
      if (typeof window === 'undefined') {
        const nodemailer = await import('nodemailer')
        
        let transporter
        
        if (provider === 'gmail') {
          // Gmail OAuth2 or App Password
          transporter = nodemailer.createTransporter({
            service: 'gmail',
            auth: {
              user: credentials.gmailUser || process.env.GMAIL_USER,
              pass: credentials.gmailAppPassword || process.env.GMAIL_APP_PASSWORD,
            },
          })
        } else if (provider === 'sendgrid') {
          // SendGrid SMTP
          transporter = nodemailer.createTransporter({
            host: 'smtp.sendgrid.net',
            port: 587,
            auth: {
              user: 'apikey',
              pass: credentials.sendgridApiKey || process.env.SENDGRID_API_KEY,
            },
          })
        } else {
          // Default SMTP
          transporter = nodemailer.createTransporter({
            host: credentials.smtpHost || process.env.SMTP_HOST || 'smtp.ethereal.email',
            port: parseInt(credentials.smtpPort || process.env.SMTP_PORT || '587'),
            secure: false,
            auth: {
              user: credentials.smtpUser || process.env.SMTP_USER,
              pass: credentials.smtpPass || process.env.SMTP_PASS,
            },
          })
        }

        const mailOptions = {
          from: credentials.fromEmail || process.env.FROM_EMAIL || 'hephaestus@example.com',
          to: to.split(',').map(e => e.trim()),
          subject,
          html: body,
          cc: cc ? cc.split(',').map(e => e.trim()) : undefined,
          bcc: bcc ? bcc.split(',').map(e => e.trim()) : undefined,
          attachments: inputs.attachments,
        }

        const info = await transporter.sendMail(mailOptions)
        
        return {
          success: true,
          data: {
            messageId: info.messageId,
            previewUrl: nodemailer.getTestMessageUrl?.(info),
            accepted: info.accepted,
            rejected: info.rejected,
          },
          metadata: {
            duration: Date.now() - startTime,
          }
        }
      } else {
        // Client-side: call API
        const res = await fetch('/api/actions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: 'send-email',
            inputs,
            context
          })
        })
        
        if (!res.ok) {
          const error = await res.text()
          return {
            success: false,
            error: `API error: ${error}`,
            metadata: { duration: Date.now() - startTime }
          }
        }
        
        return await res.json()
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to send email',
        metadata: { duration: Date.now() - startTime }
      }
    }
  }
}

// Register the action
actionRegistry.register(sendEmailAction)
