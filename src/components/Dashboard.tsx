'use client';

import { useEffect, useMemo, useState } from 'react';

type Model = {
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
  score_coding: number | null;
  score_thinking: number | null;
  score_maths: number | null;
  score_overall: number | null;
  score_sources: string | null;
  is_favourite: number;
  notes: string | null;
  source_url: string | null;
};

const benchmarkKeys = [
  ['score_overall', 'Overall'],
  ['score_coding', 'Coding'],
  ['score_thinking', 'Thinking'],
  ['score_maths', 'Maths'],
] as const;

function money(value: number | null | undefined) {
  if (value == null) return '—';
  return `$${value.toFixed(2)}`;
}

function ctx(value: number | null | undefined) {
  if (!value) return '—';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  return `${Math.round(value / 1000)}K`;
}

export default function Dashboard() {
  const [models, setModels] = useState<Model[]>([]);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [sort, setSort] = useState('price_output');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [tab, setTab] = useState<'catalog' | 'projections' | 'compare'>('catalog');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [inputTokens, setInputTokens] = useState(5000000);
  const [outputTokens, setOutputTokens] = useState(1000000);
  const [cacheHitRate, setCacheHitRate] = useState(30);

  async function loadModels() {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (provider) qs.set('provider', provider);
    if (favouritesOnly) qs.set('favourites', '1');
    qs.set('sort', sort);
    qs.set('dir', dir);
    const res = await fetch(`/api/models?${qs.toString()}`);
    const data = await res.json();
    setModels(data);
  }

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, provider, favouritesOnly, sort, dir]);

  async function toggleFavourite(id: number) {
    await fetch(`/api/models/${id}/favourite`, { method: 'PATCH' });
    await loadModels();
  }

  const providers = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models]);

  const selectedModels = useMemo(() => models.filter((m) => selectedIds.includes(m.id)), [models, selectedIds]);

  const projections = useMemo(() => {
    return [...models].map((m) => {
      const inCost = ((inputTokens * (1 - cacheHitRate / 100)) / 1_000_000) * (m.price_input ?? 0);
      const cacheCost = ((inputTokens * (cacheHitRate / 100)) / 1_000_000) * (m.price_cache_read ?? 0);
      const outCost = (outputTokens / 1_000_000) * (m.price_output ?? 0);
      return { ...m, monthlyCost: inCost + cacheCost + outCost };
    }).sort((a, b) => a.monthlyCost - b.monthlyCost);
  }, [models, inputTokens, outputTokens, cacheHitRate]);

  const topProjection = projections[0];

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <div>
          <h1>AI Model Dashboard</h1>
          <p>Track pricing, benchmarks, favourites, and cost projections across your current model stack.</p>
        </div>
        <div className="hero-stats">
          <div><strong>{models.length}</strong><span>Models</span></div>
          <div><strong>{models.filter((m) => m.is_favourite).length}</strong><span>Favourites</span></div>
          <div><strong>{topProjection ? money(topProjection.monthlyCost) : '—'}</strong><span>Cheapest projected</span></div>
        </div>
      </section>

      <section className="tabs">
        {['catalog', 'projections', 'compare'].map((name) => (
          <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name as typeof tab)}>
            {name}
          </button>
        ))}
      </section>

      {tab === 'catalog' && (
        <>
          <section className="filters card">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, provider, notes..." />
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label className="checkbox"><input type="checkbox" checked={favouritesOnly} onChange={(e) => setFavouritesOnly(e.target.checked)} /> Favourites only</label>
          </section>

          <section className="card table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fav</th>
                    <th onClick={() => { setSort('name'); setDir(sort === 'name' && dir === 'asc' ? 'desc' : 'asc'); }}>Model</th>
                    <th onClick={() => { setSort('provider'); setDir(sort === 'provider' && dir === 'asc' ? 'desc' : 'asc'); }}>Provider</th>
                    <th onClick={() => { setSort('price_input'); setDir(sort === 'price_input' && dir === 'asc' ? 'desc' : 'asc'); }}>In</th>
                    <th onClick={() => { setSort('price_output'); setDir(sort === 'price_output' && dir === 'asc' ? 'desc' : 'asc'); }}>Out</th>
                    <th>Ctx</th>
                    <th>Modes</th>
                    <th>Coding</th>
                    <th>Thinking</th>
                    <th>Maths</th>
                    <th>Overall</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.id}>
                      <td><button className="star" onClick={() => toggleFavourite(m.id)}>{m.is_favourite ? '★' : '☆'}</button></td>
                      <td>
                        <div className="model-name">{m.name}</div>
                        <div className="subtle">{m.model_id}</div>
                      </td>
                      <td>{m.provider}</td>
                      <td>{money(m.price_input)}</td>
                      <td>{money(m.price_output)}</td>
                      <td>{ctx(m.context_window)}</td>
                      <td>{m.multimodal ?? 'text'}</td>
                      <td>{m.score_coding ?? '—'}</td>
                      <td>{m.score_thinking ?? '—'}</td>
                      <td>{m.score_maths ?? '—'}</td>
                      <td>{m.score_overall ?? '—'}</td>
                      <td className="notes">{m.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === 'projections' && (
        <section className="projection-grid">
          <div className="card controls">
            <h2>Cost projection</h2>
            <label>Input tokens / month
              <input type="number" value={inputTokens} onChange={(e) => setInputTokens(Number(e.target.value))} />
            </label>
            <label>Output tokens / month
              <input type="number" value={outputTokens} onChange={(e) => setOutputTokens(Number(e.target.value))} />
            </label>
            <label>Cache hit rate: {cacheHitRate}%
              <input type="range" min={0} max={90} value={cacheHitRate} onChange={(e) => setCacheHitRate(Number(e.target.value))} />
            </label>
            <div className="preset-row">
              <button onClick={() => { setInputTokens(500000); setOutputTokens(100000); }}>Light</button>
              <button onClick={() => { setInputTokens(5000000); setOutputTokens(1000000); }}>Moderate</button>
              <button onClick={() => { setInputTokens(50000000); setOutputTokens(10000000); }}>Heavy</button>
            </div>
          </div>
          <div className="card">
            <h2>Projected monthly cost</h2>
            <div className="projection-list">
              {projections.map((m) => (
                <div key={m.id} className="projection-row">
                  <div>
                    <div className="model-name">{m.name}</div>
                    <div className="subtle">{m.provider}</div>
                  </div>
                  <strong>{money(m.monthlyCost)}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'compare' && (
        <section className="card compare-card">
          <h2>Benchmark comparison</h2>
          <p className="subtle">Pick up to 4 models to compare benchmark coverage side-by-side.</p>
          <div className="compare-picker">
            <select onChange={(e) => {
              const id = Number(e.target.value);
              if (!id || selectedIds.includes(id) || selectedIds.length >= 4) return;
              setSelectedIds([...selectedIds, id]);
              e.currentTarget.value = '';
            }} defaultValue="">
              <option value="">Add a model…</option>
              {models.filter((m) => !selectedIds.includes(m.id)).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="selected-tags">
              {selectedModels.map((m) => (
                <button key={m.id} className="tag" onClick={() => setSelectedIds(selectedIds.filter((id) => id !== m.id))}>{m.name} ×</button>
              ))}
            </div>
          </div>
          {selectedModels.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    {selectedModels.map((m) => <th key={m.id}>{m.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {benchmarkKeys.map(([key, label]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      {selectedModels.map((m) => <td key={m.id}>{(m as unknown as Record<string, number | null>)[key] ?? '—'}</td>)}
                    </tr>
                  ))}
                  <tr>
                    <td>Input $/1M</td>
                    {selectedModels.map((m) => <td key={m.id}>{money(m.price_input)}</td>)}
                  </tr>
                  <tr>
                    <td>Output $/1M</td>
                    {selectedModels.map((m) => <td key={m.id}>{money(m.price_output)}</td>)}
                  </tr>
                  <tr>
                    <td>Context</td>
                    {selectedModels.map((m) => <td key={m.id}>{ctx(m.context_window)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">No models selected yet.</div>}
        </section>
      )}
    </main>
  );
}
