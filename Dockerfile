FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --legacy-peer-deps

FROM deps AS app
COPY . .
RUN npx tsc --noEmit --skipLibCheck --noEmitOnError false
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=app /app/node_modules ./node_modules
COPY --from=app /app/.next ./.next
COPY --from=app /app/public ./public
COPY --from=app /app/package*.json ./
# The app reads src/db/schema.sql at runtime (see src/lib/db.ts) and runs the
# sync scripts at start-up, so both directories must exist in the final image.
COPY --from=app /app/src ./src
COPY --from=app /app/scripts ./scripts
EXPOSE 3000
# busybox wget ships with alpine, so this needs no extra packages.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "npm run sync || true; exec npm start"]
