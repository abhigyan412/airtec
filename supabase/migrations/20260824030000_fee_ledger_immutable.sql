-- The ledger stops being editable.
--
-- A journal you can UPDATE is not a journal. Everything downstream of
-- fee_ledger_entries — the trial balance, the reconciliation report, any future
-- chart of accounts — rests on the assumption that a posted entry is a
-- historical fact, and nothing enforced it: a stray UPDATE could rewrite last
-- year's income and the totals would still balance.
--
-- Corrections go the way they go on paper: post the opposite entry. postBounce,
-- postRefund and postInvoiceReversal already work this way, so this constrains
-- the table to what the application already does.
--
-- Deliberately AFTER 20260816010000, which migrates the historical entries onto
-- the accrual basis. That migration is the last write of this kind that will
-- ever be possible, which is the point.

CREATE OR REPLACE FUNCTION public.fee_ledger_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'fee_ledger_entries is append-only. To correct a posting, post the reversing entry.'
        USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS fee_ledger_append_only ON public.fee_ledger_entries;

CREATE TRIGGER fee_ledger_append_only
    BEFORE UPDATE OR DELETE ON public.fee_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.fee_ledger_is_append_only();

COMMENT ON TRIGGER fee_ledger_append_only ON public.fee_ledger_entries IS
    'Refuses UPDATE and DELETE. A journal entry is a historical fact; corrections are reversing entries.';

-- ═══════════════════════════════════════════════════════════════════
-- RECONCILIATION
-- ═══════════════════════════════════════════════════════════════════
--
-- The three questions nobody could ask, because nothing read this table.
--
--   1. Do the books balance?          sum(debit) - sum(credit) must be 0.00
--   2. Does the ledger agree with     receivable balance must equal the
--      the invoices?                  outstanding across live invoices
--   3. Does it agree with the cash?   cash + bank must equal what was collected
--
-- Each returns the two figures and their difference rather than a bare pass or
-- fail, because "off by ₹4,200" is actionable and "FAIL" is not.
CREATE OR REPLACE FUNCTION public.fee_reconciliation(p_school_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    WITH led AS (
        SELECT COALESCE(sum(debit), 0)  AS dr,
               COALESCE(sum(credit), 0) AS cr,
               COALESCE(sum(debit) FILTER (WHERE account_code = 'receivable'), 0)
             - COALESCE(sum(credit) FILTER (WHERE account_code = 'receivable'), 0) AS receivable,
               COALESCE(sum(debit) FILTER (WHERE account_code IN ('cash','bank')), 0)
             - COALESCE(sum(credit) FILTER (WHERE account_code IN ('cash','bank')), 0) AS cash_bank,
               count(*) AS entries
          FROM public.fee_ledger_entries
         WHERE school_id = p_school_id
    ),
    inv AS (
        -- 'waived' invoices are excluded from what is owed but their write-off
        -- has already been posted, so they net out of receivable correctly.
        SELECT COALESCE(sum(GREATEST(0, total_amount - amount_paid))
                        FILTER (WHERE status IN ('unpaid','partial')), 0) AS outstanding,
               COALESCE(sum(amount_paid), 0)                              AS collected
          FROM public.fee_invoices
         WHERE school_id = p_school_id AND status <> 'cancelled'
    ),
    pay AS (
        SELECT COALESCE(sum(public.fee_payment_effective(status, amount, refunded_amount)), 0) AS received
          FROM public.fee_payments
         WHERE school_id = p_school_id
    )
    SELECT jsonb_build_object(
        'entries', led.entries,
        'balanced', jsonb_build_object(
            'debit',  round(led.dr, 2),
            'credit', round(led.cr, 2),
            'difference', round(led.dr - led.cr, 2),
            'ok', abs(led.dr - led.cr) < 0.01),
        'receivable_vs_invoices', jsonb_build_object(
            'ledger', round(led.receivable, 2),
            'invoices', round(inv.outstanding, 2),
            'difference', round(led.receivable - inv.outstanding, 2),
            'ok', abs(led.receivable - inv.outstanding) < 0.01),
        'cash_vs_payments', jsonb_build_object(
            'ledger', round(led.cash_bank, 2),
            'payments', round(pay.received, 2),
            'difference', round(led.cash_bank - pay.received, 2),
            'ok', abs(led.cash_bank - pay.received) < 0.01))
      FROM led, inv, pay;
$$;

COMMENT ON FUNCTION public.fee_reconciliation IS
    'Three invariants over fee_ledger_entries, with the two sides and their difference. Every ok must be true.';
