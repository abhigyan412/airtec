# ── AIRTEC backend (Express + TypeScript, run via tsx) ──────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# tsx (the runtime) lives in dependencies, so --omit=dev is safe:
# only typescript/vitest/@types are dropped, none needed at runtime.
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# wget is used by the container HEALTHCHECK / Dokploy health probe.
RUN apk add --no-cache wget
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["npm", "run", "start"]
