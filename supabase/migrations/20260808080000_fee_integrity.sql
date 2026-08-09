-- Fee integrity: make the invoice balance a fact of the database.
--
-- Nine route handlers each re-derived "how much is still owed" from
-- fee_payments, and they did not agree. The worst consequences:
--
--   * Recording a payment was insert -> read all payments -> update status,
--     three un-transactioned round-trips. Two cashiers recording at the same
--     moment both read the pre-insert total and both wrote 'partial', so an
--     invoice paid in full stayed open.
--   * Nothing capped a payment at the outstanding balance. POST /fees/payments
--     accepted 50,000 against a 5,000 invoice and flipped it to 'paid'.
--     (The arrears endpoint did check. The invoice one never did.)
--   * Every dues/aging/defaulter request re-summed fee_payments for every open
--     invoice, in 150-id chunks, before it could show a single row. That is why
--     none of those endpoints could be paginated.
--
-- All three are the same missing thing: fee_invoices has no balance column.
-- This adds one and lets the database maintain it, in the same transaction as
-- the payment that changes it.
--
-- Also here, because they are the same class of "the schema does not enforce
-- what the code assumes":
--   * period_key, so a billing run cannot bill the same student twice
--   * a terminal 'carried_forward' status, so arrears stop double-counting
--   * per-school uniqueness on generated document numbers

-- ── 1. Money columns get a scale ─────────────────────────────────────
--
-- These were bare `numeric` (arbitrary precision) while the code compared them
-- with JS floats. `totalPaid >= invoice.total_amount` on values that had been
-- through a percentage-discount division is exactly the shape that decides an
-- invoice is unpaid by 0.0000000001. Two decimal places is what a rupee amount
-- is; store it that way and the comparison is exact.

ALTER TABLE public.fee_invoices
    ALTER COLUMN subtotal       TYPE numeric(12,2),
    ALTER COLUMN total_discount TYPE numeric(12,2),
    ALTER COLUMN late_fine      TYPE numeric(12,2),
    ALTER COLUMN total_amount   TYPE numeric(12,2);

ALTER TABLE public.fee_payments
    ALTER COLUMN amount_paid TYPE numeric(12,2);

-- ── 2. The balance column ────────────────────────────────────────────

ALTER TABLE public.fee_invoices
    ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.fee_invoices.amount_paid IS
    'Sum of fee_payments for this invoice. Maintained by trigger — never write it from application code. Remaining balance is total_amount - amount_paid.';

-- Backfill from the payments that already exist.
UPDATE public.fee_invoices i
   SET amount_paid = COALESCE(p.total, 0)
  FROM (SELECT invoice_id, sum(amount_paid) AS total
          FROM public.fee_payments
         GROUP BY invoice_id) p
 WHERE p.invoice_id = i.id;

-- ── 3. Terminal statuses ─────────────────────────────────────────────
--
-- 'carried_forward' marks an invoice whose remaining balance has been moved
-- into fee_arrears for the next academic year. Before this, carry-forward
-- created the arrear and left the source invoice 'unpaid', so the same rupees
-- were counted twice — once in /fees/dues, /aging-report, /defaulters and
-- stats.total_due, and again in /fees/arrears. Every one of those queries
-- filters `status IN ('unpaid','partial')`, so a new terminal status removes
-- the double-count everywhere at once without touching those filters.

ALTER TABLE public.fee_invoices DROP CONSTRAINT IF EXISTS fee_invoices_status_check;
ALTER TABLE public.fee_invoices ADD CONSTRAINT fee_invoices_status_check
    CHECK (status = ANY (ARRAY['unpaid','partial','paid','cancelled','waived','carried_forward']));

-- ── 4. Status is derived, not asserted ───────────────────────────────
--
-- Open statuses (unpaid/partial/paid) are a pure function of amount_paid vs
-- total_amount, so the database computes them. The other three are decisions a
-- human made — cancelled, waived, carried_forward — and must survive a payment
-- or a total_amount change, so they are left alone.

CREATE OR REPLACE FUNCTION public.fee_invoice_derive_status(
    p_status       text,
    p_total_amount numeric,
    p_amount_paid  numeric
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_status IN ('cancelled','waived','carried_forward') THEN p_status
        WHEN p_amount_paid <= 0                THEN 'unpaid'
        WHEN p_amount_paid >= p_total_amount   THEN 'paid'
        ELSE 'partial'
    END;
$$;

-- Fires when total_amount moves under a fixed amount_paid — a discount being
-- approved retroactively, or a late fine being applied. Without this, those two
-- routes had to re-derive status by hand, and one of them (the discount path)
-- got it right while the other never recomputed it at all.
CREATE OR REPLACE FUNCTION public.fee_invoices_sync_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.status := public.fee_invoice_derive_status(NEW.status, NEW.total_amount, NEW.amount_paid);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_invoices_sync_status ON public.fee_invoices;
CREATE TRIGGER fee_invoices_sync_status
    BEFORE INSERT OR UPDATE OF total_amount, amount_paid, status
    ON public.fee_invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.fee_invoices_sync_status();

-- ── 5. Payments maintain the balance ─────────────────────────────────
--
-- Recomputes as a sum rather than `amount_paid + NEW.amount_paid`: an
-- incremental delta drifts the moment a payment is corrected or deleted, and
-- the sum is a single indexed lookup on idx_fee_payments_invoice.
--
-- Runs inside the payment's own transaction, which is what makes concurrent
-- cashiers safe: the second insert cannot read a stale total, because the row
-- update serialises them.

CREATE OR REPLACE FUNCTION public.fee_payments_apply_to_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice_id uuid;
    v_paid       numeric(12,2);
    v_total      numeric(12,2);
    v_status     text;
BEGIN
    -- On UPDATE the payment may have been moved between invoices, so both the
    -- old and the new invoice need recomputing.
    FOREACH v_invoice_id IN ARRAY (
        CASE
            WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.invoice_id]
            WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.invoice_id]
            WHEN NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
                 THEN ARRAY[OLD.invoice_id, NEW.invoice_id]
            ELSE ARRAY[NEW.invoice_id]
        END
    )
    LOOP
        SELECT COALESCE(sum(amount_paid), 0) INTO v_paid
          FROM public.fee_payments WHERE invoice_id = v_invoice_id;

        SELECT total_amount, status INTO v_total, v_status
          FROM public.fee_invoices WHERE id = v_invoice_id
          FOR UPDATE;

        -- Overpayment is refused here rather than in each route, so it holds for
        -- every path that inserts a payment — the invoice endpoint, the
        -- installment endpoint, a seed script, a manual fix in the SQL editor.
        -- A 0.01 tolerance absorbs the rounding a percentage discount leaves
        -- behind; anything larger is a real mistake and the caller should hear
        -- about it. Statuses that are no longer collecting are exempt: a payment
        -- against a waived invoice is a data-entry question, not an arithmetic
        -- one, and blocking it here would be confusing.
        IF v_status NOT IN ('cancelled','waived','carried_forward')
           AND v_paid > v_total + 0.01 THEN
            RAISE EXCEPTION
                'Payment exceeds the invoice balance: paid % against a total of % (over by %)',
                v_paid, v_total, v_paid - v_total
                USING ERRCODE = 'check_violation';
        END IF;

        UPDATE public.fee_invoices
           SET amount_paid = v_paid,
               updated_at  = now()
         WHERE id = v_invoice_id;
        -- status follows via fee_invoices_sync_status
    END LOOP;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fee_payments_apply_to_invoice ON public.fee_payments;
CREATE TRIGGER fee_payments_apply_to_invoice
    AFTER INSERT OR UPDATE OR DELETE
    ON public.fee_payments
    FOR EACH ROW
    EXECUTE FUNCTION public.fee_payments_apply_to_invoice();

-- Bring existing rows in line with the derivation now that it is authoritative.
-- (Any invoice whose stored status disagreed with its payments — which the old
-- race could produce — is corrected here.)
UPDATE public.fee_invoices
   SET status = public.fee_invoice_derive_status(status, total_amount, amount_paid)
 WHERE status <> public.fee_invoice_derive_status(status, total_amount, amount_paid);

-- ── 6. Billing period identity ───────────────────────────────────────
--
-- There is no terms table in this schema, so a billing period is derived from
-- fee_structures.frequency and the academic year's own start/end dates, then
-- stored as `frequency:token`:
--
--     monthly:2025-07     quarterly:Q2     half_yearly:H1     annually:full
--
-- The academic year is NOT part of the key text — the index below already
-- scopes by academic_year_id, and folding a renameable name into the key would
-- mean renaming "2025-26" to "2025-2026" silently unlocks billing every student
-- a second time. See backend/src/modules/fee/lib/billingPeriod.ts.
--
-- The partial unique index is what makes a bulk billing run idempotent — a
-- double-submitted run, or a re-run to pick up newly admitted students, inserts
-- only what is missing instead of billing everyone twice. Cancelled invoices are
-- excluded so a mistaken run can be voided and redone.
--
-- NULL period_key = an invoice raised outside a billing run (single-student,
-- mid-year joiner, manual correction); those are intentionally unconstrained.

ALTER TABLE public.fee_invoices ADD COLUMN IF NOT EXISTS period_key text;

CREATE UNIQUE INDEX IF NOT EXISTS fee_invoices_student_period_uniq
    ON public.fee_invoices (school_id, student_id, academic_year_id, period_key)
    WHERE period_key IS NOT NULL AND status <> 'cancelled';

-- ── 7. Document numbers are per-school ───────────────────────────────
--
-- next_document_number() counts per (school, year, prefix) but formats the
-- result as PREFIX || year || n with no school component — so the second school
-- to raise its first invoice of the year also generates INV202500001, and the
-- GLOBAL unique constraint rejects it. The counter is right; the constraint was
-- scoped wrong. Same for receipts.

ALTER TABLE public.fee_invoices DROP CONSTRAINT IF EXISTS fee_invoices_invoice_number_key;
ALTER TABLE public.fee_invoices DROP CONSTRAINT IF EXISTS fee_invoices_school_invoice_number_key;
ALTER TABLE public.fee_invoices ADD CONSTRAINT fee_invoices_school_invoice_number_key
    UNIQUE (school_id, invoice_number);

ALTER TABLE public.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_receipt_number_key;
ALTER TABLE public.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_school_receipt_number_key;
ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_school_receipt_number_key
    UNIQUE (school_id, receipt_number);

-- ── 8. Indexes for the paginated recovery queries ────────────────────
--
-- idx_fee_invoices_status is a single-column index on a four-value column, so
-- it is close to useless for "this school's open invoices, oldest due first" —
-- the shape every dues/aging/defaulter query has. These cover it.

CREATE INDEX IF NOT EXISTS idx_fee_invoices_school_status_due
    ON public.fee_invoices (school_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_fee_invoices_school_year_status
    ON public.fee_invoices (school_id, academic_year_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_arrears_school_status
    ON public.fee_arrears (school_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_discounts_student_active
    ON public.fee_discounts (student_id, approval_status)
    WHERE is_active = true;
