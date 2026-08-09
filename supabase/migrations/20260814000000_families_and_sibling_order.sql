-- Families, and the sibling order derived from them.
--
-- "Sibling" was a label somebody typed, because a sibling was not a fact this
-- schema could hold: `parents` is one row of loose text per STUDENT
-- (father_name, father_phone, mother_name…), with no key joining two children of
-- the same household. Measured on the live database before this migration:
-- 841 parent rows, 841 distinct father_phone values, zero shared. A sibling
-- discount cannot be automatic while the relationship is unrepresentable.
--
-- This adds the missing key. `families` is deliberately thin — it exists to be
-- pointed AT, and the payer details still live on `parents` — because widening
-- it now would mean migrating contact data that the portal, the reminder sweep
-- and the defaulters screen all read today.

CREATE TABLE IF NOT EXISTS public.families (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    -- For humans, e.g. "Yadav (Rakesh)". Never matched on.
    name       text,
    -- What the backfill matched on, kept so a wrong grouping can be explained
    -- and re-run rather than guessed at a year later.
    matched_on text CHECK (matched_on IS NULL OR matched_on = ANY (
                 ARRAY['father_phone','mother_phone','father_aadhaar','manual'])),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES public.families(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_family ON public.students(family_id)
    WHERE family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_families_school ON public.families(school_id);

COMMENT ON COLUMN public.students.family_id IS
    'Household this student belongs to. NULL = not yet grouped; sibling_order treats them as an only child.';

-- ── sibling_order ─────────────────────────────────────────────────────
--
-- Derived, never typed. 1 is the senior-most child, counting only students still
-- on the roll — a withdrawn elder sibling must not hold the family at order 2
-- forever, and the discount has to re-tier itself the day anyone joins or
-- leaves. A view rather than a maintained column for exactly that reason: there
-- is no write path that can be forgotten, and no trigger to keep in step with
-- admissions, transfers and promotions.
--
-- Ordering: senior class first (numeric_level DESC), then earliest admitted, then
-- id — fully deterministic, so two reads never disagree about who is second.
CREATE OR REPLACE VIEW public.student_sibling_order AS
SELECT
    s.id                AS student_id,
    s.school_id,
    s.family_id,
    ROW_NUMBER() OVER (
        PARTITION BY s.family_id
        ORDER BY COALESCE(c.numeric_level, 0) DESC, s.created_at ASC, s.id ASC
    )::int              AS sibling_order,
    COUNT(*) OVER (PARTITION BY s.family_id)::int AS family_size
FROM public.students s
LEFT JOIN public.classes c ON c.id = s.class_id
WHERE s.status = 'active'
  AND s.family_id IS NOT NULL;

COMMENT ON VIEW public.student_sibling_order IS
    'Derived sibling numbering per family, senior-most first, active students only. Recomputed on read — no backfill, no trigger, cannot drift.';

-- ── The rule engine learns a second condition ─────────────────────────
--
-- A rule may now fire on sibling order instead of (or as well as) fee_category:
-- "10% off tuition from the second child" is the policy schools actually write,
-- and it maintains itself where a hand-applied 'sibling' tag does not.
ALTER TABLE public.fee_concession_rules
    ADD COLUMN IF NOT EXISTS min_sibling_order int
        CHECK (min_sibling_order IS NULL OR min_sibling_order >= 1);

-- fee_category becomes optional once a rule can be conditioned on order alone.
ALTER TABLE public.fee_concession_rules
    ALTER COLUMN fee_category DROP NOT NULL;

-- ...but a rule with NO condition would discount the entire school silently.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fee_concession_rules_has_condition'
    ) THEN
        ALTER TABLE public.fee_concession_rules
            ADD CONSTRAINT fee_concession_rules_has_condition
            CHECK (fee_category IS NOT NULL OR min_sibling_order IS NOT NULL);
    END IF;
END $$;

COMMENT ON COLUMN public.fee_concession_rules.min_sibling_order IS
    'Fires for the Nth child and later, counted senior-first within a family. NULL = not conditioned on sibling order.';
