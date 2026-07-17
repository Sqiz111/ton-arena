# ── deps ──────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# ── build ─────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy env so config validation passes at build time (real values come at runtime)
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV JWT_SECRET=build-time-placeholder-secret-32chars!
ENV ADMIN_JWT_SECRET=build-time-placeholder-secret-32chars
RUN npx next build && npx tsc -p tsconfig.server.json && npx tsc-alias -p tsconfig.server.json

# ── runtime ───────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY package.json next.config.ts ./
# Next's custom server requires the source app dir to exist even in prod,
# and next.config.ts imports the i18n request config from src/.
COPY --from=build /app/src ./src

USER app
EXPOSE 3000
# Apply migrations, seed idempotent baseline data (config/achievements/admin),
# then boot the custom server. A seed hiccup must not block boot.
CMD ["sh", "-c", "npx prisma migrate deploy && (npx tsx prisma/seed.ts || echo 'seed failed, continuing') && node dist/server/index.js"]
