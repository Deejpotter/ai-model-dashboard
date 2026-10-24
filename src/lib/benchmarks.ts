import Database from 'better-sqlite3';
import path from 'node:path';

let dbInstance: InstanceType<typeof Database> | null = null;
function getDb() {
  if (dbInstance) return dbInstance;
  dbInstance = new Database(path.join(process.cwd(), 'data', 'models.db'), { readonly: true });
  return dbInstance;
}

function groupBenchmarks(rows: Array<{ source: string; metric: string; value: number; as_of: string | null; source_url: string | null; citation: string | null }>) {
  const grouped: Record<string, { source: string; metric: string; value: number; as_of?: string; source_url?: string; citation?: string }[]> = {};
  for (const row of rows) {
    if (!grouped[row.source]) grouped[row.source] = [];
    grouped[row.source].push({ source: row.source, metric: row.metric, value: row.value, as_of: row.as_of || undefined, source_url: row.source_url || undefined, citation: row.citation || undefined });
  }
  return grouped;
}

export function getBenchmarksForModel(modelId: string) {
  const rows = getDb().prepare('SELECT source, metric, value, as_of, source_url, citation FROM benchmarks WHERE model_id = ? ORDER BY source, metric').all(modelId) as Array<{ source: string; metric: string; value: number; as_of: string | null; source_url: string | null; citation: string | null }>;
  return groupBenchmarks(rows);
}

export function getBenchmarksForModels(modelIds: string[]) {
  if (!modelIds.length) return {};
  const placeholders = modelIds.map(() => '?').join(',');
  const rows = getDb().prepare(`SELECT model_id, source, metric, value, as_of, source_url, citation FROM benchmarks WHERE model_id IN (${placeholders}) ORDER BY model_id, source, metric`).all(...modelIds) as Array<{ model_id: string; source: string; metric: string; value: number; as_of: string | null; source_url: string | null; citation: string | null }>;
  const byModel: Record<string, Array<{ source: string; metric: string; value: number; as_of: string | null; source_url: string | null; citation: string | null }>> = {};
  for (const row of rows) {
    if (!byModel[row.model_id]) byModel[row.model_id] = [];
    byModel[row.model_id].push({ source: row.source, metric: row.metric, value: row.value, as_of: row.as_of, source_url: row.source_url, citation: row.citation });
  }
  const result: Record<string, Record<string, { source: string; metric: string; value: number; as_of?: string; source_url?: string; citation?: string }[]>> = {};
  for (const [mid, rows] of Object.entries(byModel)) {
    result[mid] = groupBenchmarks(rows);
  }
  return result;
}

export function enrichModelsWithBenchmarks<T extends { model_id: string }>(models: T[]) {
  const modelIds = models.map((m) => String(m.model_id));
  const benchmarksByModel = getBenchmarksForModels(modelIds);
  return models.map((model) => ({ ...model, benchmarks: benchmarksByModel[String(model.model_id)] || {} }));
}