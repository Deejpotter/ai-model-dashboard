import Dashboard from '@/components/Dashboard';
import { listModels } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Dashboard initialModels={listModels({ sort: 'name' })} initialState={await searchParams} />;
}
