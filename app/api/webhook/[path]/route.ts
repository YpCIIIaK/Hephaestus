import { NextRequest, NextResponse } from 'next/server'
import { getWebhookHandler } from '@/lib/triggers'

// Dynamic webhook handler for all webhook triggers
export async function POST(
  req: NextRequest,
  { params }: { params: { path: string } }
) {
  const path = `/${params.path}`
  const handler = getWebhookHandler(path)
  
  if (!handler) {
    return NextResponse.json(
      { error: 'Webhook not found' },
      { status: 404 }
    )
  }
  
  return handler(req, NextResponse)
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string } }
) {
  const path = `/${params.path}`
  const handler = getWebhookHandler(path)
  
  if (!handler) {
    return NextResponse.json(
      { error: 'Webhook not found' },
      { status: 404 }
    )
  }
  
  return handler(req, NextResponse)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { path: string } }
) {
  const path = `/${params.path}`
  const handler = getWebhookHandler(path)
  
  if (!handler) {
    return NextResponse.json(
      { error: 'Webhook not found' },
      { status: 404 }
    )
  }
  
  return handler(req, NextResponse)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { path: string } }
) {
  const path = `/${params.path}`
  const handler = getWebhookHandler(path)
  
  if (!handler) {
    return NextResponse.json(
      { error: 'Webhook not found' },
      { status: 404 }
    )
  }
  
  return handler(req, NextResponse)
}
