-- A fee structure gains a SCHEDULE: when each installment is raised and when it
-- is due.
--
-- Until now a plan said only how OFTEN it billed — 'quarterly' — and the actual
-- dates were decided per billing run, in a form field, by whoever happened to be
-- running it. Three consequences, all of them live in this database today:
--
--   * The due date was not a property of the plan, so nobody could answer "when
--     is Q2 due for Class 5?" without opening the billing screen and guessing.
--     It defaulted to the last day of the period, which no school actually uses —
--     fees are due at the START of a term, not after it has finished.
--
--   * Two runs of the same period could set two different due dates, and nothing
--     recorded which was intended.
--
--   * A parent portal has no way to show "next payment due 15 Jul" before the
--     invoice exists, because the date did not exist either.
--
-- The schedule is OPTIONAL. A structure with no rows falls back to the derived
-- period window with due = period end, which is exactly the current behaviour —
-- so this migration changes no existing billing on its own.

ALTER TABLE public.fee_structures
    -- When the plan takes effect. Distinct from the academic year: a fee revised
    -- mid-session starts on the day it was agreed, not the previous April.
    ADD COLUMN IF NOT EXISTS starts_on date,
    -- Optional close-off, for a plan that stops before the year does.
    ADD COLUMN IF NOT EXISTS ends_on   date;

COMMENT ON COLUMN public.fee_structures.starts_on IS
    'When this plan takes effect. Null means the academic year start.';

CREATE TABLE IF NOT EXISTS public.fee_structure_schedules (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_id uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,

    -- Matches BillingPeriod.token from billingPeriod.ts ('Q1', '2026-07', 'full').
    -- Deliberately the token and not the full period_key: the frequency already
    -- lives on the parent structure, and storing it twice invites the two to
    -- disagree after a version changes cadence.
    period_token text NOT NULL,
    -- Denormalised for display ('Quarter 1 (Apr–Jun)'), so a schedule can be
    -- rendered without recomputing the academic calendar.
    label        text,

    -- When the invoice SHOULD be raised. Advisory: it drives the "ready to bill"
    -- prompt, and nothing enforces it — a school billing a week early is normal.
    bills_on     date,
    -- When the money is due. This is the column that exists for its own sake.
    due_date     date NOT NULL,

    sort_order   integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),

    -- One row per period per structure. Without this a re-saved schedule appends
    -- a second Q1 and the billing run has two due dates to choose between.
    UNIQUE (structure_id, period_token)
);

COMMENT ON TABLE public.fee_structure_schedules IS
    'When each installment of a plan is raised and when it falls due. Absent = fall back to the derived period window.';

-- The billing run''s access pattern: "for this structure, what is the due date of
-- the period I am raising".
CREATE INDEX IF NOT EXISTS idx_fee_structure_schedules_lookup
    ON public.fee_structure_schedules (structure_id, period_token);

-- Ordering the schedule for display without sorting tokens as text, which puts
-- '2026-10' before '2026-9' and Q10 before Q2.
CREATE INDEX IF NOT EXISTS idx_fee_structure_schedules_order
    ON public.fee_structure_schedules (structure_id, sort_order);
