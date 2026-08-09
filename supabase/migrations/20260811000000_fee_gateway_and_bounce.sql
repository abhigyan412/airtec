-- Two gaps in how money MOVES, as opposed to how it is modelled.
--
-- 1. ONLINE PAYMENT. fee_payments.method already lists 'upi', 'online' and
--    'wallet', but nothing in the system ever talked to a payment provider —
--    those values were labels a cashier typed in after taking money across a
--    desk. Every rupee had to arrive in person. This adds the order: the record
--    that a family INTENDS to pay, created before they are sent to a provider and
--    resolved when the provider says what happened.
--
--    Deliberately its own table rather than a nullable set of columns on
--    fee_payments: an order that fails, expires or is abandoned must leave no
--    payment behind, and a payment row that exists but did not settle anything is
--    exactly the corruption the allocation model was built to avoid.
--
-- 2. CHEQUE BOUNCE. A cheque could be recorded but never dishonoured. The only
--    way to undo one was to cancel the payment, which is a different event with
--    different accounting: a cancellation says the money was never taken, a
--    bounce says it was taken, credited, and then withdrawn by the bank — usually
--    with a penalty.

-- ═══════════════════════════════════════════════════════════════════
-- ONLINE PAYMENT ORDERS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fee_payment_orders (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id          uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

    amount              numeric(12,2) NOT NULL CHECK (amount > 0),
    -- Optional narrowing, mirroring the counter flow: settle only these invoices.
    -- Null/empty means everything open, oldest first.
    invoice_ids         uuid[],

    -- 'mock' until real credentials exist. The driver is swappable precisely
    -- because the provider's identity lives in a column, not in the flow.
    provider            text NOT NULL DEFAULT 'mock',
    provider_order_id   text,
    provider_payment_id text,

    status              text NOT NULL DEFAULT 'created',
    failure_reason      text,

    -- Set once the provider confirms and the payment is written. Its presence is
    -- what makes capture idempotent: a webhook delivered twice finds it already
    -- populated and does nothing.
    payment_id          uuid REFERENCES public.fee_payments(id) ON DELETE SET NULL,

    created_by          uuid REFERENCES public.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_payment_orders_status_check CHECK (
        status = ANY (ARRAY['created','paid','failed','expired'])),
    -- A paid order MUST point at the payment it produced. Without this a capture
    -- that half-failed could sit as 'paid' with no money recorded anywhere.
    CONSTRAINT fee_payment_orders_paid_has_payment CHECK (
        status <> 'paid' OR payment_id IS NOT NULL)
);

-- Providers re-deliver webhooks. Two rows for one provider payment would mean
-- two receipts for one transaction, which is the exact bug the allocation model
-- removed from the counter flow; it is not being reintroduced through the web.
CREATE UNIQUE INDEX IF NOT EXISTS fee_payment_orders_provider_payment_uniq
    ON public.fee_payment_orders (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fee_payment_orders_provider_order_uniq
    ON public.fee_payment_orders (provider, provider_order_id)
    WHERE provider_order_id IS NOT NULL;

-- "What has this family got in flight", and the reconciliation sweep's
-- "what is still sitting unresolved".
CREATE INDEX IF NOT EXISTS idx_fee_payment_orders_student
    ON public.fee_payment_orders (school_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_fee_payment_orders_open
    ON public.fee_payment_orders (status, created_at)
    WHERE status = 'created';

COMMENT ON TABLE public.fee_payment_orders IS
    'A family''s intent to pay online. Resolves into exactly one fee_payment, or into nothing.';

-- ═══════════════════════════════════════════════════════════════════
-- CHEQUE BOUNCE
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.fee_payments
    ADD COLUMN IF NOT EXISTS bounced_on    date,
    ADD COLUMN IF NOT EXISTS bounce_reason text,
    -- The bank's charge, passed on to the family. Recorded on the payment that
    -- bounced rather than as a mystery line on the next invoice.
    ADD COLUMN IF NOT EXISTS bounce_fee    numeric(12,2) NOT NULL DEFAULT 0
        CHECK (bounce_fee >= 0);

-- 'bounced' is a THIRD terminal state, distinct from 'cancelled'. Cancelled means
-- the money never came; bounced means it came, was credited, and the bank took it
-- back. Conflating them makes a day's collection irreconcilable.
ALTER TABLE public.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_status_check;
ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_status_check
    CHECK (status = ANY (ARRAY['captured','cancelled','refunded','bounced']));

COMMENT ON COLUMN public.fee_payments.bounced_on IS
    'Set when the bank dishonoured this payment. Allocations are reversed and the dues restored.';

-- Chasing dishonoured cheques is its own worklist.
CREATE INDEX IF NOT EXISTS idx_fee_payments_bounced
    ON public.fee_payments (school_id, bounced_on)
    WHERE status = 'bounced';
