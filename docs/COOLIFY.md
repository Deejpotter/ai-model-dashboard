# Coolify Deployment — AI Model Dashboard

This app is a Next.js 16 project with `better-sqlite3` (SQLite). It runs on port **3000** via `npm start`.

## Repo preparation

`docker/build` files are at the repo root:

- `Dockerfile` — multi-stage-ready production image
- `.dockerignore` — excludes `node_modules` and local git files

## Option 1: Native Next.js service (no Dockerfile)

In Coolify, create a new **Resource → Service** and choose **Next.js** as the framework.

| Setting | Value |
|---|---|
| Buildpack / Framework | `Next.js` |
| Port | `3000` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Node version | `20+` |

The platform handles image building and container runtime automatically.

## Option 2: Custom Dockerfile

Point Coolify at this repo and select **Dockerfile** as the build method:

| Setting | Value |
|---|---|
| Repository | `git@github.com:Deejpotter/ai-model-dashboard.git` |
| Build method | `Dockerfile` |
| Dockerfile path | `/Dockerfile` |
| Port | `3000` |

## Environment variables

Add these under **Environment Variables** in Coolify:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

## SQLite persistence

The database lives at `data/models.db` inside the container. For persistent data across redeploys:

- Mount a Coolify **volume** at `/app/data`, **or**
- Set an env var if your code reads `DB_PATH` from the environment (check `src/db/init.js`).

Without a volume, the DB resets on every redeploy.

## Deployment checklist

1. Push this commit (`Dockerfile`, `.dockerignore`, `docs/COOLIFY.md`).
2. In Coolify, add a new resource pointing at `git@github.com:Deejpotter/ai-model-dashboard.git`.
3. Choose **Dockerfile** build method (or Next.js service).
4. Set port `3000` and env vars above.
5. Add a volume for `/app/data` if you want SQLite persistence.
6. Deploy.

## Local build test

```bash
docker build -t ai-model-dashboard .
docker run -p 3000:3000 ai-model-dashboard
# open http://localhost:3000
```
