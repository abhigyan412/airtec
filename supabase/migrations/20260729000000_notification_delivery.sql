-- Notification delivery foundation (design.md §4, §5).
--
-- Adds the three tables push/email delivery needs, constrains the type
-- column that has been accepting anything, and provides the claim
-- function the worker needs — PostgREST has no row-locking syntax, so
-- FOR UPDATE SKIP LOCKED has to live here rather than in the client.
--
-- RLS stays OFF, matching this schema's established convention:
-- authorization is enforced in Express, where every notifications route
-- already scopes by req.user.id / req.user.school_id.

-- ── One row per browser/device ───────────────────────────────────────
CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    -- The two apps are separate origins, so a subscription belongs to one
    -- of them. Lets us target the right app and debug by app.
    app text NOT NULL CHECK (app IN ('staff','family')),
    endpoint text NOT NULL UNIQUE,   -- push service URL; natural dedupe key
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    -- Set when the push service returns 404/410. Kept rather than deleted
    -- so "never subscribed" stays distinguishable from "expired".
    failed_at timestamptz
);
CREATE INDEX idx_push_subs_user ON public.push_subscriptions (user_id) WHERE failed_at IS NULL;

-- ── Opt-outs only ────────────────────────────────────────────────────
-- A row means "this user muted this type on this channel". Absence means
-- enabled, so new notification types roll out on-by-default with no
-- per-user backfill. There is deliberately no `enabled` column: presence
-- is the whole signal, so there is only one way to express each state.
CREATE TABLE public.notification_preferences (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type text NOT NULL,
    channel text NOT NULL CHECK (channel IN ('in_app','push','email')),
    muted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, type, channel)
);

-- ── The outbox ───────────────────────────────────────────────────────
CREATE TABLE public.notification_deliveries (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('push','email')),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','claimed','sent','failed','skipped')),
    attempts int NOT NULL DEFAULT 0,
    last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Drives the claim query below.
CREATE INDEX idx_deliveries_pending
    ON public.notification_deliveries (next_attempt_at)
    WHERE status = 'pending';
CREATE INDEX idx_deliveries_notification ON public.notification_deliveries (notification_id);

-- ── Claim function ───────────────────────────────────────────────────
-- SELECT ... FOR UPDATE SKIP LOCKED and the status flip happen in one
-- transaction, so two workers can never claim the same row. This is the
-- seam to swap if volume ever justifies a real queue (design.md §7).
--
-- Rows move to 'claimed' rather than straight to 'sent' so a worker that
-- dies mid-send leaves evidence; the reaper below returns them.
CREATE OR REPLACE FUNCTION public.claim_pending_deliveries(batch_size int DEFAULT 100)
RETURNS SETOF public.notification_deliveries
LANGUAGE sql
AS $$
    UPDATE public.notification_deliveries d
       SET status = 'claimed', claimed_at = now(), attempts = d.attempts + 1
     WHERE d.id IN (
             SELECT id FROM public.notification_deliveries
              WHERE status = 'pending' AND next_attempt_at <= now()
              ORDER BY next_attempt_at
              LIMIT batch_size
              FOR UPDATE SKIP LOCKED
           )
    RETURNING d.*;
$$;

-- Return rows whose worker died before reporting an outcome. Without
-- this a crash strands them in 'claimed' forever.
CREATE OR REPLACE FUNCTION public.requeue_stale_deliveries(older_than interval DEFAULT '5 minutes')
RETURNS int
LANGUAGE sql
AS $$
    WITH requeued AS (
        UPDATE public.notification_deliveries
           SET status = 'pending', next_attempt_at = now()
         WHERE status = 'claimed' AND claimed_at < now() - older_than
        RETURNING 1
    ) SELECT count(*)::int FROM requeued;
$$;

-- ── Retention (design.md §9) ─────────────────────────────────────────
-- One homework post to a class writes ~80 rows; this table only grows.
-- Deliveries cascade from notifications.
CREATE OR REPLACE FUNCTION public.purge_old_notifications(older_than interval DEFAULT '90 days')
RETURNS int
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM public.notifications
         WHERE is_read = true AND created_at < now() - older_than
        RETURNING 1
    ) SELECT count(*)::int FROM deleted;
$$;

-- ── Constrain the type column ────────────────────────────────────────
-- Added only now, after the seed stopped writing values outside the
-- union — the reverse order is how exams.status ended up silently
-- rejecting every write for months.
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'attendance_absent','leave_approved','leave_rejected',
        'tc_approved','tc_rejected','discount_approved','discount_rejected',
        'homework_assigned','exam_result_published','fee_due_soon','fee_overdue'
    ]));
