const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { seedModels } = require('../lib/seed-data.ts');

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'models.db');
const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');

function normalizeModel(model) {
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

fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

const count = db.prepare('SELECT COUNT(*) as count FROM models').get();
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
    for (const model of seedModels) insert.run(normalizeModel(model));
  });
  tx();
  console.log(`Seeded ${seedModels.length} models into ${dbPath}`);
} else {
  console.log(`Database already contains ${count.count} models.`);
}

db.close();
