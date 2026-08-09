-- Lines that do not bill in every period.
--
-- A structure carries ONE frequency, and until now every line on it billed in
-- every period that frequency produced. That is correct for tuition and for a
-- bus seat, and wrong for everything a school charges once: an admission fee, a
-- caution deposit, an annual fund. On a quarterly plan those billed four times a
-- year, so the only safe thing to do was keep them off the plan altogether and
-- raise an ad-hoc charge per student by hand — which is not a plan, and does not
-- appear in a forecast.
--
-- One nullable column fixes it. NULL means "every period", which is exactly the
-- behaviour every existing line already has, so there is nothing to backfill and
-- no invoice changes meaning. A list restricts the line to those periods.
--
-- The values are the SAME tokens the schedule and period_key already speak in —
-- 'Q1', 'H1', '2026-07', 'full' — deliberately, so a line, a schedule row and an
-- invoice can all be matched on one string with no translation table between
-- them. The tokens are validated against the academic year at billing time (see
-- billingPeriod.findPeriod), not here: a token is only meaningful next to a
-- frequency, and the frequency lives on the parent row.

ALTER TABLE public.fee_structure_lines
    ADD COLUMN IF NOT EXISTS period_tokens text[];

-- An empty array is the one value with no sensible reading: it would mean "bills
-- in no period at all", a line nobody can ever be charged for and which no UI
-- would show as disabled. NULL is how you say "always".
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fee_structure_lines_period_tokens_check'
    ) THEN
        ALTER TABLE public.fee_structure_lines
            ADD CONSTRAINT fee_structure_lines_period_tokens_check
            CHECK (period_tokens IS NULL OR array_length(period_tokens, 1) > 0);
    END IF;
END $$;

COMMENT ON COLUMN public.fee_structure_lines.period_tokens IS
    'Periods this line bills in, as schedule tokens (Q1, H1, 2026-07, full). NULL = every period.';
