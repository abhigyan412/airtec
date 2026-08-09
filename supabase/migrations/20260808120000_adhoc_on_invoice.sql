-- One-off charges become invoice lines.
--
-- adhoc_fees was a parallel universe: counted into what a family owed, shown on
-- the parent's page, and settled by flipping a status field. That meant money
-- could cross the counter for a field trip with no receipt, no payment row and
-- nothing in the day book — the only trace was `status = 'paid'`.
--
-- Linking a charge to an invoice puts it on the same rails as everything else.
-- Once it is a line on an invoice it is collectable by the normal payment
-- allocation, it prints on the receipt, it ages, it appears in arrears, and the
-- balance trigger keeps it honest. No parallel settlement path to keep in sync.
--
-- The charge row survives as the record of WHY (title, description, who raised
-- it); the invoice is the record of what is owed.

ALTER TABLE public.adhoc_fees
    ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.fee_invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.adhoc_fees.invoice_id IS
    'The invoice this charge was billed on. NULL means raised but not yet billed — it still counts toward what the family owes, it just is not collectable until billed.';

CREATE INDEX IF NOT EXISTS idx_adhoc_fees_invoice
    ON public.adhoc_fees (invoice_id) WHERE invoice_id IS NOT NULL;

-- Existing charges stay unbilled: inventing invoices for historic rows would
-- create receipts and aging entries for money that was never actually collected
-- through the system. They can be billed from the UI when someone next looks at
-- them.
