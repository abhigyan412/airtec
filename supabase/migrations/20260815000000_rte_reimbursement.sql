-- RTE seats as a receivable, not a discount.
--
-- Under RTE §12(1)(c) a private unaided school admits the child free and claims
-- reimbursement from the STATE, at a rate the state sets — not the rate the
-- school charges — and on the state's own timetable, which is routinely late.
--
-- So an RTE seat is two facts at once:
--
--   * ₹0 owed by the family. Not a debt, not a default, and never something to
--     telephone a parent about.
--   * ₹X owed to the school by the government, ageing, at a different rate.
--
-- Modelling it as "a student with a 100% discount" throws the second fact away
-- entirely: the school forgoes the revenue in its own books and has no record of
-- what it is owed. Modelling it as ordinary outstanding — which is what happened
-- before this — reports a government's arrears as a family's, and puts the
-- parents on the defaulters list next to their phone number.
--
-- These two tables hold the second fact. The first is handled by a concession
-- rule on the 'rte' category (see fee_concession_rules).

-- The state's schedule. Per class band, per year, because it is revised
-- annually and differs by band — e.g. classes I–V and VI–VIII are separate
-- rates in most state notifications.
CREATE TABLE IF NOT EXISTS public.rte_rates (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,

    -- Inclusive class band, by numeric_level, matching classes.numeric_level.
    class_from       int NOT NULL CHECK (class_from >= 0),
    class_to         int NOT NULL CHECK (class_to >= 0),

    -- Stated per month because that is how every state notification states it.
    -- The annual claim is this times the months in the billing period.
    monthly_amount   numeric(12,2) NOT NULL CHECK (monthly_amount >= 0),
    -- One-off annual entitlements (uniform, books) claimed alongside.
    annual_allowance numeric(12,2) NOT NULL DEFAULT 0 CHECK (annual_allowance >= 0),

    note             text,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT rte_rates_band_valid CHECK (class_to >= class_from),
    UNIQUE (school_id, academic_year_id, class_from, class_to)
);

COMMENT ON TABLE public.rte_rates IS
    'State reimbursement rates per class band per year. The state''s figure, which is NOT the school''s fee.';

-- What has been claimed, and what came back.
CREATE TABLE IF NOT EXISTS public.rte_reimbursement_claims (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,

    -- The same tokens fee_invoices.period_key speaks in, so a claim and the
    -- term it covers line up without a translation table.
    period_key       text NOT NULL,

    -- The state's figure at the time of claiming, snapshotted. A rate revised
    -- next year must not silently restate what was claimed this year.
    claim_amount     numeric(12,2) NOT NULL CHECK (claim_amount >= 0),

    status           text NOT NULL DEFAULT 'pending'
                       CHECK (status = ANY (ARRAY['pending','submitted','received','rejected'])),
    submitted_on     date,
    received_on      date,
    received_amount  numeric(12,2) CHECK (received_amount IS NULL OR received_amount >= 0),
    reference        text,
    note             text,

    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- One claim per child per period. Re-running the generator is then safe and
    -- idempotent, the same guarantee fee_invoices.period_key gives billing.
    UNIQUE (student_id, academic_year_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_rte_claims_school_status
    ON public.rte_reimbursement_claims (school_id, status);
CREATE INDEX IF NOT EXISTS idx_rte_claims_year
    ON public.rte_reimbursement_claims (school_id, academic_year_id);

COMMENT ON TABLE public.rte_reimbursement_claims IS
    'What the state owes the school for RTE seats, per child per period. Separate from fee_invoices: a family owes nothing on these.';
