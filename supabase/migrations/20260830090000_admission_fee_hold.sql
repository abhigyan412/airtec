-- Phase 3 of plan.md: a deadline attached to a reserved seat, released
-- automatically if the application fee isn't paid in time. Hold-duration
-- and grace-period are per-school settings, added the same way every
-- other school-level setting in this codebase is (a typed column
-- directly on `schools`, e.g. low_attendance_threshold_pct) rather than
-- inventing a settings table.
ALTER TABLE public.schools
  ADD COLUMN admission_fee_hold_days integer NOT NULL DEFAULT 7,
  ADD COLUMN admission_fee_hold_grace_days integer NOT NULL DEFAULT 0;

-- No separate "audit trail" table — matching the existing fee-column
-- convention (fee_paid_at/fee_payment_method/etc.) plain columns record
-- the hold's deadline and any manual extension.
ALTER TABLE public.admission_applications
  ADD COLUMN fee_hold_deadline timestamp with time zone,
  ADD COLUMN fee_hold_extended_at timestamp with time zone,
  ADD COLUMN fee_hold_extended_by uuid REFERENCES public.users(id),
  ADD COLUMN fee_hold_extension_reason text,
  ADD COLUMN auto_rejected_reason text;

CREATE INDEX idx_admission_applications_fee_hold_deadline
  ON public.admission_applications USING btree (fee_hold_deadline)
  WHERE fee_hold_deadline IS NOT NULL;
