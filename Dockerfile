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
EXPOSE 3000
CMD ["sh", "-c", "npm run sync || true; exec npm start"]
