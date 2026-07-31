# Notification System — Production Design

Scope: `frontend/` (staff admin) and `frontend-portal/` (parent/student family app),
plus the backend surface required to support them.

Status: proposal. Nothing in §§3–7 is implemented. Two of the three defects in
§1 have since been fixed on `main` (`dd08890`) — see below.

---

## 1. Where we are today

The current system is in-app only — a database row plus a polling bell. It works,
but a notification only exists while the user has the tab open.

**What exists**

| Piece | Location |
|---|---|
| `notifications` table | `supabase/migrations/20260724000000_notifications.sql` |
| Write API (`createNotification`, `createNotifications`) | `backend/src/shared/utils/notifications.ts` |
| Read API (list, unread-count, mark-read, read-all) | `backend/src/modules/notifications/routes.ts` |
| Bell UI (duplicated in both apps) | `*/components/layout/NotificationBell.tsx` |
| Service worker (offline caching only) | `*/public/sw.js` |
| PWA manifest | `*/app/manifest.ts` |

Seven trigger sites call the write API: attendance-absent (`sis/routes.ts:421`),
TC decision (`sis/routes.ts:1068`), homework posted (`academics/routes.ts:161`),
fee-discount decision (`fee/routes.ts:741`), exam results published
(`exam/routes.ts:347`), leave decision (`hrms/routes.ts:469`), and the fee
due/overdue sweep (`shared/utils/feeReminders.ts:54`).

**What's good and should be preserved**

- `notifications.ts` is deliberately provider-agnostic. Its header comment
  reserves `createNotification()` / `createNotifications()` as the extension
  point so new channels don't touch the ~10 call sites. This design uses exactly
  that seam.
- The unique index `(user_id, type, related_entity_id, notification_date)` gives
  per-day idempotency. This already makes multi-instance cron safe — duplicate
  ticks collapse into one row instead of double-notifying.
- Trigger sites are best-effort (`try`/`catch` → `console.error`), so a
  notification failure never 500s the teacher who just saved attendance.
- Both service workers are already registered in production. The browser-side
  prerequisite for push is satisfied.

**Known defects — 1 and 2 are now fixed, 3 is open**

1. ~~**Every family-facing link 404s.**~~ **Fixed in `dd08890`.** Links were
   stored as `/portal/fees`, `/portal/homework`, `/portal/attendance`,
   `/portal/exams`, `/portal`. After the parent/student split (`af3d954`) the
   family app's routes live under `frontend-portal/app/(portal)/…`, and
   `(portal)` is a Next.js *route group* — not a URL segment — so the real URLs
   are `/fees`, `/homework`, `/attendance`, `/exams`, `/`. All six now point at
   the right paths (verified: `/portal/fees` → 404, `/fees` → 200), and the 248
   rows already in the demo database were rewritten. `hrms`'s `/hr/my-leave` was
   always correct.
2. ~~**Seed writes phantom types.**~~ **Fixed in `dd08890`.** The seed wrote
   `fee_due`, `exam_scheduled`, `exam_result`, `complaint_update`,
   `leave_status`, `announcement` — none in the `NotificationType` union, and the
   column is plain `text` with no CHECK, so they inserted silently. `seed.ts` now
   imports the union, so `tsc` rejects an invented value. The same block was also
   picking type/title/message/link from *parallel arrays by index*, producing rows
   like a `fee_due` notification titled "Attendance alert" linking to
   `/hr/my-leave`; templates now travel as units and are chosen by recipient role.
3. **The daily cron likely never fires in production — still open, and this is
   the one that blocks everything else.** `render.yaml:6` uses Render's
   `plan: free`, which spins the service down when idle; `cron.schedule('0 7 * * *')`
   at `index.ts:113` is in-process, so a sleeping service has no process to run
   it. The code comment anticipates this and offers
   `POST /notifications/run-fee-reminders` as a manual fallback. Worth confirming
   whether fee reminders have *ever* run unattended.

   Promoted out of this list into Phase 1 (§8): the delivery worker in §5.2 is
   scheduled exactly the same way, so it inherits the defect wholesale. Building
   push on top of a scheduler that doesn't fire just moves the silence.

---

## 2. Goals

1. A notification reaches the user **with the app closed** — the single biggest
   gap today.
2. Users control what they receive. A parent who wants fee alerts but not every
   homework post can say so.
3. Delivery is observable and retryable. A failed send is visible and gets
   another attempt, not just a `console.error`.
4. Both apps stay independently deployable, on separate domains, as the split
   established.
5. **No new infrastructure.** No Redis, no queue broker, no extra service. See §7.

**Non-goals for v1:** cross-user messaging/chat, notification digests/batching,
in-app toasts for real-time events, staff-authored broadcast announcements. All
are reasonable follow-ons; none are needed to close the "app is closed" gap.

---

## 3. Architecture

Three layers, cleanly separated:

```
  trigger sites (unchanged)
        │
        ▼
  createNotification()  ──── writes notifications row (in-app, unchanged)
        │
        ├──► preference check  (does this user want this type on this channel?)
        │
        └──► delivery fan-out ──► notification_deliveries rows (status: pending)
                                          │
                                          ▼
                                  delivery worker
                                    ├─ web push  (web-push → browser push service)
                                    └─ email     (provider REST API)
```

**Channels for v1:** in-app (exists) + **web push** + email.

Web push is the priority — it's free, needs no vendor account, and both apps
already register service workers. Email is a near-zero-cost addition once the
delivery table and worker exist.

**Deliberately deferred: SMS/WhatsApp.** For an Indian school, WhatsApp is
realistically the highest-reach channel for parents, and it's the honest answer
to the iOS limitation below. But it needs a Business API account, template
approval, and per-message cost. Design the `channel` enum to accommodate it;
don't build it in v1.

### The iOS problem — decide this before building

Safari only delivers web push to sites the user has **explicitly added to their
home screen**. There is no way around this and no prompt that does it for the
user. For a parent-facing app on iPhone, that's a hard adoption ceiling: parents
who don't complete an unfamiliar multi-step gesture receive nothing.

Consequences for the design:

- The family app needs a real "install this app" onboarding flow, not just a
  manifest. Detect iOS Safari, show the Share → Add to Home Screen instruction
  with a screenshot, and don't nag after dismissal.
- Push alone must not be the only channel for anything genuinely important.
  Fee-overdue in particular should go out over email in v1 and WhatsApp later.
- Instrument install-rate and push opt-in per platform from day one. If iOS
  opt-in lands under ~30%, that is the signal to prioritise WhatsApp over
  polishing push.

### Transport for in-app freshness

The bell polls `unread-count` every 60s (`NotificationBell.tsx:30`). **Keep
polling.** Add `refetchOnWindowFocus` so returning to the tab is instant, and let
push cover the closed-app case. That combination removes the perceived latency
without a persistent connection.

Two alternatives, both rejected for v1:

- **Supabase Realtime — do not use here.** RLS is intentionally OFF on
  `notifications` (the migration explains why: baseline tables had RLS enabled
  with zero policies, silently blocking everything). Realtime enforces RLS. Both
  frontends hold a Supabase `access_token`, so a client subscribing directly to
  this table with RLS off would receive **every user's notifications**. Adopting
  Realtime means first writing correct RLS policies for this table — a
  meaningful change to the schema's established convention, not a quick win.
- **SSE from Express** (`GET /notifications/stream`) is secure and reuses the
  existing `authenticate` middleware, but holds one long-lived connection per
  active user. On a free-tier single instance that's a real cost for a modest
  gain over 60s polling. Revisit in phase 4 if users ask.

---

## 4. Data model

Three new tables. All follow the existing convention: **RLS off, authorization
enforced in Express** — consistent with the notifications migration and its
stated rationale.

```sql
-- One row per browser/device. A user with a laptop and a phone has two.
CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    -- 'staff' | 'family' — the two apps are separate origins, so a user's
    -- subscription is per-app. Lets us target the right one and debug by app.
    app text NOT NULL CHECK (app IN ('staff','family')),
    endpoint text NOT NULL UNIQUE,   -- push service URL; natural dedupe key
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    -- Set when the push service returns 404/410. Kept rather than deleted so
    -- we can distinguish "never subscribed" from "subscription expired".
    failed_at timestamptz
);
CREATE INDEX idx_push_subs_user ON public.push_subscriptions (user_id) WHERE failed_at IS NULL;

-- Opt-outs only: a row means "this user has muted this type on this channel".
-- Absence means enabled, so new notification types roll out on-by-default with
-- no per-user backfill.
--
-- No `enabled` column on purpose. An earlier draft had `enabled boolean NOT NULL
-- DEFAULT true`, which contradicts the opt-out model — the default row would be a
-- no-op and only `false` rows would carry meaning, leaving two ways to express
-- "enabled" (no row, or a row saying true) for the delivery check to disagree
-- about. Presence is the whole signal.
CREATE TABLE public.notification_preferences (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type text NOT NULL,              -- matches NotificationType
    channel text NOT NULL CHECK (channel IN ('in_app','push','email')),
    muted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, type, channel)
);

-- The outbox. Makes delivery observable and retryable without a queue broker.
CREATE TABLE public.notification_deliveries (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('push','email')),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sent','failed','skipped')),
    attempts int NOT NULL DEFAULT 0,
    last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Drives the worker's claim query.
CREATE INDEX idx_deliveries_pending
    ON public.notification_deliveries (next_attempt_at)
    WHERE status = 'pending';
```

Also, on the existing table:

```sql
-- Constrain the type column to the real union, and fix the seed (seed.ts:1241)
-- which currently writes six types the app never produces.
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'attendance_absent','leave_approved','leave_rejected',
        'tc_approved','tc_rejected','discount_approved','discount_rejected',
        'homework_assigned','exam_result_published','fee_due_soon','fee_overdue'
    ]));
```

Add the CHECK **after** correcting the seed, or re-seeding breaks. This is the
same class of bug the notifications migration itself fixed for `exams.status`,
where a too-narrow CHECK silently rejected every write for months.

---

## 5. Backend changes

### 5.1 Delivery fan-out inside the existing seam

`createNotification()` keeps its current signature and its dedupe behaviour. It
gains one step after the insert: consult preferences, write `pending` delivery
rows. It must **not** call any provider inline — the request path stays fast, and
the ~10 trigger sites stay untouched.

```ts
// backend/src/shared/utils/notifications.ts
export async function createNotification(params: CreateNotificationParams) {
  const { data } = await supabase
    .from('notifications')
    .upsert(row, { onConflict: 'user_id,type,related_entity_id,notification_date',
                   ignoreDuplicates: true })
    .select()                       // ← REQUIRED, see below
  if (!data?.length) return         // deduped — no re-send
  await enqueueDeliveries(data[0])  // new
}
```

**Two traps in that guard, both of which fail silently.**

The current implementation ends at `.upsert(...)` / `.insert(...)` with no
`.select()`. supabase-js returns `data: null` when you don't ask for a
representation — so a naive `const { data: row } = await insert(...)`, `if (!row)
return` is null on *every* call, deduped or not, and `enqueueDeliveries` never
runs. Push and email would be dead while in-app notifications kept working
perfectly: no error, nothing in the logs. Adding `.select()` is not optional here.

Second: with `ignoreDuplicates: true` a deduped upsert returns `data: []` — an
empty array, which is **truthy**. `if (!row)` would pass the guard and enqueue a
delivery for a notification that was never written. Check `data?.length`, not
truthiness.

The guard itself matters because without it a re-run of the fee cron creates fresh
delivery rows for a notification the user already got — the dedupe index still
holds at the notification level while push spams anyway.

Fan-out volume is the thing to watch, and it is worse than it looks:
`createNotifications` is `Promise.all` over *individual* upserts, so an 80-recipient
homework post is 80 round trips, not one insert — and enqueueing deliveries doubles
that. Convert both to a single bulk `upsert(...).select()` while making this change;
it fixes the round-trip count and makes the dedupe guard read naturally over the
returned rows. Provider calls stay in the worker regardless.

### 5.2 Delivery worker

A single function, `runDeliveries()`, claiming a bounded batch:

- `SELECT … WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 100 FOR UPDATE SKIP LOCKED`.
  `SKIP LOCKED` is what makes this safe if a second backend instance ever runs.

  **This cannot be written with supabase-js.** PostgREST has no row-locking
  syntax, so the claim query has to live in a Postgres function called via
  `supabase.rpc('claim_pending_deliveries', { batch_size: 100 })` — a migration
  to write, not a query to issue. The function does the `SELECT … FOR UPDATE SKIP
  LOCKED`, flips the claimed rows out of `pending` in the same transaction, and
  returns them. Everything else in the worker stays in TypeScript.
- Dispatch per channel. Push uses the `web-push` package; email uses a provider REST call.
- On success → `sent`. On failure → `attempts + 1`, exponential backoff into
  `next_attempt_at`, `failed` after 5 attempts.
- **On push 404/410 → mark the subscription `failed_at` and `skipped` the
  delivery.** Stale subscriptions are the normal case, not an error; without this
  they accumulate and every send retries them.

Invoked two ways, mirroring the existing fee-reminder pattern:
- `cron.schedule('* * * * *')` in `index.ts` alongside the existing job.
- `setImmediate(runDeliveries)` after a trigger site writes, so the common case
  is near-instant rather than waiting up to a minute.

### 5.3 New routes

Added to `backend/src/modules/notifications/routes.ts`, all behind the existing
`authenticate` middleware and scoped to `req.user!.id`:

| Route | Purpose |
|---|---|
| `POST /notifications/push/subscribe` | Store a subscription. Body: `{ subscription, app }`. Upsert on `endpoint`. |
| `DELETE /notifications/push/subscribe` | Remove on explicit opt-out. Body: `{ endpoint }`. |
| `GET /notifications/preferences` | Current opt-outs. |
| `PUT /notifications/preferences` | Bulk update. |
| `GET /notifications/vapid-public-key` | Public key for `pushManager.subscribe()`. Public value, but keep it behind auth for symmetry. |

New env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Add to
`render.yaml` with `sync: false` and to `docker-compose.yml`'s backend
`environment` block, matching how the Supabase keys are handled.

### 5.4 Fix the links — done (`dd08890`)

All six family-facing `link` values now use app-relative paths. A user only ever
logs into one app (role decides which — `student`/`parent` → family, everyone
else → staff), so a relative link resolves against whichever app renders the bell.

| File | Was | Now |
|---|---|---|
| `feeReminders.ts` | `/portal/fees` | `/fees` |
| `academics/routes.ts` | `/portal/homework` | `/homework` |
| `sis/routes.ts` (attendance) | `/portal/attendance` | `/attendance` |
| `sis/routes.ts` (TC) | `/portal` | `/` |
| `fee/routes.ts` | `/portal/fees` | `/fees` |
| `exam/routes.ts` | `/portal/exams` | `/exams` |

`hrms/routes.ts` (`/hr/my-leave`) is staff-facing and was always correct. Line
numbers are deliberately omitted — the previous version of this table pinned them
and every one drifted within a day.

The 248 existing rows were rewritten rather than tolerated, so the bell works on
today's data instead of only after a reseed.

---

## 6. Frontend changes

### 6.1 The duplication decision

`frontend-portal/lib/api.ts:1-10` explicitly documents that the two apps
duplicate rather than share, naming auth/API-client drift as the accepted
tradeoff. That was a reasonable call for a trimmed-down API client.

**This feature changes the calculus, and I'd recommend extracting a shared
package.** Push adds roughly five more files that must stay byte-identical:
`sw.js` push handlers, the subscribe hook, permission-prompt UI, preferences UI,
and the bell's push integration. The failure mode is different in kind from what
the split accepted — a divergent API client produces a visible 404, while a
divergent `sw.js` produces *notifications silently not arriving on one app*, with
no error anywhere. That's the hardest possible bug to notice.

Proposal: a `packages/notification-client` workspace package exporting the hook,
the bell, the preferences panel, and a `buildServiceWorker()` snippet both apps
inline. Each app keeps its own `manifest.ts`, cache version, and styling.

Caveat worth naming: `sw.js` is both the file that must not drift *and* the one a
workspace package handles worst — it is a static asset served per origin, not an
import, so sharing it means a generate-into-`public/` build step in two apps.
`buildServiceWorker()` is the right shape, but if that build step is unwelcome,
the honest split is to extract the hook, bell and preferences panel (real modules,
real wins) and cover `sw.js` alone with the CI diff-check below.

If that's too large a change to take on now, the fallback is a single
`NOTIFICATIONS.md` sync checklist plus a CI job that diffs the shared files and
fails on drift. Cheap, and it converts a silent failure into a loud one. What
should not happen is copying five more files and relying on discipline.

### 6.2 Permission UX — the part most implementations get wrong

**Never call `Notification.requestPermission()` on page load.** A cold prompt
gets denied at high rates, and a denial is effectively permanent — the browser
won't re-prompt, and the user must dig through site settings to undo it. One bad
prompt costs that user forever.

The flow:

1. After the user has signed in and done something real (viewed fees, opened the
   bell) — never on first paint.
2. Show an **in-app pre-prompt** first: a dismissible card explaining what they'll
   receive. Only if they accept does the browser prompt fire. Dismissal costs
   nothing and can be re-offered later; a browser denial can't.
3. On accept → `pushManager.subscribe()` → POST to the backend.
4. Re-offer at most once per 30 days, tracked in `localStorage`.
5. On iOS Safari not in standalone mode, show the Add to Home Screen instruction
   instead — `pushManager` is unavailable there, so subscribing is impossible.

The two apps warrant different copy. Staff: "Get notified when leave requests
need your approval." Family: "Get fee reminders and attendance alerts."

### 6.3 Service worker additions

Appended to both `sw.js` files. The existing fetch/caching logic is untouched —
push is additive, and the current strategy (never intercept `/api/*`, network-first
navigation) stays exactly as-is. Bump `CACHE_VERSION` in both on deploy.

```js
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const { title, body, link, tag } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,                      // collapses repeats of the same alert
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  // Focus an existing tab if one is open rather than opening a duplicate.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.startsWith(self.location.origin));
        if (existing) return existing.focus().then((c) => c.navigate(link));
        return self.clients.openWindow(link);
      }),
  );
});
```

### 6.4 Bell and preferences

`NotificationBell.tsx` needs three changes beyond what exists:

- `refetchOnWindowFocus: true` on the unread-count query.
- The permission pre-prompt card (§6.2), rendered inside the open panel where
  there's context, rather than as a floating banner.
- A link to preferences.

Preferences UI: a simple type × channel grid. Family app shows the five
family-relevant types; staff app shows leave/TC/discount. Both write through
`PUT /notifications/preferences`.

One accessibility note the current bell is missing: the unread badge needs
`aria-live="polite"` and the button an `aria-label` including the count, so a
screen reader announces new notifications rather than silently re-rendering.

---

## 7. Infrastructure — why no Redis

The outbox table plus `FOR UPDATE SKIP LOCKED` gives ordering, retries, backoff,
and multi-instance safety using the database already in the stack. A Redis/BullMQ
setup would add a third moving piece to do the same job at this volume.

Redis earns its place at sustained thousands of sends per minute, or when workers
need to scale separately from the API. A single school's attendance and fee
notifications are nowhere near that. If volume grows, the worker's claim query is
the seam to swap — nothing else changes.

**The scheduling problem is real and must be solved regardless.** Both the
existing fee cron and the new delivery worker are in-process, and Render's free
plan spins the service down when idle. Options, in order of preference:

1. Move the backend off the free plan. Simplest, and the fee cron starts working
   too.
2. Keep the crons but drive them from an external scheduler (GitHub Actions,
   cron-job.org) hitting authenticated trigger endpoints. Works on free tier.
3. Supabase `pg_cron` calling a database function. Removes the Node dependency
   entirely but splits logic across two languages.

Redis solves none of these. Don't let a queue discussion substitute for this one.

---

## 8. Rollout

**Phase 1 — foundation.** Partly landed already (`dd08890`: seed fix, link
fixes, the 248 existing rows corrected). Remaining: the three tables, the
`claim_pending_deliveries` function, the type CHECK, the `.select()` correction
in §5.1, and a retention job.

Two things pulled into this phase that were previously further down:

- **Solve the scheduling problem (§7).** The delivery worker is scheduled exactly
  like the fee cron, which on `plan: free` does not run. Everything in Phase 2
  sits on top of it, so fixing it later means shipping push that silently never
  sends. Cheapest credible option: an authenticated trigger endpoint driven by an
  external scheduler, which also makes the existing fee cron work.
- **Retention.** Add the cleanup while the table is small rather than after it
  isn't — one homework post to a class already writes ~80 rows.

**Phase 2 — web push, family app first.** VAPID keys, subscribe endpoints,
`sw.js` handlers, pre-prompt UX, delivery worker with push only. Family app has
the clearer value and the more motivated users. Measure opt-in by platform.

**Phase 3 — staff app + email.** Same client code (shared package pays off here).
Add the email channel for fee-overdue and exam-results, the two that most need to
land when push doesn't.

**Phase 4 — preferences UI**, informed by which notifications people actually
mute. Ship opt-outs server-side in phase 2 so the data exists before the UI.

**Later, if the iOS data says so:** WhatsApp Business API for fee reminders.

---

## 9. Open questions

1. **Shared package or sync-checklist?** (§6.1) Needs a call before phase 2 —
   it's much cheaper to decide before the code is written twice.
2. **Which notifications are important enough for email?** My assumption:
   fee-overdue and exam-results only. Everything else is push + in-app.
3. **Quiet hours?** An attendance-absent alert fires when a teacher marks
   attendance, which is fine. But a badly-timed fee cron could push at 7am.
   Suggest a school-level quiet window rather than per-user, at least initially.
4. **Do staff want push at all,** or is the bell enough for people already at a
   desk? Worth asking before building phase 3.
5. ~~**Retention.**~~ Decided: delete read notifications older than 90 days, and
   do it in Phase 1. The table grows faster than the original estimate suggested —
   840 students each with a linked parent means one homework post to a class
   writes ~80 rows, and seeding alone produced hundreds before a single real event.

6. **Quiet hours — school-level, and note the existing job already violates it.**
   The fee sweep is hard-coded to `0 7 * * *`, i.e. 7am, which is inside most
   people's quiet window. Whatever window gets configured, that cron is its first
   customer.
