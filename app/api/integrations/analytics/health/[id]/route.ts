import { NextResponse } from 'next/server';
import { integrationAnalytics } from '@/lib/integrations/analytics';

// GET /api/integrations/analytics/health/:id - Получить статус здоровья конкретной интеграции
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const health = integrationAnalytics.getHealth(id);

    return NextResponse.json(health);
  } catch (error) {
    console.error('Error fetching health status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch health status' },
      { status: 500 }
    );
  }
}