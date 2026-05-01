import { NextResponse } from 'next/server';
import { useIntegrationStore } from '@/lib/integrations/store';
import { Integration, IntegrationSettings } from '@/lib/integrations/types';

// GET /api/integrations - Получить все интеграции
export async function GET(req: Request) {
  try {
    // Так как Zustand store работает только на клиенте,
    // для SSR используем дефолтные значения
    const { DEFAULT_INTEGRATIONS } = await import('@/lib/integrations/config');
    
    return NextResponse.json({ 
      integrations: DEFAULT_INTEGRATIONS,
      message: 'Integrations retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching integrations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch integrations' },
      { status: 500 }
    );
  }
}

// POST /api/integrations - Создать новую интеграцию
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, type, settings } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }

    const newIntegration: Integration = {
      id: `${type}-${Date.now()}`,
      name,
      type,
      status: 'inactive',
      settings: settings || {},
      isEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ 
      integration: newIntegration,
      message: 'Integration created successfully'
    });
  } catch (error) {
    console.error('Error creating integration:', error);
    return NextResponse.json(
      { error: 'Failed to create integration' },
      { status: 500 }
    );
  }
}

// PUT /api/integrations - Обновить интеграцию
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, updates } = body;

    if (!id || !updates) {
      return NextResponse.json(
        { error: 'ID and updates are required' },
        { status: 400 }
      );
    }

    return NextResponse.json({ 
      message: 'Integration updated successfully',
      id,
      updates
    });
  } catch (error) {
    console.error('Error updating integration:', error);
    return NextResponse.json(
      { error: 'Failed to update integration' },
      { status: 500 }
    );
  }
}

// DELETE /api/integrations - Удалить интеграцию
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    return NextResponse.json({ 
      message: 'Integration deleted successfully',
      id
    });
  } catch (error) {
    console.error('Error deleting integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}