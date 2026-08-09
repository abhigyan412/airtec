-- One transaction at the counter = one receipt.
--
-- POST /fees/payments/allocate takes a single amount from a family and settles
-- their invoices oldest-first. Because fee_payments.invoice_id is NOT NULL, that
-- means one row per invoice — and each row was minting its own receipt number.
-- A parent handing over 1,000 against two 500 invoices walked away with TWO
-- receipts for one payment, which is confusing on the desk and wrong on paper.
--
-- Splitting across invoices is correct and has to stay: the allocation is what
-- lets the money clear the oldest debt first, and each invoice genuinely needs
-- its own settled amount. What was wrong is treating each split as its own
-- transaction.
--
-- payment_group_id ties the splits back together. Rows still carry their own
-- receipt_number (the unique constraint and every existing receipt stay valid);
-- the receipt VIEW groups by this and prints one document with a line per
-- invoice, which is how the printed receipt was always laid out anyway.

ALTER TABLE public.fee_payments
    ADD COLUMN IF NOT EXISTS payment_group_id uuid;

COMMENT ON COLUMN public.fee_payments.payment_group_id IS
    'Rows created by one counter transaction (see POST /fees/payments/allocate). NULL for single-invoice payments, which are their own group. Receipts print per group, not per row.';

-- The receipt lookup: "every row in this transaction".
CREATE INDEX IF NOT EXISTS idx_fee_payments_group
    ON public.fee_payments (payment_group_id)
    WHERE payment_group_id IS NOT NULL;

-- Backfill: payments taken before this existed were one-invoice transactions,
-- so each is its own group. Grouping them by (student, timestamp) after the fact
-- would be guesswork, and guessing on receipts is worse than leaving them alone.
UPDATE public.fee_payments
   SET payment_group_id = id
 WHERE payment_group_id IS NULL;
