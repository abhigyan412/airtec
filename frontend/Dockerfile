# ── AIRTEC frontend (Next.js 14, standalone output) ─────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined into the bundle at build time, so the
# API URL must be supplied as a build arg — NOT a runtime env var.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# The /api rewrite target is baked at build time too (Next evaluates
# rewrites() during `next build`), so BACKEND_URL is a build arg. It
# points at the internal backend service on the Docker network.
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1
# `public/` may not exist in this repo; ensure it does so the COPY below never fails.
RUN mkdir -p public && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
# Same reasoning as backend/Dockerfile: Next.js server-renders on first
# load even for 'use client' components, so any Date() read before
# hydration hits the container's clock — UTC by default, not IST.
RUN apk add --no-cache tzdata
ENV TZ=Asia/Kolkata
RUN apk add --no-cache wget && addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# Probe /auth/login: it returns 200 directly. "/" returns a 307 redirect,
# which wget exits non-zero on (exit 8) → false "unhealthy".
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/auth/login || exit 1
CMD ["node", "server.js"]
