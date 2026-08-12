-- Money moves in one transaction, or it does not move.
--
-- Every write path in this module was a chain of independent HTTP calls to
-- PostgREST. collectPayment — which runs on every payment, counter and online —
-- was five separate transactions: receipt number, payment row, allocations,
-- ledger pair, re-read. A failure between the second and the third leaves a
-- ₹10,000 receipt settling nothing, which the unallocated trigger then turns
-- into a ₹10,000 advance credit that does not exist. The same ₹10,000 is
-- reported as advance_held AND as outstanding, and a cashier can spend it.
--
-- The bounce path was worse: it deleted the allocations first and updated the
-- status second, with no error check between them.
--
-- These three functions are the transaction boundary the model always needed.
-- They are not a rewrite — the arithmetic is the same arithmetic, moved to where
-- it can be atomic and where the invoices can be locked BEFORE the split is
-- decided rather than after.
--
-- ─────────────────────────────────────────────────────────────────────
-- A note on the ledger, because this migration finishes something.
--
-- fee_ledger_entries was written for an ACCRUAL ledger — postWriteOff has always
-- been "Dr income, Cr receivable", which is only meaningful if receivable was
-- debited when the invoice was raised. It never was. Invoices were posted
-- nowhere, payments credited fee_income directly, and receivable therefore only
-- ever went down: a permanently negative account nobody could read.
--
-- Completed here rather than removed, because accrual is the correct basis for a
-- school that bills in advance and collects late:
--
--     invoice raised     Dr receivable        Cr fee_income / late_fee_income
--     payment taken      Dr cash|bank         Cr receivable  (+ Cr advance)
--     fine levied        Dr receivable        Cr late_fee_income
--     fine waived        Dr late_fee_income   Cr receivable
--     balance written off Dr fee_income       Cr receivable
--     cheque bounced     Dr receivable        Cr bank
--
-- One consequence worth stating plainly: late-fee income is now recognised when
-- the fine is LEVIED, once. It used to be credited again on every payment that
-- touched the invoice, because invoice.late_fee is the total fine rather than the
-- unrecovered remainder — two payments against one ₹500 fine posted ₹1,000 of
-- late-fee income, and debits still equalled credits, so nothing looked wrong.
-- That double-count cannot be expressed in this shape.
--
-- The historical entries are migrated at the bottom of this file.

-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENCY KEY
-- ═══════════════════════════════════════════════════════════════════
--
-- A retried request must not become a second receipt. The gateway path already
-- has the order to key on; the counter has nothing, and a cashier who clicks
-- twice on a slow connection has always been able to take the same money twice.
ALTER TABLE public.fee_payments
    ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_idempotency_uniq
    ON public.fee_payments (school_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.fee_payments.idempotency_key IS
    'Caller-supplied key. A repeat of the same key returns the original receipt instead of taking the money again.';

-- ═══════════════════════════════════════════════════════════════════
-- COLLECT
-- ═══════════════════════════════════════════════════════════════════
--
-- The important line is the FOR UPDATE on the invoice select. Locking the
-- invoices before deciding the split is what makes the overpayment guard mean
-- something: two cashiers taking the same fee now serialise on the same rows,
-- and the second one re-reads a balance that includes the first.
CREATE OR REPLACE FUNCTION public.fee_collect_payment(
    p_school_id       uuid,
    p_student_id      uuid,
    p_amount          numeric,
    p_method          text,
    p_reference       text    DEFAULT NULL,
    p_cheque_number   text    DEFAULT NULL,
    p_cheque_date     date    DEFAULT NULL,
    p_bank_name       text    DEFAULT NULL,
    p_notes           text    DEFAULT NULL,
    p_invoice_ids     uuid[]  DEFAULT NULL,
    p_collected_by    uuid    DEFAULT NULL,
    p_allow_advance   boolean DEFAULT true,
    p_idempotency_key text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_existing     public.fee_payments%ROWTYPE;
    v_payment_id   uuid;
    v_receipt      text;
    v_amount       numeric(12,2) := round(p_amount, 2);
    v_left         numeric(12,2);
    v_outstanding  numeric(12,2) := 0;
    v_advance      numeric(12,2);
    v_allocated    numeric(12,2) := 0;
    v_take         numeric(12,2);
    v_due          numeric(12,2);
    v_asset        text;
    v_settled      jsonb := '[]'::jsonb;
    inv            record;
BEGIN
    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'A payment must be more than zero' USING ERRCODE = 'check_violation';
    END IF;

    -- Same key, same money. Returning the original receipt is the only safe
    -- answer to a retry — a second receipt for one handover is the bug this
    -- whole model exists to prevent.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.fee_payments
         WHERE school_id = p_school_id AND idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'payment_id', v_existing.id,
                'receipt_number', v_existing.receipt_number,
                'amount', v_existing.amount,
                'advance', v_existing.unallocated_amount,
                'settled_invoices', '[]'::jsonb,
                'replayed', true);
        END IF;
    END IF;

    -- Oldest first, because that clears the debt accruing late fees first.
    -- Nulls last: an invoice with no due date is not more urgent than one with.
    --
    -- The sort keys are carried rather than pre-computed into a row_number:
    -- Postgres refuses FOR UPDATE alongside a window function, and the lock is
    -- the entire point of this statement. The ordering is applied on the way
    -- out, in the allocation loop below.
    CREATE TEMP TABLE IF NOT EXISTS _fee_collect_targets (
        id uuid, invoice_number text, total_amount numeric(12,2),
        amount_paid numeric(12,2), due_date date, invoice_date date
    ) ON COMMIT DROP;
    -- `WHERE true` is not decoration: Supabase enables a safe-update guard on
    -- the role PostgREST connects as, which rejects an unqualified DELETE with
    -- SQLSTATE 21000. Running this in psql as a superuser does not reproduce it,
    -- which is exactly why the money tests go through the API's own path.
    DELETE FROM _fee_collect_targets WHERE true;

    INSERT INTO _fee_collect_targets
    SELECT i.id, i.invoice_number, i.total_amount, i.amount_paid, i.due_date, i.invoice_date
      FROM public.fee_invoices i
     WHERE i.school_id = p_school_id
       AND i.student_id = p_student_id
       AND i.status IN ('unpaid', 'partial')
       AND (p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL OR i.id = ANY (p_invoice_ids))
     ORDER BY i.due_date ASC NULLS LAST, i.invoice_date ASC, i.id ASC
       FOR UPDATE OF i;

    SELECT COALESCE(sum(GREATEST(0, total_amount - amount_paid)), 0)
      INTO v_outstanding FROM _fee_collect_targets;

    v_advance := GREATEST(0, v_amount - v_outstanding);

    IF v_advance > 0 AND NOT p_allow_advance THEN
        RAISE EXCEPTION 'That is % more than the % outstanding', v_advance, v_outstanding
            USING ERRCODE = 'check_violation';
    END IF;

    -- The receipt number comes from the same race-free counter the rest of the
    -- product uses. The YEAR is the school's, not the server's: a payment taken
    -- at 09:00 IST on 1 January must not carry the previous year's prefix.
    v_receipt := public.next_document_number(
        p_school_id,
        EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int,
        'RCP', 5);

    INSERT INTO public.fee_payments (
        school_id, student_id, receipt_number, amount, method, reference,
        cheque_number, cheque_date, bank_name, notes, collected_by, idempotency_key
    ) VALUES (
        p_school_id, p_student_id, v_receipt, v_amount, p_method, p_reference,
        p_cheque_number, p_cheque_date, p_bank_name, p_notes, p_collected_by, p_idempotency_key
    ) RETURNING id INTO v_payment_id;

    v_left := v_amount;
    FOR inv IN
        SELECT * FROM _fee_collect_targets
         ORDER BY due_date ASC NULLS LAST, invoice_date ASC, id ASC
    LOOP
        EXIT WHEN v_left <= 0.001;
        v_due := round(inv.total_amount - inv.amount_paid, 2);
        CONTINUE WHEN v_due <= 0;

        v_take := LEAST(v_due, v_left);

        INSERT INTO public.fee_payment_allocations (payment_id, invoice_id, amount)
        VALUES (v_payment_id, inv.id, v_take);

        v_left      := round(v_left - v_take, 2);
        v_allocated := round(v_allocated + v_take, 2);
        v_settled   := v_settled || jsonb_build_object(
            'invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'allocated', v_take);
    END LOOP;

    -- Cash in the drawer is cash; everything else reaches a bank account.
    v_asset := CASE WHEN p_method = 'cash' THEN 'cash' ELSE 'bank' END;

    -- Dr the asset for everything received. Cr receivable for what settled a
    -- debt, Cr advance for what the school now owes the family in schooling.
    INSERT INTO public.fee_ledger_entries
        (school_id, source_type, source_id, student_id, account_code, debit, credit, memo)
    SELECT p_school_id, 'payment', v_payment_id, p_student_id, a.code, a.dr, a.cr, a.memo
      FROM (VALUES
            (v_asset,     v_amount,    0::numeric, 'Receipt via ' || p_method),
            ('receivable', 0::numeric, v_allocated, NULL),
            ('advance',    0::numeric, round(v_amount - v_allocated, 2), 'Paid ahead')
           ) AS a(code, dr, cr, memo)
     WHERE a.dr > 0 OR a.cr > 0;

    RETURN jsonb_build_object(
        'payment_id', v_payment_id,
        'receipt_number', v_receipt,
        'amount', v_amount,
        'advance', round(v_amount - v_allocated, 2),
        'settled_invoices', v_settled,
        'remaining_outstanding', GREATEST(0, round(v_outstanding - v_allocated, 2)),
        'replayed', false);
END;
$$;

COMMENT ON FUNCTION public.fee_collect_payment IS
    'Take a payment atomically: lock the open invoices, allocate oldest-first, issue one receipt, post the ledger pair. The only supported way to record money in this schema.';

-- ═══════════════════════════════════════════════════════════════════
-- BOUNCE
-- ═══════════════════════════════════════════════════════════════════
--
-- The allocations are NOT deleted. They are the record of what the cheque was
-- meant to settle, and fee_payment_effective now values a bounced payment at
-- zero, so every invoice it touched is restored by the ordinary trigger path
-- without losing the history of what happened.
--
-- That also removes the old failure mode outright: there is no longer a window
-- between "allocations gone" and "status updated" in which a payment sits
-- captured with nothing allocated, reading as a phantom advance credit.
CREATE OR REPLACE FUNCTION public.fee_bounce_payment(
    p_payment_id uuid,
    p_school_id  uuid,
    p_reason     text DEFAULT NULL,
    p_bounced_on date DEFAULT NULL,
    p_bounce_fee numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_pay       public.fee_payments%ROWTYPE;
    v_allocated numeric(12,2);
    v_advance   numeric(12,2);
    v_asset     text;
    v_count     int;
BEGIN
    SELECT * INTO v_pay FROM public.fee_payments
     WHERE id = p_payment_id AND school_id = p_school_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_pay.status = 'bounced' THEN
        RAISE EXCEPTION 'Already marked bounced' USING ERRCODE = 'check_violation';
    END IF;
    IF v_pay.status <> 'captured' THEN
        RAISE EXCEPTION 'This payment is %. Only a captured payment can bounce.', v_pay.status
            USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(v_pay.refunded_amount, 0) > 0 THEN
        RAISE EXCEPTION 'Part of this payment has been refunded. Sort the refund out before recording a bounce.'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(sum(amount), 0), count(*) INTO v_allocated, v_count
      FROM public.fee_payment_allocations WHERE payment_id = p_payment_id;

    v_advance := COALESCE(v_pay.unallocated_amount, 0);
    v_asset   := CASE WHEN v_pay.method = 'cash' THEN 'cash' ELSE 'bank' END;

    UPDATE public.fee_payments
       SET status        = 'bounced',
           bounced_on    = COALESCE(p_bounced_on, (now() AT TIME ZONE 'Asia/Kolkata')::date),
           bounce_reason = p_reason,
           bounce_fee    = COALESCE(p_bounce_fee, 0)
     WHERE id = p_payment_id;

    -- The exact mirror of the payment posting. Not a refund: a refund is the
    -- school choosing to give money back, a bounce is the bank saying the credit
    -- was never good. The two are reported separately.
    INSERT INTO public.fee_ledger_entries
        (school_id, source_type, source_id, student_id, account_code, debit, credit, memo)
    SELECT p_school_id, 'payment', p_payment_id, v_pay.student_id, a.code, a.dr, a.cr, a.memo
      FROM (VALUES
            ('receivable', v_allocated, 0::numeric, 'Cheque dishonoured'),
            ('advance',    v_advance,   0::numeric, 'Advance reversed'),
            (v_asset,      0::numeric,  round(v_allocated + v_advance, 2), 'Bounced ' || v_pay.method)
           ) AS a(code, dr, cr, memo)
     WHERE a.dr > 0 OR a.cr > 0;

    RETURN jsonb_build_object(
        'payment_id', p_payment_id,
        'reversed', round(v_allocated + v_advance, 2),
        'restored_invoices', v_count,
        'bounce_fee', COALESCE(p_bounce_fee, 0));
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- CARRY FORWARD
-- ═══════════════════════════════════════════════════════════════════
--
-- The old shape could double-count permanently and a retry could not fix it.
-- The arrears upsert succeeded, one chunk of invoice-retirement updates failed
-- with no error check, and the same rupees then existed in fee_arrears AND as
-- unpaid invoices — in /dues, /aging-report and /defaulters at once, which is
-- precisely the double-count this model was built to prevent.
--
-- It did not self-heal either: ignoreDuplicates meant a re-run returned only NEW
-- rows, and the set of invoices to close was derived from that result, so the
-- stranded ones were never closed by any retry.
--
-- One transaction, and the invoices are closed from the ARREARS table rather
-- than from the insert's return value, so a re-run repairs whatever the first
-- run left behind.
CREATE OR REPLACE FUNCTION public.fee_carry_forward_arrears(
    p_school_id uuid,
    p_from_year uuid,
    p_to_year   uuid,
    p_user_id   uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_created int := 0;
    v_closed  int := 0;
    v_total   numeric(12,2) := 0;
BEGIN
    IF p_from_year = p_to_year THEN
        RAISE EXCEPTION 'The two years must be different' USING ERRCODE = 'check_violation';
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _fee_carry_targets (
        id uuid, student_id uuid, remaining numeric(12,2)
    ) ON COMMIT DROP;
    -- `WHERE true` is not decoration: Supabase enables a safe-update guard on
    -- the role PostgREST connects as, which rejects an unqualified DELETE with
    -- SQLSTATE 21000. Running this in psql as a superuser does not reproduce it,
    -- which is exactly why the money tests go through the API's own path.
    DELETE FROM _fee_carry_targets WHERE true;

    INSERT INTO _fee_carry_targets
    SELECT i.id, i.student_id, round(i.total_amount - i.amount_paid, 2)
      FROM public.fee_invoices i
     WHERE i.school_id = p_school_id
       AND i.academic_year_id = p_from_year
       AND i.status IN ('unpaid', 'partial')
       AND round(i.total_amount - i.amount_paid, 2) > 0
     ORDER BY i.id
       FOR UPDATE OF i;

    SELECT COALESCE(sum(remaining), 0) INTO v_total FROM _fee_carry_targets;

    INSERT INTO public.fee_arrears
        (school_id, student_id, from_academic_year_id, to_academic_year_id,
         source_invoice_id, amount, carried_forward_by)
    SELECT p_school_id, t.student_id, p_from_year, p_to_year, t.id, t.remaining, p_user_id
      FROM _fee_carry_targets t
    ON CONFLICT (source_invoice_id, to_academic_year_id) DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;

    -- Closed from the arrears table, not from the insert's result. Anything a
    -- previous half-run stranded is picked up here.
    UPDATE public.fee_invoices i
       SET status = 'carried_forward'
      FROM public.fee_arrears a
     WHERE a.source_invoice_id = i.id
       AND a.to_academic_year_id = p_to_year
       AND i.school_id = p_school_id
       AND i.academic_year_id = p_from_year
       AND i.status IN ('unpaid', 'partial');

    GET DIAGNOSTICS v_closed = ROW_COUNT;

    RETURN jsonb_build_object(
        'carried_forward', v_created,
        'invoices_closed', v_closed,
        'total_amount', v_total);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- MIGRATING THE EXISTING LEDGER ONTO THE ACCRUAL BASIS
-- ═══════════════════════════════════════════════════════════════════
--
-- Two steps, both arithmetic-preserving — the journal balances to 0.00 before
-- and after.
--
-- Guarded, because it is a ONE-TIME data migration and the migration that
-- follows this one makes fee_ledger_entries append-only. Re-running the file
-- after that lands on the immutability trigger, which is the trigger doing its
-- job — so the block skips itself once that trigger exists.
DO $migrate$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fee_ledger_append_only') THEN
        RAISE NOTICE 'Ledger already migrated to the accrual basis and sealed; skipping.';
        RETURN;
    END IF;

    -- Step 1: every payment credit currently names an income account. Under accrual
    -- the income was recognised when the invoice was raised, so what a payment
    -- settles is the RECEIVABLE.
    UPDATE public.fee_ledger_entries
       SET account_code = 'receivable'
     WHERE source_type = 'payment'
       AND credit > 0
       AND account_code IN ('fee_income', 'late_fee_income');

    -- Step 2: the invoices that were never posted at all. One balanced triple per
    -- live invoice, dated to the invoice rather than to now, so the trend of income
    -- follows when the school actually billed.
    INSERT INTO public.fee_ledger_entries
        (school_id, entry_date, source_type, source_id, student_id, account_code, debit, credit, memo)
    SELECT i.school_id, i.invoice_date::timestamptz, 'invoice', i.id, i.student_id,
           e.code, e.dr, e.cr, e.memo
      FROM public.fee_invoices i
     CROSS JOIN LATERAL (VALUES
            ('receivable',      i.total_amount, 0::numeric,                        'Invoice ' || i.invoice_number),
            ('fee_income',      0::numeric,     round(i.total_amount - i.late_fee, 2), NULL),
            ('late_fee_income', 0::numeric,     round(i.late_fee, 2),              'Late fine')
           ) AS e(code, dr, cr, memo)
     WHERE i.status <> 'cancelled'
       AND (e.dr > 0 OR e.cr > 0)
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger_entries l
                        WHERE l.source_type = 'invoice' AND l.source_id = i.id);
END $migrate$;
