#!/usr/bin/env node
// sync-models.mjs - refresh ai-model-dashboard prices/context from live APIs.
//
// Sources (all keyless):
//   1. models.dev catalog  -> per-provider prices, context windows, modalities
//   2. OpenRouter /models  -> live OpenRouter prices + context
//   3. `opencode models`   -> tags which rows exist in your configured lanes
//
// Manual columns (benchmarks, notes, is_favourite) are NEVER overwritten.
// Only pricing/context/reasoning/multimodal/name/source/availability change.
//
// Matching rule: a dashboard row is refreshed ONLY from its own provider's
// catalog section (same-provider match). Cross-provider id collisions
// (e.g. openai/gpt-5.4 vs github-copilot/gpt-5.4) must never overwrite rows.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = path.join(ROOT, 'data', 'models.db');
const SCHEMA_PATH = path.join(ROOT, 'src', 'db', 'schema.sql');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const OPENCODE_ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models';
const OPENCODE_ZEN_PRICING_URL = 'https://dev.opencode.ai/docs/zen/';
const OPENCODE_GO_PRICING_URL = 'https://dev.opencode.ai/docs/go/';
const ALLBENCH_URL = 'https://huggingface.co/datasets/youssef3146/ALL-Bench-Leaderboard/resolve/main/data/llm.jsonl';

// Dashboard provider label -> models.dev provider id. Unmapped providers
// (e.g. GitHub Copilot, no public pricing API) are skipped with a warning.
const PROVIDER_MAP = {
  DeepInfra: 'deepinfra',
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Google: 'google',
  Mistral: 'mistral',
  'xAI': 'xai',
  DeepSeek: 'deepseek',
  Meta: 'meta',
  Qwen: 'qwen',
  Moonshot: 'moonshotai',
  Xiaomi: 'mimo',
  MiniMax: 'minimax',
  Nvidia: 'nvidia',
  StepFun: 'stepfun',
  Vultr: 'vultr',
};

// opencode lane prefix -> short tag stored in available_via
const LANE_TAGS = {
  openrouter: 'openrouter',
  'console-openrouter': 'openrouter',
  opencode: 'zen',
  'opencode-go': 'go',
  deepseek: 'deepseek',
  lmstudio: 'lmstudio',
  'console-anthropic': 'console-anthropic',
};

const ROUTE_PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  'console-openrouter': 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'console-anthropic': 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  deepinfra: 'DeepInfra',
  mistral: 'Mistral',
  xai: 'xAI',
  vultr: 'Vultr',
  'github-copilot': 'GitHub Copilot',
  lmstudio: 'LM Studio',
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ai-model-dashboard-sync/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function fetchJsonSoft(url) {
  try { return await fetchJson(url); }
  catch (err) { console.warn(`WARN: ${url} unavailable (${err.message})`); return { data: [] }; }
}

async function fetchTextSoft(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ai-model-dashboard-sync/1.0' } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } catch (err) {
    console.warn(`WARN: ${url} unavailable (${err.message})`);
    return '';
  }
}

const stripHtml = (value) => value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const normalizeOpenCodeName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const pricingNumber = (value) => {
  const text = stripHtml(value);
  if (/^(free|unlimited)$/i.test(text)) return 0;
  const matches = [...text.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
};

function readPricingTable(html, needsMonthlyLimit) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const table = tables.find((candidate) => {
    const header = stripHtml((candidate.match(/<thead[\s\S]*?<\/thead>/i) || [''])[0]);
    return header.includes('Input') && header.includes('Output') && header.includes('Cached Read') && (!needsMonthlyLimit || header.includes('Monthly limit'));
  });
  if (!table) return new Map();
  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const result = new Map();
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => match[1]);
    if (cells.length < 4) continue;
    const name = stripHtml(cells[0]);
    const input = pricingNumber(cells[1]);
    const output = pricingNumber(cells[2]);
    if (!name || input == null || output == null) continue;
    const includedUsage = needsMonthlyLimit ? pricingNumber(cells[5] || '') : null;
    result.set(normalizeOpenCodeName(name), { input, output, cacheRead: pricingNumber(cells[3]), includedUsage });
  }
  return result;
}

async function readOpenCodePricing() {
  const [zenHtml, goHtml] = await Promise.all([fetchTextSoft(OPENCODE_ZEN_PRICING_URL), fetchTextSoft(OPENCODE_GO_PRICING_URL)]);
  return { zen: readPricingTable(zenHtml, false), go: readPricingTable(goHtml, true) };
}

function findOpencodeExe() {
  const seen = new Set();
  const cands = [];
  for (const name of ['opencode.exe', 'opencode']) {
    let out;
    try {
      out = execFileSync('where.exe', [name], { encoding: 'utf8', timeout: 15000 });
    } catch {
      continue; // not resolvable under this name
    }
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (/\.exe$/i.test(p)) cands.push(p);
      else {
        // shim (extensionless, .cmd, .ps1): probe nvm/npm layout beneath its dir
        cands.push(path.join(path.dirname(p), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
      }
    }
  }
  return cands.find((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  }) || null;
}

function readOpencodeLanes() {
  const exe = findOpencodeExe();
  if (!exe) {
    console.warn('WARN: opencode.exe not found - skipping lane tagging');
    return null;
  }
  try {
    const out = execFileSync(exe, ['models'], { encoding: 'utf8', timeout: 120000 });
    const lanes = {};
    for (const line of out.split(/\r?\n/)) {
      const id = line.trim();
      const slash = id.indexOf('/');
      if (slash <= 0) continue;
      const lane = id.slice(0, slash);
      const tag = LANE_TAGS[lane] ?? lane;
      (lanes[tag] ??= []).push(id);
    }
    return lanes;
  } catch (err) {
    console.warn(`WARN: 'opencode models' failed (${err.message}) - skipping lane tagging`);
    return null;
  }
}

async function readVultrAccount() {
  const key = process.env.VULTR_INFERENCE_API_KEY || process.env.VULTR_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://api.vultrinference.com/v1/models', {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ai-model-dashboard-sync/1.0' },
    });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    return ((await resp.json()).data || []).map((m) => m.id).filter(Boolean);
  } catch (err) {
    console.warn(`WARN: Vultr account check failed (${err.message})`);
    return null;
  }
}

async function readAllBench() {
  try {
    const resp = await fetch(ALLBENCH_URL, { headers: { 'User-Agent': 'ai-model-dashboard-sync/1.0' } });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const rows = [];
    for (const line of (await resp.text()).split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { /* skip malformed lines */ }
    }
    return rows;
  } catch (err) {
    console.warn(`WARN: ALL-Bench fetch failed (${err.message})`);
    return null;
  }
}

async function readAA() {
  const key = process.env.AA_API_KEY || process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://artificialanalysis.ai/api/v2/data/llms/models', {
      headers: { 'x-api-key': key, 'User-Agent': 'ai-model-dashboard-sync/1.0' },
    });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const body = await resp.json();
    return body.data || body || null;
  } catch (err) {
    console.warn(`WARN: Artificial Analysis fetch failed (${err.message})`);
    return null;
  }
}

function main() {
  return (async () => {
    const [catalog, orData, lanes, vultrAccount, allbench, aaModels, zenCatalog, goCatalog, opencodePricing] = await Promise.all([
      fetchJson(MODELS_DEV_URL),
      fetchJson(OPENROUTER_URL),
      Promise.resolve().then(readOpencodeLanes),
      readVultrAccount(),
      readAllBench(),
      readAA(),
      fetchJsonSoft(OPENCODE_ZEN_MODELS_URL),
      fetchJsonSoft(OPENCODE_GO_MODELS_URL),
      readOpenCodePricing(),
    ]);

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    // Lightweight migrations for pre-existing DBs (schema.sql covers fresh ones).
    const cols = new Set(db.prepare('PRAGMA table_info(models)').all().map((c) => c.name));
    if (!cols.has('available_via')) db.exec("ALTER TABLE models ADD COLUMN available_via TEXT DEFAULT ''");
    if (!cols.has('last_seen')) db.exec('ALTER TABLE models ADD COLUMN last_seen TEXT');
    if (!cols.has('score_coding')) db.exec('ALTER TABLE models ADD COLUMN score_coding REAL');
    if (!cols.has('score_thinking')) db.exec('ALTER TABLE models ADD COLUMN score_thinking REAL');
    if (!cols.has('score_maths')) db.exec('ALTER TABLE models ADD COLUMN score_maths REAL');
    if (!cols.has('score_sources')) db.exec('ALTER TABLE models ADD COLUMN score_sources TEXT');
    if (!cols.has('score_overall')) db.exec('ALTER TABLE models ADD COLUMN score_overall REAL');
    if (!cols.has('score_kind')) db.exec('ALTER TABLE models ADD COLUMN score_kind TEXT');
    if (!cols.has('score_confidence')) db.exec('ALTER TABLE models ADD COLUMN score_confidence TEXT');
    if (!cols.has('aime_2025')) db.exec('ALTER TABLE models ADD COLUMN aime_2025 REAL');
    if (!cols.has('subscription_monthly')) db.exec('ALTER TABLE models ADD COLUMN subscription_monthly REAL');
    if (!cols.has('included_usage_usd')) db.exec('ALTER TABLE models ADD COLUMN included_usage_usd REAL');
    if (!cols.has('pricing_note')) db.exec('ALTER TABLE models ADD COLUMN pricing_note TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY, value TEXT, updated TEXT
    )`);
    // Older syncs used raw lower-case lane names as provider labels. Keep the
    // provider selector readable and avoid duplicate filters for one provider.
    for (const [lane, label] of Object.entries(ROUTE_PROVIDER_LABELS)) {
      db.prepare('UPDATE models SET provider = ? WHERE provider = ?').run(label, lane);
    }

    // Per-provider lowercase catalog indexes (same-provider matching only).
    const catIdx = {};
    const publicSpecs = new Map();
    for (const devId of new Set(Object.values(PROVIDER_MAP))) {
      const entry = catalog[devId];
      if (!entry || !entry.models) continue;
      const idx = new Map();
      for (const [key, m] of Object.entries(entry.models)) {
        idx.set(key.toLowerCase(), m);
        const specKey = normalizeOpenCodeName(key);
        if (specKey && !publicSpecs.has(specKey)) publicSpecs.set(specKey, m);
      }
      catIdx[devId] = { entry, idx };
    }

    const upsert = db.prepare(`INSERT INTO models (
        provider, model_id, name, reasoning, multimodal,
        price_input, price_output, price_cache_read, price_cache_write,
        context_window, max_tokens, source_url, last_updated, last_seen
      ) VALUES (
        @provider, @model_id, @name, @reasoning, @multimodal,
        @price_input, @price_output, @price_cache_read, @price_cache_write,
        @context_window, @max_tokens, @source_url, datetime('now'), datetime('now')
      ) ON CONFLICT(model_id) DO UPDATE SET
        name = excluded.name,
        reasoning = excluded.reasoning,
        multimodal = excluded.multimodal,
        price_input = excluded.price_input,
        price_output = excluded.price_output,
        price_cache_read = excluded.price_cache_read,
        price_cache_write = excluded.price_cache_write,
        context_window = excluded.context_window,
        max_tokens = excluded.max_tokens,
        source_url = excluded.source_url,
        last_updated = datetime('now'),
        last_seen = datetime('now')`);

    const insertDiscovered = db.prepare(`INSERT INTO models (
      provider, model_id, name, reasoning, multimodal,
      price_input, price_output, price_cache_read, price_cache_write,
      context_window, max_tokens, source_url, last_updated, last_seen, available_via
    ) VALUES (
      @provider, @model_id, @name, @reasoning, @multimodal,
      @price_input, @price_output, @price_cache_read, @price_cache_write,
      @context_window, @max_tokens, @source_url, datetime('now'), datetime('now'), @available_via
    ) ON CONFLICT(model_id) DO UPDATE SET
      available_via = CASE
        WHEN excluded.available_via = '' THEN models.available_via
        WHEN models.available_via IS NULL OR models.available_via = '' THEN excluded.available_via
        WHEN instr(',' || models.available_via || ',', ',' || excluded.available_via || ',') > 0 THEN models.available_via
        ELSE models.available_via || ',' || excluded.available_via END,
      last_seen = datetime('now')`);

    const markLane = db.prepare(
      `UPDATE models SET available_via = CASE
         WHEN available_via IS NULL OR available_via = '' THEN @tag
         WHEN instr(',' || available_via || ',', ',' || @tag || ',') > 0 THEN available_via
         ELSE available_via || ',' || @tag END
       WHERE model_id = @model_id`
    );

    const stats = { refreshed: 0, inserted: 0, skippedProviders: [], openrouter: 0 };

    const tx = db.transaction(() => {
      const idSet = new Set(
        db.prepare('SELECT model_id FROM models').all().map((row) => row.model_id.toLowerCase())
      );

      // 1. Refresh curated rows from their OWN provider's catalog section.
      const rows = db.prepare('SELECT model_id, provider FROM models').all();
      for (const row of rows) {
        const devId = PROVIDER_MAP[row.provider];
        const cat = devId && catIdx[devId];
        if (!cat) continue;
        const lower = row.model_id.toLowerCase();
        const segs = lower.split('/');
        // Most specific first: full id, minus host prefix, bare model name.
        const candidates = [lower, segs.slice(1).join('/'), segs[segs.length - 1]];
        let m = null;
        for (const c of candidates) {
          if (c && cat.idx.has(c)) { m = cat.idx.get(c); break; }
        }
        if (!m) continue;
        const cost = m.cost || {};
        // Negative prices are upstream sentinels for "variable pricing" - store NULL.
        const clean = (v) => (v == null || Number(v) < 0 ? null : Number(v));
        upsert.run({
          provider: row.provider,
          model_id: row.model_id,
          name: m.name || row.model_id,
          reasoning: m.reasoning ? 1 : 0,
          multimodal: (m.modalities && m.modalities.input ? m.modalities.input : ['text']).join(','),
          price_input: clean(cost.input),
          price_output: clean(cost.output),
          price_cache_read: cost.cache_read ?? 0,
          price_cache_write: cost.cache_write ?? 0,
          context_window: m.limit ? m.limit.context ?? null : null,
          max_tokens: m.limit ? m.limit.output ?? m.limit.context ?? null : null,
          source_url: cat.entry.doc || null,
        });
        stats.refreshed++;
      }

      // 1a. Import all mapped public provider catalogues, not just the original
      // seed list or locally configured OpenCode lanes. This makes fresh containers
      // useful immediately, even when the OpenCode CLI is not installed there.
      for (const [provider, devId] of Object.entries(PROVIDER_MAP)) {
        const cat = catIdx[devId];
        if (!cat) continue;
        for (const [key, model] of cat.idx.entries()) {
          const modelId = `${devId}/${key}`;
          if (idSet.has(modelId.toLowerCase())) continue;
          const pricing = model.cost || {};
          const clean = (value) => (value == null || Number(value) < 0 ? null : Number(value));
          upsert.run({
            provider, model_id: modelId, name: model.name || key, reasoning: model.reasoning ? 1 : 0,
            multimodal: (model.modalities?.input || ['text']).join(','),
            price_input: clean(pricing.input), price_output: clean(pricing.output),
            price_cache_read: clean(pricing.cache_read) ?? 0, price_cache_write: clean(pricing.cache_write) ?? 0,
            context_window: model.limit?.context ?? null, max_tokens: model.limit?.output ?? model.limit?.context ?? null,
            source_url: cat.entry.doc || null,
          });
          idSet.add(modelId.toLowerCase());
          stats.inserted++;
        }
      }

      // 1b. OpenCode publishes its Zen and Go lists independently of the local
      // OpenCode CLI. Import them so deployed containers retain those routes too.
      for (const [provider, prefix, tag, catalogRows] of [
        ['OpenCode Zen', 'opencode', 'zen', zenCatalog.data || []],
        ['OpenCode Go', 'opencode-go', 'go', goCatalog.data || []],
      ]) {
        for (const model of catalogRows) {
          if (!model.id) continue;
          const modelId = `${prefix}/${model.id}`;
          if (idSet.has(modelId.toLowerCase())) { markLane.run({ tag, model_id: modelId }); continue; }
          insertDiscovered.run({ provider, model_id: modelId, name: model.id, reasoning: 0, multimodal: 'text', price_input: null, price_output: null, price_cache_read: null, price_cache_write: null, context_window: null, max_tokens: null, source_url: 'https://opencode.ai', available_via: tag });
          idSet.add(modelId.toLowerCase()); stats.inserted++;
        }
      }

      // 1b(ii). The Zen/Go /models endpoints only return IDs. Their published
      // documentation is the authoritative price source, including Go's monthly
      // usage allowance, so overlay it after importing the sparse route lists.
      const applyOpenCodePricing = db.prepare(`UPDATE models SET
        price_input = @price_input,
        price_output = @price_output,
        price_cache_read = @price_cache_read,
        subscription_monthly = @subscription_monthly,
        included_usage_usd = @included_usage_usd,
        pricing_note = @pricing_note,
        source_url = @source_url,
        last_updated = datetime('now')
        WHERE model_id = @model_id`);
      const applyPricing = (provider, prefix, entries, sourceUrl) => {
        let updated = 0;
        for (const row of db.prepare('SELECT model_id FROM models WHERE provider = ?').all(provider)) {
          const id = row.model_id.startsWith(`${prefix}/`) ? row.model_id.slice(prefix.length + 1) : row.model_id;
          const rate = entries.get(normalizeOpenCodeName(id));
          if (!rate) continue;
          const isFree = rate.input === 0 && rate.output === 0;
          const hasAllowance = rate.includedUsage != null;
          const allowance = hasAllowance && rate.includedUsage > 0 ? rate.includedUsage : null;
          const note = provider === 'OpenCode Go'
            ? isFree ? 'Free token rate on the Go plan; published allowance: Unlimited'
              : `Go plan from $10/month · includes ${allowance == null ? 'a published model allowance' : `$${allowance} of model usage`} each month`
            : 'Zen pay-as-you-go · live published token rate';
          updated += applyOpenCodePricing.run({
            model_id: row.model_id,
            price_input: rate.input,
            price_output: rate.output,
            price_cache_read: rate.cacheRead ?? 0,
            subscription_monthly: provider === 'OpenCode Go' ? 10 : null,
            included_usage_usd: allowance,
            pricing_note: note,
            source_url: sourceUrl,
          }).changes;
        }
        return updated;
      };
      stats.opencodeZenPriced = applyPricing('OpenCode Zen', 'opencode', opencodePricing.zen, OPENCODE_ZEN_PRICING_URL);
      stats.opencodeGoPriced = applyPricing('OpenCode Go', 'opencode-go', opencodePricing.go, OPENCODE_GO_PRICING_URL);
      const applyOpenCodeSpecs = db.prepare(`UPDATE models SET
        reasoning = @reasoning,
        multimodal = @multimodal,
        context_window = @context_window,
        max_tokens = @max_tokens
        WHERE model_id = @model_id`);
      const backfillRouteSpecs = (provider, prefix) => {
        let updated = 0;
        for (const row of db.prepare('SELECT model_id FROM models WHERE provider = ?').all(provider)) {
          const id = row.model_id.startsWith(`${prefix}/`) ? row.model_id.slice(prefix.length + 1) : row.model_id;
          const spec = publicSpecs.get(normalizeOpenCodeName(id).replace(/free$/, ''));
          if (!spec) continue;
          updated += applyOpenCodeSpecs.run({
            model_id: row.model_id,
            reasoning: spec.reasoning ? 1 : 0,
            multimodal: (spec.modalities?.input || ['text']).join(','),
            context_window: spec.limit?.context ?? null,
            max_tokens: spec.limit?.output ?? spec.limit?.context ?? null,
          }).changes;
        }
        return updated;
      };
      stats.opencodeZenSpecs = backfillRouteSpecs('OpenCode Zen', 'opencode');
      stats.opencodeGoSpecs = backfillRouteSpecs('OpenCode Go', 'opencode-go');

      // 1c. Vultr catalog: small upstream list (15 models), auto-add new rows.
      const vultr = catIdx.vultr;
      if (vultr) {
        const known = new Set(db.prepare('SELECT model_id FROM models').all().map((r) => r.model_id.toLowerCase()));
        const cleanV = (v) => (v == null || Number(v) < 0 ? null : Number(v));
        for (const m of vultr.idx.values()) {
          const modelId = `vultr/${m.id}`;
          if (known.has(modelId.toLowerCase())) continue;
          const cost = m.cost || {};
          upsert.run({
            provider: 'Vultr',
            model_id: modelId,
            name: m.name || m.id,
            reasoning: m.reasoning ? 1 : 0,
            multimodal: (m.modalities && m.modalities.input ? m.modalities.input : ['text']).join(','),
            price_input: cleanV(cost.input),
            price_output: cleanV(cost.output),
            price_cache_read: cleanV(cost.cache_read) ?? 0,
            price_cache_write: cleanV(cost.cache_write) ?? 0,
            context_window: m.limit ? m.limit.context ?? null : null,
            max_tokens: m.limit ? m.limit.output ?? m.limit.context ?? null : null,
            source_url: vultr.entry.doc || 'https://www.vultr.com/pricing',
          });
          known.add(modelId.toLowerCase());
          stats.inserted++;
        }
      }

      // Provider labels with no catalog section stay untouched.
      const dbProviders = db.prepare('SELECT DISTINCT provider FROM models').all().map((r) => r.provider);
      for (const label of dbProviders) {
        const devId = PROVIDER_MAP[label];
        if (!devId || !catIdx[devId]) stats.skippedProviders.push(label);
      }

      // 2. OpenRouter catalog (owns openrouter/* rows exclusively).
      for (const m of orData.data || []) {
        if (!m.id || m.id.startsWith('~')) continue; // skip aliases/endpoint noise
        const p = m.pricing || {};
        // OpenRouter uses negative pricing as a "variable price" sentinel - store NULL.
        const toM = (v) => (v == null || v === '' || Number(v) < 0 ? null : Number(v) * 1e6);
        const modelId = `openrouter/${m.id}`;
        const isNew = !idSet.has(modelId.toLowerCase());
        upsert.run({
          provider: 'OpenRouter',
          model_id: modelId,
          name: m.name || m.id,
          reasoning: m.architecture && m.architecture.reasoning ? 1 : 0,
          multimodal: (m.architecture && m.architecture.input_modalities
            ? m.architecture.input_modalities : ['text']).join(','),
          price_input: toM(p.prompt),
          price_output: toM(p.completion),
          price_cache_read: toM(p.input_cache_read) ?? 0,
          price_cache_write: toM(p.input_cache_write) ?? 0,
          context_window: m.context_length ?? null,
          max_tokens: (m.top_provider && m.top_provider.max_completion_tokens) || null,
          source_url: 'https://openrouter.ai/models',
        });
        if (isNew) { idSet.add(modelId.toLowerCase()); stats.inserted++; }
        else stats.refreshed++;
        stats.openrouter++;
      }

      // 3. Import OpenCode-only routes (notably Zen and Go), then tag every
      // configured route on matching public-catalogue rows. These routes often
      // have no public token price, so their pricing remains NULL by design.
      if (lanes) {
        for (const [tag, ids] of Object.entries(lanes)) {
          for (const id of ids) {
            if (!id || id.endsWith('/*')) continue;
            if (idSet.has(id.toLowerCase())) {
              markLane.run({ tag, model_id: id });
              continue;
            }
            const [, ...nameParts] = id.split('/');
            const routeName = tag === 'zen' ? 'OpenCode Zen' : tag === 'go' ? 'OpenCode Go' : ROUTE_PROVIDER_LABELS[tag] ?? tag;
            insertDiscovered.run({
              provider: routeName,
              model_id: id,
              name: nameParts.join('/') || id,
              reasoning: 0,
              multimodal: 'text',
              price_input: null,
              price_output: null,
              price_cache_read: null,
              price_cache_write: null,
              context_window: null,
              max_tokens: null,
              source_url: 'https://opencode.ai',
              available_via: tag,
            });
            idSet.add(id.toLowerCase());
            stats.inserted++;
          }
        }
      }

      // 1c. Vultr account check (fetched up-front; best-effort).
      // Tags account models and adds account-only ones (no public prices -> NULL).
      if (vultrAccount) {
        for (const id of vultrAccount) {
          const modelId = `vultr/${id}`;
          if (idSet.has(modelId.toLowerCase())) {
            markLane.run({ tag: 'vultr-account', model_id: modelId });
          } else {
            upsert.run({
              provider: 'Vultr', model_id: modelId, name: id, reasoning: 0,
              multimodal: 'text', price_input: null, price_output: null,
              price_cache_read: 0, price_cache_write: 0, context_window: null,
              max_tokens: null, source_url: 'https://api.vultrinference.com/',
            });
            idSet.add(modelId.toLowerCase());
            stats.inserted++;
          }
        }
      }

      // 3b. Benchmark backfill (ALL-Bench, keyless) + general category scores.
      // Specific columns fill only where NULL (manual/seed wins). Categories are
      // the mean of available inputs: coding <- swe_verified, livecode_bench,
      // ab-swepro, ab-lcb; thinking <- gpqa_diamond, hle, ab-gpqa, ab-hle;
      // maths <- aime_2026, ab-aime. ab- = ALL-Bench, keyless, March 2026 data.
      const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanB = (v) => (v == null || v === '' ? null : Number(v));
      const abByName = new Map();
      if (allbench) {
        for (const e of allbench) {
          const k = normName(e.name);
          if (k && !abByName.has(k)) abByName.set(k, e);
        }
      }
      const fillSpecs = db.prepare(`UPDATE models SET
        mmlu_pro = COALESCE(mmlu_pro, @mmlu_pro),
        gpqa_diamond = COALESCE(gpqa_diamond, @gpqa),
        hle = COALESCE(hle, @hle),
        livecode_bench = COALESCE(livecode_bench, @lcb)
        WHERE model_id = @model_id`);
      // Artificial Analysis evaluations (fractions -> %). Fills NULL cells only.
      const aaByName = new Map();
      if (aaModels) {
        const pct = (v) => (v == null ? null : Math.round(Number(v) * 1000) / 10);
        const rows = Array.isArray(aaModels) ? aaModels : [];
        for (const m of rows) {
          const ev = (m && m.evaluations) || {};
          const rec = {
            mmlu_pro: pct(ev.mmlu_pro), gpqa: pct(ev.gpqa), hle: pct(ev.hle),
            lcb: pct(ev.livecodebench ?? ev.livecode_bench), aime: pct(ev.aime),
            math500: pct(ev.math_500 ?? ev.math500), scicode: pct(ev.scicode),
          };
          for (const k of [m.name, m.slug]) {
            const key = normName(k);
            if (key && !aaByName.has(key)) aaByName.set(key, rec);
          }
        }
      }
      const aaFill = db.prepare(`UPDATE models SET
        mmlu_pro = COALESCE(mmlu_pro, @mmlu_pro),
        gpqa_diamond = COALESCE(gpqa_diamond, @gpqa),
        hle = COALESCE(hle, @hle),
        livecode_bench = COALESCE(livecode_bench, @lcb),
        aime_2025 = COALESCE(aime_2025, @aime)
        WHERE model_id = @model_id`);
      if (aaByName.size) {
        let aaFilled = 0;
        for (const r of db.prepare('SELECT model_id, name FROM models').all()) {
          const rec = aaByName.get(normName(r.name));
          if (!rec) continue;
          aaFill.run({
            model_id: r.model_id, mmlu_pro: rec.mmlu_pro, gpqa: rec.gpqa,
            hle: rec.hle, lcb: rec.lcb, aime: rec.aime,
          });
          aaFilled++;
        }
        console.log(`benchmarks: Artificial Analysis filled ${aaFilled} rows`);
        stats.aaFilled = aaFilled;
      }
      const setScores = db.prepare(`UPDATE models SET
        score_coding = @coding, score_thinking = @thinking,
        score_maths = @maths, score_overall = @overall, score_sources = @sources,
        score_kind = @kind, score_confidence = @confidence
        WHERE model_id = @model_id`);
      const one = (rowV, rowTag, abV, abTag) => {
        if (rowV != null) return { v: Number(rowV), t: rowTag };
        const n = cleanB(abV);
        return n == null ? null : { v: n, t: abTag };
      };
      const extra = (abV, abTag) => {
        const n = cleanB(abV);
        return n == null ? null : { v: n, t: abTag };
      };
      const avg = (items) => {
        const xs = items.filter(Boolean);
        if (!xs.length) return { score: null, sources: null };
        return {
          score: Math.round((xs.reduce((a, x) => a + x.v, 0) / xs.length) * 10) / 10,
          sources: xs.map((x) => x.t).join(','),
        };
      };
      let abMatched = 0;
      const specRows = db.prepare(
        'SELECT model_id, name, mmlu_pro, gpqa_diamond, hle, aime_2026, aime_2025, swe_verified, livecode_bench FROM models'
      ).all();
      for (const row of specRows) {
        const e = abByName.get(normName(row.name)) || {};
        const a = aaByName.get(normName(row.name)) || {};
        if (e.name) {
          abMatched++;
          fillSpecs.run({
            model_id: row.model_id,
            mmlu_pro: cleanB(e.mmluPro), gpqa: cleanB(e.gpqa),
            hle: cleanB(e.hle), lcb: cleanB(e.lcb),
          });
        }
        const coding = avg([one(row.swe_verified, 'swe_verified'), one(row.livecode_bench, 'livecode_bench', e.lcb, 'ab-lcb'), extra(e.swePro, 'ab-swepro'), extra(a.scicode, 'aa-scicode')]);
        const thinking = avg([one(row.gpqa_diamond, 'gpqa_diamond', e.gpqa, 'ab-gpqa'), one(row.hle, 'hle', e.hle, 'ab-hle')]);
        const maths = avg([one(row.aime_2026, 'aime_2026'), one(row.aime_2025, 'aime_2025'), extra(e.aime, 'ab-aime'), extra(a.math500, 'aa-math500')]);
        const srcs = [coding.sources, thinking.sources, maths.sources].filter(Boolean).join(',');
        const oparts = [coding.score, thinking.score, maths.score].filter((v) => v != null);
        const overall = oparts.length ? Math.round((oparts.reduce((a, v) => a + v, 0) / oparts.length) * 10) / 10 : null;
        setScores.run({
          model_id: row.model_id, coding: coding.score, thinking: thinking.score,
          maths: maths.score, overall, sources: srcs || null,
          kind: oparts.length ? 'measured' : null, confidence: oparts.length ? 'high' : null,
        });
      }
      // OpenCode Zen/Go routes are the same underlying models, but their route
      // lists do not carry benchmark identities. Reuse only an exact normalized
      // public-model match, never a fuzzy name match, to keep scores auditable.
      const routeScores = new Map();
      for (const row of db.prepare(`SELECT model_id, name, score_coding, score_thinking, score_maths, score_overall, score_sources
        FROM models WHERE provider NOT IN ('OpenCode Zen', 'OpenCode Go')`).all()) {
        if (row.score_overall == null && row.score_coding == null && row.score_thinking == null && row.score_maths == null) continue;
        for (const key of [normalizeOpenCodeName(row.name), normalizeOpenCodeName(row.model_id.split('/').at(-1))]) {
          if (key && !routeScores.has(key)) routeScores.set(key, row);
        }
      }
      const copyRouteScores = db.prepare(`UPDATE models SET
        score_coding = @score_coding, score_thinking = @score_thinking,
        score_maths = @score_maths, score_overall = @score_overall,
        score_sources = @score_sources, score_kind = 'matched', score_confidence = 'high'
        WHERE model_id = @model_id`);
      let copiedRouteScores = 0;
      for (const row of db.prepare("SELECT model_id FROM models WHERE provider IN ('OpenCode Zen', 'OpenCode Go')").all()) {
        const id = row.model_id.split('/').at(-1).replace(/-free$/, '');
        const source = routeScores.get(normalizeOpenCodeName(id));
        if (!source) continue;
        copiedRouteScores += copyRouteScores.run({ ...source, model_id: row.model_id }).changes;
      }
      stats.opencodeRouteScores = copiedRouteScores;

      // Not every route has a published benchmark. Give those models a useful
      // starting profile without representing it as a test result: first use
      // the closest benchmarked family, then fall back to the catalog median.
      // These values are deliberately kept separate from measured profiles.
      const profileColumns = ['score_coding', 'score_thinking', 'score_maths', 'score_overall'];
      const numericMedian = (values) => {
        const xs = values.filter((value) => value != null).map(Number).sort((a, b) => a - b);
        if (!xs.length) return null;
        const middle = Math.floor(xs.length / 2);
        return xs.length % 2 ? xs[middle] : (xs[middle - 1] + xs[middle]) / 2;
      };
      const roundScore = (value) => value == null ? null : Math.max(1, Math.min(99, Math.round(value)));
      const profileTokens = (value) => (value || '').toLowerCase()
        .replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2')
        .split(/[^a-z0-9]+/).filter((token) => token.length > 1 || /^\d+$/.test(token))
        .filter((token) => !['free', 'preview', 'latest', 'contributor', 'turbo', 'instruct', 'chat', 'thinking', 'reasoning', 'model'].includes(token));
      const families = new Set(['gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'kimi', 'glm', 'minimax', 'mistral', 'llama', 'gemma', 'grok', 'longcat', 'nemotron', 'mimo', 'step', 'phi']);
      const measuredProfiles = db.prepare(`SELECT provider, model_id, name, reasoning, price_output,
        score_coding, score_thinking, score_maths, score_overall
        FROM models WHERE score_kind = 'measured' AND score_overall IS NOT NULL`).all();
      const medians = Object.fromEntries(profileColumns.map((column) => [column, numericMedian(measuredProfiles.map((profile) => profile[column]))]));
      const familyIndex = new Map();
      for (const profile of measuredProfiles) {
        const tokens = new Set([...profileTokens(profile.name), ...profileTokens(profile.model_id)]);
        for (const token of tokens) {
          if (!families.has(token)) continue;
          if (!familyIndex.has(token)) familyIndex.set(token, []);
          familyIndex.get(token).push({ ...profile, tokens });
        }
      }
      const updateEstimate = db.prepare(`UPDATE models SET
        score_coding = @score_coding, score_thinking = @score_thinking,
        score_maths = @score_maths, score_overall = @score_overall,
        score_sources = @score_sources, score_kind = @score_kind, score_confidence = @score_confidence
        WHERE model_id = @model_id`);
      let estimatedProfiles = 0;
      for (const row of db.prepare(`SELECT provider, model_id, name, reasoning, price_output
        FROM models WHERE score_kind IS NULL OR score_kind = ''`).all()) {
        const tokens = new Set([...profileTokens(row.name), ...profileTokens(row.model_id)]);
        const candidates = [...tokens].filter((token) => families.has(token)).flatMap((token) => familyIndex.get(token) || []);
        const seen = new Set();
        const ranked = candidates.filter((candidate) => {
          if (seen.has(candidate.model_id)) return false;
          seen.add(candidate.model_id);
          return true;
        }).map((candidate) => {
          let similarity = 0;
          for (const token of tokens) {
            if (!candidate.tokens.has(token)) continue;
            similarity += /^\d+$/.test(token) ? 1 : families.has(token) ? 6 : 3;
          }
          return { candidate, similarity };
        }).sort((a, b) => b.similarity - a.similarity);
        const closest = ranked[0];
        const isComparable = Boolean(closest && closest.similarity >= 6);
        const source = isComparable ? closest.candidate : null;
        const profile = {};
        // Sparse benchmark coverage can make a category-wide median misleading
        // (for example, maths has fewer published results). When a comparable
        // model lacks a category, use its overall profile; for a baseline use
        // the evaluated-catalog overall median consistently across categories.
        for (const column of profileColumns) profile[column] = roundScore(source?.[column] ?? source?.score_overall ?? medians.score_overall);
        // A reasoning route is usually a more capable variant than the generic
        // family default. Keep the adjustment small to avoid false precision.
        if (!source && row.reasoning) {
          profile.score_thinking = roundScore((profile.score_thinking ?? 0) + 2);
          profile.score_overall = roundScore((profile.score_overall ?? 0) + 1);
        }
        updateEstimate.run({
          model_id: row.model_id,
          ...profile,
          score_sources: source
            ? `Estimated from comparable evaluated model: ${source.name} (${source.provider})`
            : 'Preliminary estimate from the evaluated catalog median',
          score_kind: source ? 'estimated' : 'baseline',
          score_confidence: source ? 'medium' : 'low',
        });
        estimatedProfiles++;
      }
      stats.estimatedProfiles = estimatedProfiles;
      if (allbench) {
        console.log(`benchmarks: ALL-Bench matched ${abMatched}/${specRows.length} rows`);
        stats.abMatched = abMatched;
      }

      // 4. sync metadata (lane inventory lives here, not as priceless rows).
      const meta = db.prepare(
        "INSERT INTO sync_meta (key, value, updated) VALUES (@key, @value, datetime('now')) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = datetime(\'now\')'
      );
      meta.run({ key: 'last_sync', value: new Date().toISOString() });
      meta.run({ key: 'stats', value: JSON.stringify(stats) });
      if (lanes) meta.run({ key: 'opencode_lanes', value: JSON.stringify(lanes) });
      if (vultrAccount) meta.run({ key: 'vultr_account_models', value: JSON.stringify(vultrAccount) });
    });
    tx();

    const total = db.prepare('SELECT COUNT(*) AS n FROM models').get().n;
    console.log(`sync done: ${stats.refreshed} refreshed, ${stats.inserted} new, ${total} total rows.`);
    if (stats.skippedProviders.length) {
      console.log(`providers without a pricing API (left untouched): ${stats.skippedProviders.join(', ')}`);
    }
    db.close();
  })();
}

main().catch((err) => {
  console.error(`sync FAILED: ${err.message}`);
  process.exit(1);
});
