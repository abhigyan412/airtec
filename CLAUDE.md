# AIRTEC — working notes

School ERP. Node + Express + TypeScript backend on Supabase (Postgres), two
Next.js 14 apps: `frontend` (staff) and `frontend-portal` (parents/students).

## Layout

```
backend/            Express API. Modules under src/modules/<domain>/,
                    shared helpers under src/shared/utils/.
frontend/           Staff admin app (port 3000).
frontend-portal/    Family portal — a separate app with its own login and
                    domain, not a route group inside the staff app (port 3001).
supabase/migrations/  Timestamp-named SQL, applied in filename order.
docker-compose.yml  The deployment definition. See below.
design.md           Long-form design notes and open questions per phase.
```

## Commands

```bash
# backend
cd backend && npm run dev          # tsx watch
npm test                           # vitest run
npm run test:coverage
npm run seed                       # seed demo data (--reset to wipe first)

# apps
cd frontend && npm run dev         # or frontend-portal, which pins -p 3001
npm run lint
```

There is no build step for the backend — `npm start` runs `tsx src/index.ts`
directly, and `npm run build` is deliberately a no-op echo.

## Deployment — Dokploy / Docker Compose

`docker-compose.yml` is the **only** deployment definition. There is no Render,
Railway, or Vercel config; if you find a reference to one, it is stale.

Three services. Both web apps proxy `/api/*` to `backend` over the internal
Docker network, so the backend has no public domain and there is no CORS to
configure. In Dokploy: one Compose application, variables in the Environment
tab, and a domain assigned to each web app pointing at its container port
(staff → `frontend`:3000, family → `portal`:3001). Host port bindings are
loopback-only and default to 3010/3011/4010 to avoid collisions on a shared
host; the public domain is routed to the container port, so it is unaffected.

### Adding an environment variable takes two edits

Compose passes into a container only what that service's `environment:` block
names. Setting a variable in Dokploy's Environment tab is **not** enough — if
`docker-compose.yml` doesn't name it, it reaches the process as `undefined`.

This has bitten production. `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` were
set in Dokploy but absent from the backend's `environment:` block, so native
push was dead for two days while the app reported push as working — the
delivery rows were stamped `sent` because the user's *browser* subscription was
reached, and the OneSignal error was discarded. `PAYMENT_PROVIDER` had the same
gap, and `activeProvider()` throws in production when it is unset.

So: add every new variable to the `environment:` block **and** to
`.env.example`. Build-time values (`NEXT_PUBLIC_*`, `BACKEND_URL`) go in
`build.args` instead and need a rebuild, not a restart, to take effect.

### Crons need a container that stays up

Every scheduled job is in-process (`cron.schedule` in `backend/src/index.ts`):
the delivery outbox every minute, fee reminders at 07:00 IST, HR alerts and the
timetable sweeps at 08:00, plus hourly gateway/admission reapers. The backend
runs `restart: unless-stopped` so they keep their schedule. A host that sleeps
when idle silently breaks all of them —
`POST /api/notifications/run-deliveries` and `run-fee-reminders` are the
authenticated fallbacks if that ever happens again.

## Things that are easy to get wrong

**Timezone.** `TZ=Asia/Kolkata` is pinned in Compose and again at process start
in `shared/utils/timezone.ts`, imported before anything reads a date. A
container defaults to UTC, 5.5 hours behind the school, which files an evening
collection on 31 March into the wrong financial year. Date bounds carry an
explicit offset for the same reason — a naive `${date}T00:00:00` resolves in the
*database's* zone, not the process's.

**Push has two transports, one outbox.** Browsers get Web Push (VAPID); phones
running the Median wrapper have no Web Push API at all and get OneSignal
(APNs/FCM) addressed by subscription id. `shared/utils/delivery.ts` fans out to
both and marks a delivery `sent` if *either* reached a device — so a `sent` row
does not mean every device was reached. To check push health, read
`GET /api/notifications/push/subscriptions`, which reports `providers.webpush` /
`providers.onesignal` and each device's `last_used_at`; a device whose
`last_used_at` never moves past its `created_at` has never been delivered to.
OneSignal deep links use `targetUrl` in the data payload, never OneSignal's
`url` field — `url` is the Launch URL and opens an external browser, outside the
app and signed out.

**Notification dedupe swallows re-sends.** `writeNotifications` upserts with
`ignoreDuplicates` on `(user_id, type, related_entity_id, notification_date)`
when a notification is tied to an entity, and only enqueues delivery for rows
the insert actually returned. A deduped notification therefore sends no push,
by design. `.select()` on that upsert is load-bearing.

**Notification preferences are opt-out.** A row in `notification_preferences`
means *muted*. Absence means enabled, which is why a new notification type
needs no backfill to start reaching people.

**Payments default to nothing, on purpose.** `PAYMENT_PROVIDER` must be stated
out loud in production; `activeProvider()` throws rather than falling back to
`mock`, because the simulator's job is to mark orders paid. Gateway routes also
refuse to serve without `PAYMENT_WEBHOOK_SECRET`.
