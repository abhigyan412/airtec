-- Money-sensitive fee actions become requests, not direct edits.
--
-- Waiving a late fee, cancelling a payment and issuing a refund all reduce what
-- a family owes or hand money back. None of them had any representation here:
-- a late fine could only be removed by editing the invoice, and a payment
-- recorded in error could only be deleted outright, which destroyed the receipt
-- trail. Neither left a record of who decided or why.
--
-- One table for all three rather than three near-identical ones. They share
-- every column that matters — target, amount, reason, decision, decider — and
-- the approvals queue wants them in a single ordered list anyway.
--
-- Ported from the flow in the edut codebase (fee_action_requests), extended
-- with refunds and adapted to this schema: the target of a waiver here is an
-- invoice, since late fines live on fee_invoices.late_fine rather than on
-- separate installment rows.

CREATE TABLE IF NOT EXISTS public.fee_action_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

    -- late_fee_waiver -> target is a fee_invoices.id
    -- payment_cancel  -> target is a fee_payments.id
    -- refund          -> target is a fee_payments.id
    kind          text NOT NULL,
    target_id     uuid NOT NULL,
    student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

    -- What the action is worth, captured at request time so the approver sees
    -- the figure that was actually asked for even if the underlying row moves.
    amount        numeric(12,2),
    reason        text NOT NULL,

    status        text NOT NULL DEFAULT 'pending',
    decision_note text,
    requested_by  uuid REFERENCES public.users(id),
    decided_by    uuid REFERENCES public.users(id),
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_action_requests_kind_check
        CHECK (kind = ANY (ARRAY['late_fee_waiver','payment_cancel','refund'])),
    CONSTRAINT fee_action_requests_status_check
        CHECK (status = ANY (ARRAY['pending','approved','rejected','withdrawn'])),
    CONSTRAINT fee_action_requests_decided_check
        CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- One open request per target per kind. Without this an impatient clerk who
-- clicks twice puts two identical waivers in the queue, and approving both
-- applies the waiver twice.
CREATE UNIQUE INDEX IF NOT EXISTS fee_action_requests_open_target_uniq
    ON public.fee_action_requests (school_id, kind, target_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fee_action_requests_school_status
    ON public.fee_action_requests (school_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fee_action_requests_student
    ON public.fee_action_requests (student_id, status);

-- ── Payments gain a lifecycle ────────────────────────────────────────
--
-- fee_payments had no status: a payment existed or it didn't. Cancelling one
-- therefore meant DELETE, which took the receipt number with it and left an
-- audit trail with a hole in it. A cancelled payment now stays on the record and
-- simply stops counting toward the balance.
--
-- refunded_amount covers the partial case — a family overpaid by 2,000 and gets
-- that back while the rest of the payment stands.

ALTER TABLE public.fee_payments
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'captured',
    ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_status_check;
ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_status_check
    CHECK (status = ANY (ARRAY['captured','cancelled','refunded']));

ALTER TABLE public.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_refund_check;
ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_refund_check
    CHECK (refunded_amount >= 0 AND refunded_amount <= amount_paid);

-- ── The balance trigger learns about all three ───────────────────────
--
-- Replaces the version from 20260808000000. Same contract — fee_invoices
-- .amount_paid is maintained here and nowhere else — but "how much has this
-- invoice actually been paid" now means captured money net of refunds, so
-- cancelling a payment or refunding part of one flows straight through to the
-- invoice's status without any route needing to know.

CREATE OR REPLACE FUNCTION public.fee_payment_effective_amount(
    p_status          text,
    p_amount_paid     numeric,
    p_refunded_amount numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_status = 'cancelled' THEN 0
        ELSE GREATEST(0, p_amount_paid - COALESCE(p_refunded_amount, 0))
    END;
$$;

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
        SELECT COALESCE(sum(
                 public.fee_payment_effective_amount(status, amount_paid, refunded_amount)
               ), 0)
          INTO v_paid
          FROM public.fee_payments WHERE invoice_id = v_invoice_id;

        SELECT total_amount, status INTO v_total, v_status
          FROM public.fee_invoices WHERE id = v_invoice_id
          FOR UPDATE;

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
    END LOOP;

    RETURN NULL;
END;
$$;

-- The trigger must also fire when a payment is cancelled or refunded, which are
-- UPDATEs to columns the original trigger definition did not watch.
DROP TRIGGER IF EXISTS fee_payments_apply_to_invoice ON public.fee_payments;
CREATE TRIGGER fee_payments_apply_to_invoice
    AFTER INSERT OR UPDATE OR DELETE
    ON public.fee_payments
    FOR EACH ROW
    EXECUTE FUNCTION public.fee_payments_apply_to_invoice();

-- Re-settle every invoice against the new definition. A no-op today (nothing is
-- cancelled or refunded yet) but it keeps this migration self-verifying: after
-- it runs, amount_paid equals the effective sum by construction.
UPDATE public.fee_invoices i
   SET amount_paid = COALESCE(p.total, 0)
  FROM (SELECT invoice_id,
               sum(public.fee_payment_effective_amount(status, amount_paid, refunded_amount)) AS total
          FROM public.fee_payments
         GROUP BY invoice_id) p
 WHERE p.invoice_id = i.id
   AND i.amount_paid <> COALESCE(p.total, 0);
