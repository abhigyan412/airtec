-- Generalises the receipt-number counter to every generated document
-- number in the app.
--
-- Nine call sites across fees, SIS, admissions, HR and documents all built
-- identifiers as PREFIX + year + (count(*) of that school's rows + 1):
-- invoice, receipt, admission, TC, certificate, inquiry, application and
-- candidate numbers. Several of those columns are UNIQUE, so each one is
-- the same latent 500: it collides the moment numbering isn't dense
-- (already true of seeded data), after any deletion, or when two users
-- create the same kind of record at once.
--
-- Supersedes receipt_counters from the previous migration, which solved
-- this for exactly one of the nine.

DROP FUNCTION IF EXISTS public.next_receipt_number(uuid, int);
DROP TABLE IF EXISTS public.receipt_counters;

CREATE TABLE public.document_counters (
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    year int NOT NULL,
    prefix text NOT NULL,
    last_number int NOT NULL DEFAULT 0,
    PRIMARY KEY (school_id, year, prefix)
);

-- Start each counter past the highest number already issued, so generated
-- numbers can never collide with existing history.
INSERT INTO public.document_counters (school_id, year, prefix, last_number)
SELECT school_id, year, prefix, max(n)
FROM (
    SELECT school_id, substring(receipt_number     from 4 for 4)::int AS year, 'RCP'  AS prefix, substring(receipt_number     from 8)::int AS n FROM public.fee_payments            WHERE receipt_number     ~ '^RCP[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(invoice_number     from 4 for 4)::int,         'INV',          substring(invoice_number     from 8)::int      FROM public.fee_invoices            WHERE invoice_number     ~ '^INV[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(admission_number   from 4 for 4)::int,         'ADM',          substring(admission_number   from 8)::int      FROM public.students                WHERE admission_number   ~ '^ADM[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(tc_number          from 3 for 4)::int,         'TC',           substring(tc_number          from 7)::int      FROM public.transfer_certificates   WHERE tc_number          ~ '^TC[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(certificate_number from 5 for 4)::int,         'CERT',         substring(certificate_number from 9)::int      FROM public.issued_certificates     WHERE certificate_number ~ '^CERT[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(inquiry_number     from 4 for 4)::int,         'INQ',          substring(inquiry_number     from 8)::int      FROM public.admission_inquiries     WHERE inquiry_number     ~ '^INQ[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(application_number from 4 for 4)::int,         'APP',          substring(application_number from 8)::int      FROM public.admission_applications  WHERE application_number ~ '^APP[0-9]{4}[0-9]+$'
    UNION ALL
    SELECT school_id, substring(application_number from 3 for 4)::int,         'JA',           substring(application_number from 7)::int      FROM public.job_applications        WHERE application_number ~ '^JA[0-9]{4}[0-9]+$'
) AS existing
GROUP BY school_id, year, prefix
ON CONFLICT (school_id, year, prefix) DO UPDATE SET last_number = EXCLUDED.last_number;

-- One statement, so concurrent callers serialise on the row lock and each
-- receives a distinct number. `pad` is a parameter because the existing
-- formats disagree (5 digits for INV/RCP, 4 for the rest) and changing
-- them would break continuity with numbers already issued.
CREATE OR REPLACE FUNCTION public.next_document_number(
    p_school_id uuid, p_year int, p_prefix text, p_pad int DEFAULT 4
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    n int;
BEGIN
    INSERT INTO public.document_counters (school_id, year, prefix, last_number)
         VALUES (p_school_id, p_year, p_prefix, 1)
    ON CONFLICT (school_id, year, prefix)
    DO UPDATE SET last_number = public.document_counters.last_number + 1
      RETURNING last_number INTO n;

    RETURN p_prefix || p_year::text || lpad(n::text, p_pad, '0');
END;
$$;
