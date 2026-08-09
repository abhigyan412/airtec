-- Fee category, made to mean something.
--
-- fee_assignments.fee_category has been inert since it was added: written by the
-- assign form, selected by the billing resolver, and branched on by nothing. An
-- admin tagging forty children "RTE" reasonably assumes the system will treat
-- them differently. It did not — they were billed the full plan, invoiced,
-- marked overdue, and their parents were texted by the nightly reminder sweep
-- for money the state is supposed to pay.
--
-- A rule turns the label into a lever. The category is the CONDITION; this row
-- is the CONSEQUENCE. At billing time the resolver matches a student's category
-- against these and folds the result into the same ApplicableDiscount list that
-- hand-granted concessions already travel in — so there stays exactly one path
-- to money coming off a bill, one implementation of the arithmetic, and one
-- thing to explain on a receipt.
--
-- Deliberately NOT a general-purpose rules engine. One category, one optional
-- head, one amount. Conditions on sibling order, income or class band are real
-- but need a families table that does not exist yet (see plan.md), and a
-- half-built engine with a precedence order nobody can predict is worse than a
-- table a bursar can read.

CREATE TABLE IF NOT EXISTS public.fee_concession_rules (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,

    -- 'general' is absent on purpose: a rule for it would silently discount the
    -- whole school, which is never what anyone means.
    fee_category     text NOT NULL CHECK (fee_category = ANY (
                       ARRAY['rte','staff_ward','sibling','scholarship'])),

    -- The same vocabulary fee_discounts uses, so a policy concession and a
    -- hand-granted one are the same kind of thing to every reader downstream.
    discount_type    text NOT NULL CHECK (discount_type = ANY (ARRAY['percentage','fixed'])),
    discount_value   numeric(12,2) NOT NULL CHECK (discount_value >= 0),

    -- NULL = every head on the plan. Otherwise this head alone, which is what
    -- most real policies say: schools waive tuition and still charge for the
    -- bus, the exam and the uniform.
    fee_head_id      uuid REFERENCES public.fee_heads(id) ON DELETE RESTRICT,

    is_active        boolean NOT NULL DEFAULT true,
    note             text,
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One rule per category per head per year. Two rules for the same pair would
-- stack silently, and "why is this child getting 60% off?" would have no answer
-- short of reading the table.
--
-- Two partial indexes rather than one constraint: in Postgres NULL never equals
-- NULL, so a plain UNIQUE would happily allow ten every-head rules for RTE.
CREATE UNIQUE INDEX IF NOT EXISTS fee_concession_rules_head_uniq
    ON public.fee_concession_rules (school_id, academic_year_id, fee_category, fee_head_id)
    WHERE fee_head_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fee_concession_rules_all_heads_uniq
    ON public.fee_concession_rules (school_id, academic_year_id, fee_category)
    WHERE fee_head_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fee_concession_rules_lookup
    ON public.fee_concession_rules (school_id, academic_year_id)
    WHERE is_active;

COMMENT ON TABLE public.fee_concession_rules IS
    'Category -> concession policy, applied by the billing run. The rule is the reason a discount exists; fee_discounts remains the record of one granted to a named student.';

-- The table starts EMPTY and the system behaves exactly as it does today until a
-- school fills it in. Seeding a percentage here would be inventing policy: RTE,
-- staff-ward and sibling terms are set per school and per state, and a guessed
-- 100% is wrong anywhere the state reimburses less than the school charges and
-- the school may bill the family the difference.
