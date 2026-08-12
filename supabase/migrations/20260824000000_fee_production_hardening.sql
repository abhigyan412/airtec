-- Making the fee model hold under concurrency, and giving it back its indexes.
--
-- The assignment/allocation model is right. Three things about its IMPLEMENTATION
-- are not, and all three are invisible on seeded data with one user clicking:
--
-- 1. LOCK ORDERING. fee_recalc_invoice aggregates the allocations and THEN takes
--    the row lock. Under READ COMMITTED that is the wrong way round: two cashiers
--    taking the same fee at the same moment each compute a stale total, the lock
--    serialises the writes but not the decisions, and the overpayment guard waves
--    both through. Money is receipted into no invoice and no advance. The fix is
--    three lines — lock, then aggregate — and it is the highest-value change in
--    this file.
--
-- 2. LOCK ORDER, the other kind. fee_allocations_changed locked the invoice then
--    the payment; fee_payment_changed locked the payment then the invoice. Two
--    sessions doing both at once deadlock. Every path here now takes payments
--    before invoices, each set in id order.
--
-- 3. INDEXES. 20260808080000_fee_integrity.sql added three indexes specifically
--    for the dues/aging/defaulter queries. Six hours later in migration-timestamp
--    terms, 20260809000000_fee_model_rewrite.sql DROP TABLE ... CASCADEd the
--    tables underneath them and never recreated them. Eleven useful indexes went
--    that way. fee_discounts, fee_adhoc_charges and fee_scholarships are today
--    primary-key-only; fee_arrears has no query index at all.
--
-- Plus the smaller things that were only ever true by luck: 'bounced' predates
-- fee_payment_effective and was never taught to it, so a dishonoured cheque still
-- counted as paid; a waived late fee left no record, so the next sweep re-applied
-- it; and deleting a student took their financial history with them.

-- ═══════════════════════════════════════════════════════════════════
-- 1. THE TRIGGER FUNCTIONS — lock first, then read
-- ═══════════════════════════════════════════════════════════════════

-- A dishonoured payment is not money. It was missing from this function because
-- 'bounced' was added a migration later than the function was written, and
-- nothing failed loudly: the allocations stayed, so the invoice went on
-- reporting itself paid with money the bank had taken back.
--
-- Treating it here rather than by deleting the allocation rows is deliberate.
-- The allocations are the record of what the cheque was meant to settle, and a
-- bounce should not erase that — it should make it worth nothing.
CREATE OR REPLACE FUNCTION public.fee_payment_effective(
    p_status text, p_amount numeric, p_refunded numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_status IN ('cancelled', 'bounced') THEN 0
        ELSE GREATEST(0, p_amount - COALESCE(p_refunded, 0))
    END;
$$;

-- Lock, then aggregate.
--
-- The previous order let two transactions each read the allocations before
-- either took the lock, so both computed the same stale v_paid, both passed the
-- guard, and the second UPDATE overwrote the first. Worked example: one unpaid
-- ₹5,000 invoice, two cashiers each taking ₹5,000. Both sum ₹5,000, both write
-- amount_paid = 5000, and ₹5,000 of receipted cash settles nothing anywhere.
--
-- With the lock first, the second transaction blocks until the first commits and
-- then re-reads a total that includes it, which is what makes the guard mean
-- something.
CREATE OR REPLACE FUNCTION public.fee_recalc_invoice(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_paid   numeric(12,2);
    v_total  numeric(12,2);
    v_status text;
BEGIN
    SELECT total_amount, status INTO v_total, v_status
      FROM public.fee_invoices
     WHERE id = p_invoice_id
       FOR UPDATE;

    -- The invoice went away underneath us (a cascade, a concurrent delete).
    -- Nothing to maintain.
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE(sum(
             a.amount * CASE WHEN p.amount = 0 THEN 0
                        ELSE public.fee_payment_effective(p.status, p.amount, p.refunded_amount) / p.amount END
           ), 0)
      INTO v_paid
      FROM public.fee_payment_allocations a
      JOIN public.fee_payments p ON p.id = a.payment_id
     WHERE a.invoice_id = p_invoice_id;

    IF v_status NOT IN ('cancelled', 'waived', 'carried_forward')
       AND v_paid > v_total + 0.01 THEN
        RAISE EXCEPTION
            'Allocations exceed the invoice: % against a total of %', v_paid, v_total
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.fee_invoices SET amount_paid = v_paid WHERE id = p_invoice_id;
END;
$$;

-- Same defect, one notch worse: this function took no lock at all, so two
-- allocations of the same payment against different invoices could both pass the
-- "allocated exceeds the payment" guard and the payment would report an advance
-- balance it does not hold.
CREATE OR REPLACE FUNCTION public.fee_sync_unallocated(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_amount numeric(12,2);
    v_alloc  numeric(12,2);
BEGIN
    SELECT amount INTO v_amount
      FROM public.fee_payments
     WHERE id = p_payment_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_alloc
      FROM public.fee_payment_allocations
     WHERE payment_id = p_payment_id;

    IF v_alloc > v_amount + 0.01 THEN
        RAISE EXCEPTION 'Allocated % exceeds the payment of %', v_alloc, v_amount
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.fee_payments
       SET unallocated_amount = GREATEST(0, v_amount - v_alloc)
     WHERE id = p_payment_id
       AND unallocated_amount IS DISTINCT FROM GREATEST(0, v_amount - v_alloc);
END;
$$;

-- One lock order for the whole module: PAYMENTS first, then INVOICES, each set
-- in id order.
--
-- This function used to do it invoice-then-payment while fee_payment_changed did
-- payment-then-invoice. Two sessions allocating against the same pair in
-- opposite directions deadlock, and a deadlock on the payment path surfaces to a
-- cashier as "could not allocate the payment" with the money already in the till.
CREATE OR REPLACE FUNCTION public.fee_allocations_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_payments uuid[];
    v_invoices uuid[];
    v_id       uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_payments := ARRAY[NEW.payment_id];
        v_invoices := ARRAY[NEW.invoice_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_payments := ARRAY[OLD.payment_id];
        v_invoices := ARRAY[OLD.invoice_id];
    ELSE
        v_payments := ARRAY[NEW.payment_id, OLD.payment_id];
        v_invoices := ARRAY[NEW.invoice_id, OLD.invoice_id];
    END IF;

    FOR v_id IN SELECT DISTINCT u FROM unnest(v_payments) u WHERE u IS NOT NULL ORDER BY 1
    LOOP
        PERFORM public.fee_sync_unallocated(v_id);
    END LOOP;

    FOR v_id IN SELECT DISTINCT u FROM unnest(v_invoices) u WHERE u IS NOT NULL ORDER BY 1
    LOOP
        PERFORM public.fee_recalc_invoice(v_id);
    END LOOP;

    RETURN NULL;
END;
$$;

-- Already payment-then-invoice; the loop just needed an ORDER BY so two payments
-- touching the same two invoices walk them the same way round.
CREATE OR REPLACE FUNCTION public.fee_payment_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inv uuid;
BEGIN
    PERFORM public.fee_sync_unallocated(NEW.id);

    FOR v_inv IN
        SELECT DISTINCT invoice_id
          FROM public.fee_payment_allocations
         WHERE payment_id = NEW.id
         ORDER BY 1
    LOOP
        PERFORM public.fee_recalc_invoice(v_inv);
    END LOOP;

    RETURN NULL;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. CLAIMING AN ORDER BEFORE CAPTURING IT
-- ═══════════════════════════════════════════════════════════════════
--
-- Providers retry. Razorpay fires payment.captured more than once as normal
-- behaviour, and both deliveries used to read status='created', both pass the
-- guard, and both call collectPayment — ₹18,000 charged once and ₹36,000
-- recorded, with two receipts and one orphan.
--
-- 'capturing' is the claim. The capture path now moves the order into it with a
-- conditional UPDATE, which is atomic, so the second delivery matches zero rows
-- and returns 200 "already" without doing any work.
ALTER TABLE public.fee_payment_orders
    DROP CONSTRAINT IF EXISTS fee_payment_orders_status_check;

ALTER TABLE public.fee_payment_orders
    ADD CONSTRAINT fee_payment_orders_status_check CHECK (
        status = ANY (ARRAY['created', 'capturing', 'paid', 'failed', 'expired']));

-- ═══════════════════════════════════════════════════════════════════
-- 3. A WAIVED LATE FEE HAS TO LEAVE A MARK
-- ═══════════════════════════════════════════════════════════════════
--
-- Approving a waiver set late_fee back to 0 and recorded the forgiveness
-- nowhere. The nightly sweep then recomputed the same fine from the same overdue
-- date and put it straight back, so a family was chased for money the school had
-- formally written off and the ledger disagreed with the invoice.
--
-- The sweep now subtracts this column from whatever it computes, so a forgiven
-- fine stays forgiven while the invoice goes on ageing normally.
ALTER TABLE public.fee_invoices
    ADD COLUMN IF NOT EXISTS late_fee_waived numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_invoices_late_fee_waived_check') THEN
        ALTER TABLE public.fee_invoices
            ADD CONSTRAINT fee_invoices_late_fee_waived_check CHECK (late_fee_waived >= 0);
    END IF;
END $$;

COMMENT ON COLUMN public.fee_invoices.late_fee_waived IS
    'Cumulative late fine forgiven on this invoice. The late-fee sweep deducts it, so an approved waiver is never silently re-applied.';

-- ═══════════════════════════════════════════════════════════════════
-- 4. FINANCIAL RECORDS ARE NOT THE STUDENT'S TO TAKE WITH THEM
-- ═══════════════════════════════════════════════════════════════════
--
-- fee_invoices.student_id and fee_payments.student_id were ON DELETE CASCADE.
-- Removing one child's record erased every invoice, every payment and every
-- receipt number issued to that family — the receipt numbers most of all, since
-- they are a gapless sequence a school is required to be able to produce.
--
-- RESTRICT instead: a student with financial history cannot be deleted, only
-- marked inactive, which is what the product already does everywhere else.
ALTER TABLE public.fee_invoices
    DROP CONSTRAINT IF EXISTS fee_invoices_student_id_fkey;
ALTER TABLE public.fee_invoices
    ADD CONSTRAINT fee_invoices_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

ALTER TABLE public.fee_payments
    DROP CONSTRAINT IF EXISTS fee_payments_student_id_fkey;
ALTER TABLE public.fee_payments
    ADD CONSTRAINT fee_payments_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

-- ═══════════════════════════════════════════════════════════════════
-- 5. ARREARS IDEMPOTENCY THAT ACTUALLY HOLDS
-- ═══════════════════════════════════════════════════════════════════
--
-- The unique on (source_invoice_id, to_academic_year_id) is what stops a re-run
-- of carry-forward doubling everyone's arrears. It was defeated by its own
-- column definition: source_invoice_id was nullable with ON DELETE SET NULL, and
-- in Postgres NULL never conflicts with NULL — so the moment a source invoice
-- was deleted, the row it left behind could be carried forward again, and again.
--
-- An arrear with no source is not a meaningful record anyway: it is a balance
-- with nothing to point at when a parent asks what it is for.
ALTER TABLE public.fee_arrears
    DROP CONSTRAINT IF EXISTS fee_arrears_source_invoice_id_fkey;

DELETE FROM public.fee_arrears WHERE source_invoice_id IS NULL;

ALTER TABLE public.fee_arrears
    ALTER COLUMN source_invoice_id SET NOT NULL;

ALTER TABLE public.fee_arrears
    ADD CONSTRAINT fee_arrears_source_invoice_id_fkey
    FOREIGN KEY (source_invoice_id) REFERENCES public.fee_invoices(id) ON DELETE RESTRICT;

-- ═══════════════════════════════════════════════════════════════════
-- 6. CONCESSION RULES — the uniques were left behind by a later change
-- ═══════════════════════════════════════════════════════════════════
--
-- 20260814 made fee_category nullable so a rule could key on sibling order
-- alone. The two partial uniques were not extended, and because they key on
-- fee_category, ten identical "second child, 10% off" rules became insertable —
-- and they stack, so the second child gets 100% off and nobody can say why.
DROP INDEX IF EXISTS public.fee_concession_rules_head_uniq;
DROP INDEX IF EXISTS public.fee_concession_rules_all_heads_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS fee_concession_rules_head_uniq
    ON public.fee_concession_rules (
        school_id, academic_year_id,
        coalesce(fee_category, ''), coalesce(min_sibling_order, 0), fee_head_id)
    WHERE fee_head_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fee_concession_rules_all_heads_uniq
    ON public.fee_concession_rules (
        school_id, academic_year_id,
        coalesce(fee_category, ''), coalesce(min_sibling_order, 0))
    WHERE fee_head_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 7. THE ELEVEN LOST INDEXES, AND THE ONES THAT WERE NEVER THERE
-- ═══════════════════════════════════════════════════════════════════
--
-- Recreated from 20260808080000_fee_integrity.sql, 20260808090000, 20260808120000
-- and the baseline, against the tables the rewrite replaced them with.

-- The billing resolver's exact access pattern, and the one the fee_integrity
-- migration was written to add. Its loss made every invoice generation run a
-- sequential scan of fee_discounts per student batch.
CREATE INDEX IF NOT EXISTS idx_fee_discounts_student_active
    ON public.fee_discounts (student_id, approval_status)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_fee_discounts_school_status
    ON public.fee_discounts (school_id, approval_status, created_at DESC);

-- fee_assignments is the module's hottest lookup table — the nightly reminder
-- sweep, /defaulters, /by-category and the forecast all read it by school — and
-- it had a primary key and one unique on (student_id, academic_year_id). Nothing
-- covering school_id at all.
CREATE INDEX IF NOT EXISTS idx_fee_assignments_school_year_status
    ON public.fee_assignments (school_id, academic_year_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_assignments_structure
    ON public.fee_assignments (structure_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_assignments_category
    ON public.fee_assignments (school_id, fee_category, status);

CREATE INDEX IF NOT EXISTS idx_fee_invoices_school_year_status
    ON public.fee_invoices (school_id, academic_year_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_arrears_school_status
    ON public.fee_arrears (school_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_arrears_student
    ON public.fee_arrears (student_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_adhoc_school_status
    ON public.fee_adhoc_charges (school_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_adhoc_student
    ON public.fee_adhoc_charges (student_id)
    WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_adhoc_invoice
    ON public.fee_adhoc_charges (invoice_id)
    WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_scholarships_student
    ON public.fee_scholarships (student_id);

CREATE INDEX IF NOT EXISTS idx_fee_scholarships_school
    ON public.fee_scholarships (school_id, academic_year_id);

CREATE INDEX IF NOT EXISTS idx_fee_action_requests_student
    ON public.fee_action_requests (student_id, status);

-- The allocation join runs in both directions: by invoice when recalculating,
-- by payment when reversing a bounce. Only the first had an index.
CREATE INDEX IF NOT EXISTS idx_fee_alloc_payment
    ON public.fee_payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_student
    ON public.fee_ledger_entries (school_id, student_id, entry_date DESC)
    WHERE student_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 8. THE LEDGER'S VOCABULARY, ENFORCED WHERE IT CANNOT DRIFT
-- ═══════════════════════════════════════════════════════════════════
--
-- account_code and source_type are the two columns a future chart of accounts
-- will map from. They were free text: one typo in a posting site and the trial
-- balance grows an account nobody planned, silently, and it still balances.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_ledger_account_code_check') THEN
        ALTER TABLE public.fee_ledger_entries
            ADD CONSTRAINT fee_ledger_account_code_check CHECK (account_code = ANY (
                ARRAY['cash','bank','fee_income','late_fee_income','receivable','advance','refund']));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_ledger_source_type_check') THEN
        ALTER TABLE public.fee_ledger_entries
            ADD CONSTRAINT fee_ledger_source_type_check CHECK (source_type = ANY (
                ARRAY['invoice','payment','refund','waiver','writeoff']));
    END IF;
END $$;

-- The ledger has been write-only since it was built: every posting site writes
-- to it and nothing reads it back, so "do the books balance" was a question with
-- no way to ask it. This is that question, as one row per account.
CREATE OR REPLACE VIEW public.fee_trial_balance AS
    SELECT school_id,
           account_code,
           round(sum(debit), 2)               AS total_debit,
           round(sum(credit), 2)              AS total_credit,
           round(sum(debit) - sum(credit), 2) AS balance,
           count(*)                           AS entries
      FROM public.fee_ledger_entries
     GROUP BY school_id, account_code;

COMMENT ON VIEW public.fee_trial_balance IS
    'Per-account totals from fee_ledger_entries. Summing balance across all accounts for one school must be exactly 0.00; anything else is a posting bug.';

-- ═══════════════════════════════════════════════════════════════════
-- 9. ROW LEVEL SECURITY — defence in depth, not today's door
-- ═══════════════════════════════════════════════════════════════════
--
-- Honest about what this is and is not.
--
-- This schema's convention is RLS OFF: the backend holds the service role key,
-- which bypasses RLS entirely, and authorization is enforced in Express by
-- requirePermissionV2 and the fee scope guards. Three earlier migrations turn
-- RLS off explicitly and say so. Nothing here changes that — every query the
-- application makes today is unaffected by these policies.
--
-- The reason to add them anyway: the baseline DID enable RLS with exactly this
-- policy on fee_heads, fee_invoices, fee_payments and fee_structures, and the
-- model rewrite dropped those four tables and recreated them without it. So the
-- fee module is the one place where the protection was removed rather than never
-- added. The day somebody adds a browser-side Supabase client — the anon key,
-- NEXT_PUBLIC_SUPABASE_URL, one `supabase.from('fee_payments')` — that is the
-- difference between a leak and a no-op.
--
-- The policy is copied verbatim from the seven tables that still carry it, so
-- there is one shape to understand rather than two.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'fee_action_requests', 'fee_adhoc_charges', 'fee_arrears',
        'fee_assignment_optionals', 'fee_assignments', 'fee_concession_rules',
        'fee_discount_limits', 'fee_discounts', 'fee_heads', 'fee_invoices',
        'fee_ledger_entries', 'fee_payment_allocations', 'fee_payment_orders',
        'fee_payments', 'fee_scholarships', 'fee_structure_classes',
        'fee_structure_lines', 'fee_structure_schedules', 'fee_structures'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS school_isolation ON public.%I', t);
    END LOOP;
END $$;

-- Tables carrying school_id directly.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'fee_action_requests', 'fee_adhoc_charges', 'fee_arrears',
        'fee_assignments', 'fee_concession_rules', 'fee_discount_limits',
        'fee_discounts', 'fee_heads', 'fee_invoices', 'fee_ledger_entries',
        'fee_payment_orders', 'fee_payments', 'fee_scholarships', 'fee_structures'
    ]
    LOOP
        EXECUTE format($f$
            CREATE POLICY school_isolation ON public.%I
                USING (school_id = (SELECT users.school_id FROM public.users WHERE users.id = auth.uid()))
        $f$, t);
    END LOOP;
END $$;

-- The four child tables with no school_id of their own reach it through their parent.
CREATE POLICY school_isolation ON public.fee_payment_allocations
    USING (EXISTS (SELECT 1 FROM public.fee_payments p
                    WHERE p.id = payment_id
                      AND p.school_id = (SELECT users.school_id FROM public.users WHERE users.id = auth.uid())));

CREATE POLICY school_isolation ON public.fee_structure_lines
    USING (EXISTS (SELECT 1 FROM public.fee_structures s
                    WHERE s.id = structure_id
                      AND s.school_id = (SELECT users.school_id FROM public.users WHERE users.id = auth.uid())));

CREATE POLICY school_isolation ON public.fee_structure_schedules
    USING (EXISTS (SELECT 1 FROM public.fee_structures s
                    WHERE s.id = structure_id
                      AND s.school_id = (SELECT users.school_id FROM public.users WHERE users.id = auth.uid())));

CREATE POLICY school_isolation ON public.fee_structure_classes
    USING (EXISTS (SELECT 1 FROM public.fee_structures s
                    WHERE s.id = structure_id
                      AND s.school_id = (SELECT users.school_id FROM public.users WHERE users.id = auth.uid())));

CREATE POLICY school_isolation ON public.fee_assignment_optionals
    USING (EXISTS (SELECT 1 FROM public.fee_assignments a
                    WHERE a.id = assignment_id
                      AND a.school_id = (SELECT users.school_id FROM public.users WHERE users.id = auth.uid())));
