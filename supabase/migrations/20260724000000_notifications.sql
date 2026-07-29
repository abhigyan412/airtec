-- Notifications system: in-app notification center, provider-agnostic
-- (email/SMS/WhatsApp can be added later without changing trigger call
-- sites — see backend/src/shared/utils/notifications.ts).
--
-- RLS intentionally left OFF, matching this schema's established
-- convention: authorization is enforced at the Express layer (every
-- notifications route scopes by req.user.id / req.user.school_id),
-- not via Postgres RLS. Several tables in the baseline migration had
-- RLS enabled with zero policies, which silently blocked reads/writes
-- with no visible error — deliberately avoiding that class of bug here.

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    link text,
    is_read boolean NOT NULL DEFAULT false,
    related_entity_type text,
    related_entity_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Plain stored date (not derived from created_at at query time) —
    -- Postgres won't allow a timestamptz->date cast in an index
    -- expression (it's STABLE, not IMMUTABLE, since it depends on the
    -- session timezone), so this is set explicitly on insert instead.
    notification_date date NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (id)
);

CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_school ON public.notifications (school_id);

-- Idempotency for the fee-reminder cron job: one reminder of a given
-- type per invoice per day, not one per cron tick.
--
-- Deliberately NOT a partial index (no WHERE related_entity_id IS NOT
-- NULL) even though that's the only case it needs to dedupe: Postgres
-- upsert's ON CONFLICT can only target a partial unique index if the
-- same WHERE predicate is repeated in the ON CONFLICT clause itself,
-- which the Supabase client's upsert({onConflict: '...'}) has no way
-- to express — it always issues a plain ON CONFLICT (columns), so it
-- silently can't match a partial index ("no unique or exclusion
-- constraint matching the ON CONFLICT specification"). A plain index
-- behaves identically for this table in practice anyway: Postgres
-- unique constraints already treat NULL as distinct from every other
-- NULL, so rows with related_entity_id IS NULL are never deduped
-- against each other regardless.
CREATE UNIQUE INDEX idx_notifications_dedupe
    ON public.notifications (user_id, type, related_entity_id, notification_date);

-- ── Fix: exams.status could never actually reach 'result_published' ──
-- The freeze/publish workflow (backend/src/modules/exam/routes.ts) has
-- always tried to write 'result_frozen' / 'result_verified' /
-- 'result_published' into exams.status on each approval step, but the
-- baseline CHECK constraint only allowed
-- ('draft','published','ongoing','completed','result_declared') — so
-- every one of those updates was silently rejected (the route never
-- checked the update's error). No exam in production data has ever
-- reached 'result_published' as a result. Found while wiring the new
-- "exam results published" notification trigger onto this exact status
-- transition.
ALTER TABLE public.exams DROP CONSTRAINT exams_status_check;
ALTER TABLE public.exams ADD CONSTRAINT exams_status_check
    CHECK (status = ANY (ARRAY[
        'draft'::text, 'published'::text, 'ongoing'::text, 'completed'::text,
        'result_declared'::text, 'result_frozen'::text, 'result_verified'::text, 'result_published'::text
    ]));
