import { NextRequest, NextResponse } from 'next/server';
import { listModels } from '@/lib/db';
import { enrichModelsWithBenchmarks } from '@/lib/benchmarks';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const provider = searchParams.get('provider') || undefined;
  const favouritesOnly = searchParams.get('favourites') === '1';
  const sort = searchParams.get('sort') || undefined;
  const dir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const models = listModels({ search, provider, favouritesOnly, sort, dir });
  const enriched = enrichModelsWithBenchmarks(models);
  return NextResponse.json(enriched);
}
