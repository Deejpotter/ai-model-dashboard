#!/usr/bin/env node
// sync-benchmarks.mjs — pull OpenRouter Data API benchmarks into the DB.
//
// Source: https://openrouter.ai/api/v1/benchmarks  (the same datasets that
// power openrouter.ai/rankings and openrouter.ai/benchmarks)
//   - artificial-analysis : intelligence_index, coding_index, agentic_index
//   - design-arena        : elo, win_rate
//   - openrouter          : per-benchmark accuracy, cost and latency
//
// Auth: OPENROUTER_API_KEY (Coolify env var / local krasus .env). The key is
// never written to the database, the repository, or the browser.
//
// Matching: OpenRouter permaslugs (vendor/model[-date]) are matched to
// dashboard model_ids by canonicalizing the model segment only, so
// `deepseek/deepseek-v4-pro-0813` matches `deepinfra/deepseek-ai/deepseek-v4-pro-0813`
// and `openai/gpt-5.5` matches `opencode/gpt-5.5`. Every route serving the same
// underlying model receives the same benchmark, because the benchmark measures
// the model, not the hosting provider.
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(__filename), '..');
const DB = new Database(path.join(ROOT, 'data', 'models.db'));

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY is required.'); process.exit(1); }

const SOURCES = ['artificial-analysis', 'design-arena', 'openrouter'];

// Canonical form of a model identifier: model segment only, lowercase,
// separators collapsed, trailing release stamps removed.
function canonical(id) {
  if (!id) return '';
  const segment = id.split('/').pop() || '';
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-free$/, '')
    .replace(/-(?:20[0-9]{6})$/, '')   // -20260921
    .replace(/-(?:[0-9]{4})$/, '')     // -0813, -0731, -1017
    .replace(/-$/, '');
}

// Exact canonical form, release stamps retained. Used as the preferred match
// tier so that e.g. `deepseek-v4-flash-0731` does not overwrite the score
// already written for `deepseek-v4-flash`.
function canonicalExact(id) {
  if (!id) return '';
  const segment = id.split('/').pop() || '';
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-free$/, '')
    .replace(/-(?:20[0-9]{6})$/, '')
    .replace(/-(?:[0-9]{4})$/, '')
    .replace(/-$/, '');
}

// Dashboard model_id -> the two matching tiers.
function buildIndex() {
  const exact = new Map();
  const loose = new Map();
  for (const row of DB.prepare('SELECT model_id FROM models').all()) {
    const modelId = row.model_id;
    const looseKey = canonical(modelId);
    const exactKey = canonicalExact(modelId);
    if (!looseKey) continue;
    if (!exact.has(exactKey)) exact.set(exactKey, []);
    exact.get(exactKey).push(modelId);
    if (!loose.has(looseKey)) loose.set(looseKey, []);
    loose.get(looseKey).push(modelId);
  }
  return { exact, loose };
}

async function fetchSource(source) {
  try {
    const url = `https://openrouter.ai/api/v1/benchmarks?source=${source}&max_results=500`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'ai-model-dashboard-bench/1.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`WARN: ${source} fetch failed (${err.message})`);
    return null;
  }
}

const METRICS = [
  ['intelligence_index', 'intelligence_index'],
  ['coding_index', 'coding_index'],
  ['agentic_index', 'agentic_index'],
  ['elo', 'elo'],
  ['win_rate', 'win_rate'],
  ['accuracy', 'accuracy'],
  ['primary_score', 'primary_score'],
  ['avg_cost_per_task', 'avg_cost_per_task'],
  ['avg_latency_per_task_ms', 'avg_latency_per_task_ms'],
  ['total_tasks', 'total_tasks'],
];

function store(body, index) {
  const meta = body.meta || {};
  const source = meta.source || 'openrouter';
  const asOf = meta.as_of || new Date().toISOString();
  const citation = meta.citation || `Source: ${source} via OpenRouter (openrouter.ai/rankings).`;
  const sourceUrl = meta.source_url || 'https://openrouter.ai/rankings';
  const insert = DB.prepare(
    `INSERT INTO benchmarks (model_id, source, metric, value, as_of, source_url, citation)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (model_id, source, metric) DO UPDATE SET
       value = excluded.value, as_of = excluded.as_of,
       source_url = excluded.source_url, citation = excluded.citation`,
  );

  // Resolve each OpenRouter entry to dashboard model_ids.
  // Priority 1 = version-specific match, priority 2 = version-agnostic match.
  // A version-agnostic match never overwrites a version-specific one.
  const resolved = [];
  for (const item of body.data || []) {
    const slug = item.model_permaslug || '';
    const exactKey = canonicalExact(slug);
    const looseKey = canonical(slug);
    const exactHits = index.exact.get(exactKey) || [];
    const looseHits = (index.loose.get(looseKey) || []).filter((id) => !exactHits.includes(id));
    if (!exactHits.length && !looseHits.length) continue;
    resolved.push({ item, targets: [...exactHits, ...looseHits], priority: exactHits.length ? 1 : 2 });
  }
  resolved.sort((a, b) => a.priority - b.priority);

  // First writer wins within a run, so a looser match cannot clobber a stricter one.
  const claimed = new Set();
  let rows = 0;
  let matched = 0;
  const tx = DB.transaction(() => {
    for (const { item, targets } of resolved) {
      let hit = false;
      for (const modelId of targets) {
        for (const [field, metric] of METRICS) {
          const value = item[field];
          if (value == null) continue;
          const claim = `${modelId}|${source}|${metric}`;
          if (claimed.has(claim)) continue;
          claimed.add(claim);
          insert.run(modelId, source, metric, Number(value), asOf, sourceUrl, citation);
          rows++;
          hit = true;
        }
      }
      if (hit) matched++;
    }
  });
  tx();
  return { rows, matched };
}

async function main() {
  const index = buildIndex();
  console.log(`Indexed ${index.exact.size} exact + ${index.loose.size} loose model keys.`);
  let totalRows = 0;
  for (const source of SOURCES) {
    const body = await fetchSource(source);
    if (!body || !Array.isArray(body.data)) { console.log(`  ${source}: no data`); continue; }
    const { rows, matched } = store(body, index);
    totalRows += rows;
    console.log(`  ${source}: ${matched}/${body.data.length} models matched, ${rows} rows written (as_of ${body.meta?.as_of ?? '?'})`);
  }
  // Propagate benchmarks from base models to :batch/:free/:latest variants
  const allModels = DB.prepare('SELECT model_id FROM models').all().map(r => r.model_id);
  const benchModelIds = DB.prepare('SELECT DISTINCT model_id FROM benchmarks').all().map(r => r.model_id);
  for (const baseModel of benchModelIds) {
    let propagated = 0;
    for (const modelId of allModels) {
      if (modelId === baseModel) continue;
      const suffixMatch = modelId.match(/:(free|batch|latest)$/);
      if (!suffixMatch) continue;
      const stripped = modelId.replace(/:(free|batch|latest)$/, '');
      if (stripped === baseModel || canonical(stripped) === canonical(baseModel)) {
        const sourceRows = DB.prepare('SELECT source, metric, value, as_of, source_url, citation FROM benchmarks WHERE model_id = ?').all(baseModel);
        for (const sr of sourceRows) {
          const check = DB.prepare('SELECT 1 FROM benchmarks WHERE model_id = ? AND source = ? AND metric = ?').get(modelId, sr.source, sr.metric);
          if (!check) {
            DB.prepare('INSERT INTO benchmarks (model_id, source, metric, value, as_of, source_url, citation) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              modelId, sr.source, sr.metric, sr.value, sr.as_of, sr.source_url, sr.citation
            );
            propagated++;
          }
        }
      }
    }
    if (propagated > 0) console.log(`Propagated ${propagated} benchmarks from ${baseModel}`);
  }
  // Name-based matching for remaining variants (e.g. route aliases with different model_ids)
  const benchNames = DB.prepare('SELECT DISTINCT model_id FROM benchmarks').all().map(r => r.model_id);
  const benchNameMap = new Map();
  for (const b of benchNames) {
    const r = DB.prepare('SELECT name FROM models WHERE model_id = ? LIMIT 1').get(b);
    if (r && r.name) benchNameMap.set(r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), b);
  }
  let namePropagated = 0;
  for (const row of DB.prepare("SELECT model_id, name FROM models").all()) {
    if (benchNames.includes(row.model_id)) continue;
    const n = (row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (benchNameMap.has(n)) {
      const targetId = benchNameMap.get(n);
      const sourceRows = DB.prepare('SELECT source, metric, value, as_of, source_url, citation FROM benchmarks WHERE model_id = ?').all(targetId);
      for (const sr of sourceRows) {
        const check = DB.prepare('SELECT 1 FROM benchmarks WHERE model_id = ? AND source = ? AND metric = ?').get(row.model_id, sr.source, sr.metric);
        if (!check) {
          DB.prepare('INSERT INTO benchmarks (model_id, source, metric, value, as_of, source_url, citation) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            row.model_id, sr.source, sr.metric, sr.value, sr.as_of, sr.source_url, sr.citation
          );
          namePropagated++;
        }
      }
    }
  }
  if (namePropagated > 0) console.log(`Propagated ${namePropagated} benchmarks via name matching`);
  totalRows += namePropagated + propagatedTotal;
  console.log(`Total benchmark rows written: ${totalRows}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
