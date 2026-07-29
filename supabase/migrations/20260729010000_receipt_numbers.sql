-- Race-free receipt numbers.
--
-- Both payment endpoints generated receipts as
--   RCP{year}{count(*) of school's payments + 1}
-- which fails three ways:
--   1. It assumes payment numbering is dense and count-aligned. It isn't —
--      seeded receipts are numbered by invoice index, so count+1 lands on
--      an existing number and the insert dies on
--      fee_payments_receipt_number_key.
--   2. Deleting or voiding any payment makes the next receipt collide.
--   3. Two cashiers recording at the same moment read the same count and
--      generate the same receipt number.
--
-- A counter row per (school, year) incremented atomically fixes all three.
-- Receipts stay dense and per-school, which is what an audit expects.

CREATE TABLE public.receipt_counters (
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    year int NOT NULL,
    last_number int NOT NULL DEFAULT 0,
    PRIMARY KEY (school_id, year)
);

-- Seed each counter past the highest receipt already issued for that
-- school/year, so the first generated number cannot collide with history.
INSERT INTO public.receipt_counters (school_id, year, last_number)
SELECT school_id,
       substring(receipt_number from 4 for 4)::int AS year,
       max(substring(receipt_number from 8)::int)  AS last_number
  FROM public.fee_payments
 WHERE receipt_number ~ '^RCP[0-9]{4}[0-9]+$'
 GROUP BY school_id, substring(receipt_number from 4 for 4)::int
ON CONFLICT (school_id, year) DO UPDATE SET last_number = EXCLUDED.last_number;

-- One statement, so concurrent callers serialise on the row lock and each
-- gets a distinct number.
CREATE OR REPLACE FUNCTION public.next_receipt_number(p_school_id uuid, p_year int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    n int;
BEGIN
    INSERT INTO public.receipt_counters (school_id, year, last_number)
         VALUES (p_school_id, p_year, 1)
    ON CONFLICT (school_id, year)
    DO UPDATE SET last_number = public.receipt_counters.last_number + 1
      RETURNING last_number INTO n;

    RETURN 'RCP' || p_year::text || lpad(n::text, 5, '0');
END;
$$;
