import { NextRequest, NextResponse } from 'next/server';
import { listModels } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const provider = searchParams.get('provider') || undefined;
  const favouritesOnly = searchParams.get('favourites') === '1';
  const sort = searchParams.get('sort') || undefined;
  const dir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const models = listModels({ search, provider, favouritesOnly, sort, dir });
  return NextResponse.json(models);
}
