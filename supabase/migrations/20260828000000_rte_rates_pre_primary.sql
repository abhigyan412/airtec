-- RTE rates have to reach below Class 1.
--
-- rte_rates bands a reimbursement by class level, and both ends were
-- CHECK (>= 0) — written when the class ladder started at Class 1 and 0 was
-- the natural floor. Pre-primary now sits below that: UKG is 0, LKG is -1 and
-- Nursery is -2, so numeric_level runs -2..12.
--
-- The effect was not a rejected insert but a silent gap. A rate band simply
-- could not be written to cover Nursery or LKG, rateFor() found nothing for
-- those children, and the claim run skipped them:
--
--     29 skipped — no state rate set for LKG / Nursery
--
-- reported beside 229 successful claims, which reads like a data problem with
-- 29 students rather than a schema that cannot express the rate at all.
--
-- §12(1)(c) admissions commonly start at pre-primary, so the money is real:
-- these are exactly the children a school is reimbursed for from entry.
--
-- The floor moves to -3 rather than disappearing entirely, because a band
-- starting at some arbitrarily negative level is a typo, not a policy.

ALTER TABLE public.rte_rates DROP CONSTRAINT IF EXISTS rte_rates_class_from_check;
ALTER TABLE public.rte_rates DROP CONSTRAINT IF EXISTS rte_rates_class_to_check;

ALTER TABLE public.rte_rates
    ADD CONSTRAINT rte_rates_class_from_check CHECK (class_from >= -3),
    ADD CONSTRAINT rte_rates_class_to_check   CHECK (class_to   >= -3);

COMMENT ON COLUMN public.rte_rates.class_from IS
    'Lowest class level the band covers, on students.classes.numeric_level. Pre-primary is negative: Nursery -2, LKG -1, UKG 0.';
COMMENT ON COLUMN public.rte_rates.class_to IS
    'Highest class level the band covers, inclusive.';
