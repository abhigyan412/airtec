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
# Every date/time computation in this app (attendance %, "is this a
# working day", "is this period happening right now", fee due dates, …)
# calls new Date() and reads it back with local getters (getDay(),
# toTimeString(), getFullYear()/getMonth()/getDate()), on the assumption
# that "local" means IST — true on a dev machine, false by default in
# any container, which is UTC unless told otherwise. That's a fixed
# 5:30 offset from real IST, silently wrong for ~all of the school day.
# tzdata is required on Alpine for a named TZ (not just UTC offsets) to
# actually resolve.
RUN apk add --no-cache tzdata
ENV TZ=Asia/Kolkata
# wget is used by the container HEALTHCHECK / Dokploy health probe.
RUN apk add --no-cache wget
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["npm", "run", "start"]
