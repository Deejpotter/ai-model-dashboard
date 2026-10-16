import { NextRequest, NextResponse } from 'next/server';
import { toggleFavourite } from '@/lib/db';

export async function PATCH(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const model = toggleFavourite(Number(id));
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(model);
}
