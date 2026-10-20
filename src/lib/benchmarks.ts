import { Database } from 'better-sqlite3';
import path from 'node:path';

const DB = new Database(path.join(process.cwd(), 'data', 'models.db'), { readonly: true });

export function getBenchmarksForModel(modelId: string) {
  const rows = DB.prepare('SELECT source, metric, value, as_of, source_url, citation FROM benchmarks WHERE model_id = ? ORDER BY source, metric').all(modelId) as Array<{ source: string; metric: string; value: number; as_of: string | null; source_url: string | null; citation: string | null }>;
  const grouped: Record<string, { source: string; metric: string; value: number; as_of?: string; source_url?: string; citation?: string }[]> = {};
  for (const row of rows) {
    if (!grouped[row.source]) grouped[row.source] = [];
    grouped[row.source].push({ source: row.source, metric: row.metric, value: row.value, as_of: row.as_of || undefined, source_url: row.source_url || undefined, citation: row.citation || undefined });
  }
  return grouped;
}

export function enrichModelsWithBenchmarks(models: Array<{ model_id: string; [key: string]: unknown }>) {
  return models.map((model) => ({ ...model, benchmarks: getBenchmarksForModel(String(model.model_id)) }));
}

