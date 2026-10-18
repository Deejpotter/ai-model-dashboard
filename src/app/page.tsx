import Dashboard from '@/components/Dashboard';
import { listModels } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function Home() {
  return <Dashboard initialModels={listModels({ sort: 'name' })} />;
}
