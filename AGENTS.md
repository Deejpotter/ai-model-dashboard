# ai-model-dashboard - agent guide

Next.js + SQLite dashboard for comparing AI model pricing and benchmarks.
Live at `ai.deejpotter.com` on Coolify.

## Commands

```powershell
npm run dev      # local dev
npm run build    # production build
npm run lint     # lint gate
npm run test     # tests (if present)
npm run sync     # sync models and benchmarks
```

## Rules

- Keep the schema in `src/db/schema.sql` in step with any query change.
- The Docker runtime image must copy `src/` and `scripts/`; both are read at
  runtime. Do not trim them from the Dockerfile.
- Price and context values come from the live catalog. Do not hard-code them.
- Manual gate before merge: lint 0 errors, tests passing, build clean.

Global rules: `C:\Users\Deej\AGENTS.md`, generated from
`C:\Users\Deej\.agents\AGENTS.md`.
