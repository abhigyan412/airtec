-- The dashboard numbers, computed where the rows are.
--
-- /fees/stats read every non-cancelled invoice in the school into Node and
-- summed them in JavaScript. PostgREST caps a response at 1,000 rows and does
-- not say so, so past 1,000 invoices — about 250 students on quarterly billing —
-- the headline figures were simply short. Measured on this database before this
-- migration: ₹99,26,925 billed against a truth of ₹1,83,10,961, understated by
-- 46%, with no error anywhere and every screen built on it repeating the number
-- confidently.
--
-- Paging the scan would fix the correctness and keep the silliness: twenty
-- thousand rows crossing the wire so Node can add them up. These four are pure
-- aggregates — SUM and GROUP BY over indexed columns — so they belong in the
-- database. /stats becomes one round trip returning one row.
--
-- Everything that is NOT a pure aggregate (the aging report, defaulters, the
-- late-fee sweep, the reminder scan) keeps its scan and gets the paging helper
-- in lib/db.ts instead, because those need the rows themselves.
--
-- A note on time. Buckets are cut on the SCHOOL's calendar, not the server's:
-- `payment_date AT TIME ZONE 'Asia/Kolkata'`. Slicing a UTC timestamp misfiles
-- every payment taken in the first five and a half hours of a day into the
-- previous one — and on 31 March, into the previous financial year.

-- ═══════════════════════════════════════════════════════════════════
-- WHERE THE SCHOOL STANDS
-- ═══════════════════════════════════════════════════════════════════
--
-- Billed and collected come from the SAME set of invoices, so they cannot drift.
-- Only OPEN invoices are still owed: a carried_forward invoice's balance now
-- lives in fee_arrears and is counted there, and counting both is the exact
-- double-count the arrears model removes.
CREATE OR REPLACE FUNCTION public.fee_stats(
    p_school_id       uuid,
    p_academic_year_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
    WITH inv AS (
        SELECT status, total_amount, amount_paid
          FROM public.fee_invoices
         WHERE school_id = p_school_id
           AND status <> 'cancelled'
           AND (p_academic_year_id IS NULL OR academic_year_id = p_academic_year_id)
    ),
    i AS (
        SELECT COALESCE(sum(total_amount), 0)                                            AS billed,
               COALESCE(sum(amount_paid), 0)                                             AS collected,
               COALESCE(sum(GREATEST(0, total_amount - amount_paid))
                        FILTER (WHERE status IN ('unpaid','partial')), 0)                AS invoice_due,
               count(*) FILTER (WHERE status = 'paid')                                   AS paid_invoices,
               count(*) FILTER (WHERE status = 'partial')                                AS partial_invoices,
               count(*) FILTER (WHERE status = 'unpaid')                                 AS unpaid_invoices,
               count(*)                                                                  AS total_invoices
          FROM inv
    ),
    a AS (
        SELECT COALESCE(sum(GREATEST(0, amount - amount_paid)), 0) AS arrears_due
          FROM public.fee_arrears
         WHERE school_id = p_school_id AND status IN ('pending','partial')
    ),
    adv AS (
        SELECT COALESCE(sum(unallocated_amount), 0) AS advance
          FROM public.fee_payments
         WHERE school_id = p_school_id AND status = 'captured' AND unallocated_amount > 0
    )
    SELECT jsonb_build_object(
        'total_billed',      round(i.billed, 2),
        'total_collected',   round(i.collected, 2),
        'total_due',         round(i.invoice_due, 2),
        'arrears_due',       round(a.arrears_due, 2),
        'total_outstanding', round(i.invoice_due + a.arrears_due, 2),
        'advance_held',      round(adv.advance, 2),
        'paid_invoices',     i.paid_invoices,
        'partial_invoices',  i.partial_invoices,
        'unpaid_invoices',   i.unpaid_invoices,
        'total_invoices',    i.total_invoices,
        'collection_rate',   CASE WHEN i.billed > 0
                                  THEN round((i.collected / i.billed) * 100)::int
                                  ELSE 0 END)
      FROM i, a, adv;
$$;

COMMENT ON FUNCTION public.fee_stats IS
    'The fee dashboard headline figures in one round trip. Replaces a full invoice scan that PostgREST silently capped at 1,000 rows.';

-- ═══════════════════════════════════════════════════════════════════
-- POSITION BY CLASS AND SECTION
-- ═══════════════════════════════════════════════════════════════════
--
-- A school chasing money thinks in classes, not in a flat list of invoices.
--
-- The join is from STUDENTS outward, so a class with no invoices still appears
-- with its headcount — and an invoice belonging to a student who has left is
-- counted nowhere rather than silently folded into another class's totals.
CREATE OR REPLACE FUNCTION public.fee_class_positions(
    p_school_id        uuid,
    p_academic_year_id uuid DEFAULT NULL
) RETURNS TABLE (
    class_id            uuid,
    class_name          text,
    section_id          uuid,
    section_name        text,
    student_count       bigint,
    billed_student_count bigint,
    billed              numeric,
    collected           numeric,
    outstanding         numeric,
    overdue             numeric
) LANGUAGE sql STABLE AS $$
    WITH roster AS (
        SELECT s.id, s.class_id, s.section_id, c.name AS class_name, sec.name AS section_name
          FROM public.students s
          LEFT JOIN public.classes c   ON c.id = s.class_id
          LEFT JOIN public.sections sec ON sec.id = s.section_id
         WHERE s.school_id = p_school_id AND s.status = 'active' AND s.class_id IS NOT NULL
    ),
    inv AS (
        SELECT i.student_id, i.total_amount, i.amount_paid, i.due_date, i.status
          FROM public.fee_invoices i
         WHERE i.school_id = p_school_id
           AND i.status <> 'cancelled'
           AND (p_academic_year_id IS NULL OR i.academic_year_id = p_academic_year_id)
    )
    SELECT r.class_id,
           r.class_name,
           r.section_id,
           r.section_name,
           count(DISTINCT r.id)                                                        AS student_count,
           count(DISTINCT inv.student_id)                                              AS billed_student_count,
           round(COALESCE(sum(inv.total_amount), 0), 2)                                AS billed,
           round(COALESCE(sum(inv.amount_paid), 0), 2)                                 AS collected,
           round(COALESCE(sum(GREATEST(0, inv.total_amount - inv.amount_paid))
                          FILTER (WHERE inv.status IN ('unpaid','partial')), 0), 2)     AS outstanding,
           round(COALESCE(sum(GREATEST(0, inv.total_amount - inv.amount_paid))
                          FILTER (WHERE inv.status IN ('unpaid','partial')
                                    AND inv.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date), 0), 2) AS overdue
      FROM roster r
      LEFT JOIN inv ON inv.student_id = r.id
     GROUP BY r.class_id, r.class_name, r.section_id, r.section_name
     ORDER BY r.class_name NULLS LAST, r.section_name NULLS LAST;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- COLLECTION TREND
-- ═══════════════════════════════════════════════════════════════════
--
-- Refunds are netted off, and bounced/cancelled payments are excluded through
-- fee_payment_effective — the same function the invoice trigger uses, so the
-- trend and the invoices can never disagree about what a payment was worth.
CREATE OR REPLACE FUNCTION public.fee_collection_by_day(
    p_school_id uuid,
    p_from      date,
    p_to        date
) RETURNS TABLE (day date, collected numeric) LANGUAGE sql STABLE AS $$
    SELECT d::date AS day,
           round(COALESCE(sum(
               public.fee_payment_effective(p.status, p.amount, p.refunded_amount)
           ), 0), 2) AS collected
      FROM generate_series(p_from, p_to, interval '1 day') d
      LEFT JOIN public.fee_payments p
             ON p.school_id = p_school_id
            AND p.status = 'captured'
            AND (p.payment_date AT TIME ZONE 'Asia/Kolkata')::date = d::date
     GROUP BY d
     ORDER BY d;
$$;

CREATE OR REPLACE FUNCTION public.fee_collection_by_month(
    p_school_id uuid,
    p_months    int DEFAULT 6
) RETURNS TABLE (month text, collected numeric) LANGUAGE sql STABLE AS $$
    WITH months AS (
        SELECT to_char(m, 'YYYY-MM') AS key, m::date AS start_of_month
          FROM generate_series(
                 date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - ((p_months - 1) || ' months')::interval,
                 date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')),
                 interval '1 month') m
    )
    SELECT months.key AS month,
           round(COALESCE(sum(
               public.fee_payment_effective(p.status, p.amount, p.refunded_amount)
           ), 0), 2) AS collected
      FROM months
      LEFT JOIN public.fee_payments p
             ON p.school_id = p_school_id
            AND p.status = 'captured'
            AND to_char((p.payment_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') = months.key
     GROUP BY months.key
     ORDER BY months.key;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- THE DAY BOOK'S TOTALS
-- ═══════════════════════════════════════════════════════════════════
--
-- A cash-reconciliation document, so a short read is a till that does not match.
-- The day is the school's day: 00:00 to 23:59:59.999 in Asia/Kolkata, not the
-- UTC window the naive `${date}T00:00:00` bounds actually asked for.
CREATE OR REPLACE FUNCTION public.fee_daybook_totals(
    p_school_id uuid,
    p_date      date
) RETURNS jsonb LANGUAGE sql STABLE AS $$
    WITH pay AS (
        SELECT p.method, p.status,
               public.fee_payment_effective(p.status, p.amount, p.refunded_amount) AS net,
               COALESCE(p.refunded_amount, 0) AS refunded
          FROM public.fee_payments p
         WHERE p.school_id = p_school_id
           AND (p.payment_date AT TIME ZONE 'Asia/Kolkata')::date = p_date
    )
    SELECT jsonb_build_object(
        'receipts',  count(*) FILTER (WHERE status NOT IN ('cancelled','bounced')),
        'cash',      round(COALESCE(sum(net) FILTER (WHERE method = 'cash'), 0), 2),
        'bank',      round(COALESCE(sum(net) FILTER (WHERE method <> 'cash'), 0), 2),
        'total',     round(COALESCE(sum(net), 0), 2),
        'refunded',  round(COALESCE(sum(refunded), 0), 2),
        'bounced',   count(*) FILTER (WHERE status = 'bounced'),
        'cancelled', count(*) FILTER (WHERE status = 'cancelled'))
      FROM pay;
$$;
