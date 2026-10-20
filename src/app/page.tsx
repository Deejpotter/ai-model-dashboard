import Dashboard from '@/components/Dashboard';
import { listModels } from '@/lib/db';
import { enrichModelsWithBenchmarks } from '@/lib/benchmarks';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const models = enrichModelsWithBenchmarks(listModels({ sort: 'name' }));
  return <Dashboard initialModels={models} initialState={await searchParams} />;
}
