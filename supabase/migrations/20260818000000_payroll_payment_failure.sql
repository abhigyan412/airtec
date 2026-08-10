-- Payroll Stage 8: bank transfer failure handling.
--
-- payment_status already allowed 'failed' (payslips_payment_status_check
-- already lists it) — nothing has ever set or read it. This adds the
-- fields a real failure needs: why, the bank's own reference for it,
-- and when.

alter table public.payslips add column if not exists failure_reason text;
alter table public.payslips add column if not exists bank_rejection_reference text;
alter table public.payslips add column if not exists failed_at timestamptz;
