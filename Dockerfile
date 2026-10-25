# syntax=docker/dockerfile:1
# Single image: NestJS API + built React SPA served by Nest (ServeStaticModule).

# ---- deps: install the whole npm workspace from the lockfile -------------------------------
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# The e2e workspace is in the lockfile; npm ci needs its manifest (Playwright browsers are not downloaded).
COPY e2e/package.json e2e/
RUN npm ci

# ---- build: web (vite) and server (prisma generate + nest build) ----------------------------
FROM deps AS build
COPY apps/web apps/web
COPY apps/server apps/server
RUN npm run build -w apps/web \
  && npm run build -w apps/server

# ---- runtime ----------------------------------------------------------------------------------
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PORT=3000 \
    WEB_DIST=/app/apps/web/dist
# node_modules keeps dev deps on purpose: prisma CLI (migrate deploy) and ts-node (seed) run at start.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/server/package.json /app/apps/server/tsconfig.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/server/scripts ./apps/server/scripts
# seed.ts imports the judge rules from src/
COPY --from=build /app/apps/server/src ./apps/server/src
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_ON_START\" = \"true\" ]; then node scripts/seed-if-empty.js; fi && exec node dist/main.js"]
