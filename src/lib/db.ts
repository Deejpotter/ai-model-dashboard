import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seedModels } = require('./seed-data.js');

const dbDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'models.db');
const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbInstance: any = null;

function normalizeModel(model: Record<string, unknown>) {
  return {
    api: null,
    reasoning: 0,
    multimodal: 'text',
    price_input: null,
    price_output: null,
    price_cache_read: 0,
    price_cache_write: 0,
    context_window: null,
    max_tokens: null,
    mmlu_pro: null,
    gpqa_diamond: null,
    hle: null,
    aime_2026: null,
    swe_verified: null,
    livecode_bench: null,
    codeforces_elo: null,
    terminal_bench: null,
    mmlu: null,
    notes: null,
    source_url: null,
    ...model,
  };
}

function ensureDb() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  const count = db.prepare('SELECT COUNT(*) as count FROM models').get() as { count: number };
  if (count.count === 0) {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO models (
        provider, model_id, name, api, reasoning, multimodal,
        price_input, price_output, price_cache_read, price_cache_write,
        context_window, max_tokens,
        mmlu_pro, gpqa_diamond, hle, aime_2026,
        swe_verified, livecode_bench, codeforces_elo, terminal_bench, mmlu,
        notes, source_url, last_updated
      ) VALUES (
        @provider, @model_id, @name, @api, @reasoning, @multimodal,
        @price_input, @price_output, @price_cache_read, @price_cache_write,
        @context_window, @max_tokens,
        @mmlu_pro, @gpqa_diamond, @hle, @aime_2026,
        @swe_verified, @livecode_bench, @codeforces_elo, @terminal_bench, @mmlu,
        @notes, @source_url, datetime('now')
      )
    `);
    const tx = db.transaction(() => {
      for (const model of seedModels) insert.run(normalizeModel(model as Record<string, unknown>));
    });
    tx();
  }

  dbInstance = db;
  return db;
}

export function getDb() {
  return ensureDb();
}

export type ModelRecord = {
  id: number;
  provider: string;
  model_id: string;
  name: string;
  api: string | null;
  reasoning: number;
  multimodal: string | null;
  price_input: number | null;
  price_output: number | null;
  price_cache_read: number | null;
  price_cache_write: number | null;
  subscription_monthly?: number | null;
  included_usage_usd?: number | null;
  pricing_note?: string | null;
  context_window: number | null;
  max_tokens: number | null;
  mmlu_pro: number | null;
  gpqa_diamond: number | null;
  hle: number | null;
  aime_2026: number | null;
  swe_verified: number | null;
  livecode_bench: number | null;
  codeforces_elo: number | null;
  terminal_bench: number | null;
  mmlu: number | null;
  aime_2025?: number | null;
  is_favourite: number;
  notes: string | null;
  last_updated: string | null;
  source_url: string | null;
  available_via?: string | null;
  last_seen?: string | null;
  score_coding?: number | null;
  score_thinking?: number | null;
  score_maths?: number | null;
  score_overall?: number | null;
  score_sources?: string | null;
  score_kind?: 'measured' | 'matched' | 'estimated' | 'baseline' | null;
  score_confidence?: 'high' | 'medium' | 'low' | null;
};

export function listModels(params?: { search?: string; provider?: string; favouritesOnly?: boolean; sort?: string; dir?: 'asc' | 'desc'; }) {
  const db = getDb();
  const allowedSort = new Set(['name','provider','price_input','price_output','context_window','gpqa_diamond','swe_verified','aime_2026','livecode_bench','codeforces_elo','mmlu_pro','hle','terminal_bench','is_favourite','score_coding','score_thinking','score_maths','score_overall']);
  const sort = params?.sort && allowedSort.has(params.sort) ? params.sort : 'price_output';
  const dir = params?.dir === 'desc' ? 'DESC' : 'ASC';
  let sql = 'SELECT * FROM models WHERE 1=1';
  const args: Array<string | number> = [];
  if (params?.search) {
    sql += ' AND (name LIKE ? OR model_id LIKE ? OR provider LIKE ? OR notes LIKE ?)';
    const q = `%${params.search}%`;
    args.push(q, q, q, q);
  }
  if (params?.provider) {
    sql += ' AND provider = ?';
    args.push(params.provider);
  }
  if (params?.favouritesOnly) sql += ' AND is_favourite = 1';
  sql += ` ORDER BY ${sort} ${dir} NULLS LAST, name ASC`;
  return db.prepare(sql).all(...args) as ModelRecord[];
}

export function getModel(id: number) {
  return getDb().prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRecord | undefined;
}

export function toggleFavourite(id: number) {
  const db = getDb();
  db.prepare('UPDATE models SET is_favourite = CASE WHEN is_favourite = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRecord | undefined;
}
