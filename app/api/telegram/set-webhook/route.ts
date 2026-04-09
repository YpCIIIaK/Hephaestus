import { NextRequest, NextResponse } from 'next/server'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL

export async function POST(req: NextRequest) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  if (!APP_URL) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })
  }

  const webhookUrl = `${APP_URL}/api/telegram/webhook`

  try {
    // Set webhook with secret token if configured
    let setWebhookUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    if (TELEGRAM_WEBHOOK_SECRET) {
      setWebhookUrl += `&secret_token=${encodeURIComponent(TELEGRAM_WEBHOOK_SECRET)}`
    }
    
    const res = await fetch(setWebhookUrl, { method: 'POST' })
    const data = await res.json()

    // Get webhook info
    const infoRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
      { method: 'GET' }
    )
    const info = await infoRes.json()

    return NextResponse.json({
      success: data.ok,
      webhookUrl,
      telegramResponse: data,
      webhookInfo: info.result,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`,
      { method: 'POST' }
    )
    const data = await res.json()

    return NextResponse.json({
      success: data.ok,
      telegramResponse: data,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}