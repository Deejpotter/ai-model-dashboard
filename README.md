# AI Model Dashboard

Next.js + SQLite dashboard for comparing AI model pricing and benchmarks.

## Features
- searchable model catalog
- filter by provider
- favourites toggle stored in SQLite
- monthly cost projections
- benchmark comparison view

## Run
```bash
npm install
npm run seed
npm run dev
```

Then open: http://localhost:3000

## Production check
```bash
npm run build
npm start
```

## Database
SQLite DB path:
- `data/models.db`

Schema source:
- `src/db/schema.sql`

Seed data source:
- `src/lib/seed-data.js`

## Notes
- If the database already contains rows, `npm run seed` will not duplicate them.
- Favourites are persisted in the `models` table via `is_favourite`.

## Live price sync

`npm run sync` refreshes pricing/context from live APIs (no keys needed):

1. **models.dev catalog** - per-provider prices, context windows, modalities
2. **OpenRouter /models** - live OpenRouter prices (adds new rows as models launch)
3. **`opencode models`** - tags rows with your configured lanes in `available_via`
   (e.g. `openrouter,zen,go`); full lane inventory goes to the `sync_meta` table

Only pricing/context/availability columns change. Benchmarks, notes, and
favourites are never overwritten. Rows not seen in any source keep their old
`last_seen` timestamp, so stale entries are identifiable. Providers with no
public pricing API (e.g. GitHub Copilot) are left untouched.

Automated weekly via Windows Task Scheduler (`AI-Model-Dashboard-Sync`, Sundays 09:00).

## Score categories

The catalog shows general scores instead of individual benchmark names:

- **Coding** - mean of SWE-bench Verified, LiveCodeBench, ALL-Bench SWE-Pro / LiveCodeBench
- **Thinking** - mean of GPQA Diamond, Humanity's Last Exam (+ ALL-Bench equivalents)
- **Maths** - mean of AIME 2026 (+ ALL-Bench AIME)

A category is the mean of whichever inputs exist (0-100 scale, 1 decimal).
`score_sources` on each row lists the contributing inputs. Specific benchmark
columns still exist in the DB; deliberately different tests are never conflated
(e.g. SWE-bench Pro never overwrites SWE-bench Verified, AIME 2025 never
overwrites AIME 2026) - they only meet in the general category mean.
