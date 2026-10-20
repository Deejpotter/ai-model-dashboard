CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  api TEXT,
  reasoning INTEGER DEFAULT 0,
  multimodal TEXT,
  -- Pricing (per 1M tokens, USD)
  price_input REAL,
  price_output REAL,
  price_cache_read REAL DEFAULT 0,
  price_cache_write REAL DEFAULT 0,
  -- Subscription metadata when a route includes a published allowance
  subscription_monthly REAL,
  included_usage_usd REAL,
  pricing_note TEXT,
  -- Context
  context_window INTEGER,
  max_tokens INTEGER,
  -- Benchmarks
  mmlu_pro REAL,
  gpqa_diamond REAL,
  hle REAL,
  aime_2026 REAL,
  swe_verified REAL,
  livecode_bench REAL,
  codeforces_elo INTEGER,
  terminal_bench REAL,
  mmlu REAL,
  aime_2025 REAL,
  -- General category scores (0-100, mean of available inputs; see README)
  score_coding REAL,
  score_thinking REAL,
  score_maths REAL,
  score_overall REAL,
  score_sources TEXT,
  -- Whether a performance profile is benchmark-derived, matched to the same
  -- underlying model, or a clearly-labelled indicative estimate.
  score_kind TEXT,
  score_confidence TEXT,
  -- Flags
  is_favourite INTEGER DEFAULT 0,
  -- Sync (populated by scripts/sync-models.mjs, never hand-edited)
  available_via TEXT DEFAULT '',
  last_seen TEXT,
  -- Metadata
  notes TEXT,
  last_updated TEXT,
  source_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
CREATE INDEX IF NOT EXISTS idx_models_favourite ON models(is_favourite);
CREATE INDEX IF NOT EXISTS idx_models_price_output ON models(price_output);
CREATE TABLE IF NOT EXISTS benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  source TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  as_of TEXT,
  source_url TEXT,
  citation TEXT,
  UNIQUE (model_id, source, metric)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_model ON benchmarks(model_id);
