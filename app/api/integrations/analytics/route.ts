import { NextResponse } from 'next/server';
import { integrationAnalytics } from '@/lib/integrations/analytics';

// GET /api/integrations/analytics - Получить аналитику использования
// POST /api/integrations/analytics/events - Добавить событие
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = (searchParams.get('period') || 'week') as 'day' | 'week' | 'month' | 'year';

    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const analytics = integrationAnalytics.getAnalytics({
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
    });

    return NextResponse.json({
      ...analytics,
      period,
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, type, success, duration, error } = body;

    if (!id || !type) {
      return NextResponse.json(
        { error: 'ID and type are required' },
        { status: 400 }
      );
    }

    const event = {
      id,
      type,
      success,
      timestamp: new Date().toISOString(),
      duration,
      error,
    };

    integrationAnalytics.addEvent(event);

    return NextResponse.json({
      success: true,
      message: 'Event recorded successfully',
    });
  } catch (error) {
    console.error('Error recording event:', error);
    return NextResponse.json(
      { error: 'Failed to record event' },
      { status: 500 }
    );
  }
}
