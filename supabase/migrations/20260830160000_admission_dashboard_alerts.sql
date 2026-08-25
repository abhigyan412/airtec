-- Phase 9 of plan.md: leadership dashboard alerts (stage aging, seat
-- occupancy risk). Thresholds are per-school settings, same typed-column
-- convention as every other admission setting so far.
ALTER TABLE public.schools
  ADD COLUMN admission_stage_aging_days integer NOT NULL DEFAULT 10,
  ADD COLUMN admission_occupancy_warning_percent integer NOT NULL DEFAULT 70,
  ADD COLUMN admission_occupancy_warning_days integer NOT NULL DEFAULT 60;

-- status_changed_at, not updated_at: updated_at is bumped by ANY field
-- edit (a note, a phone number correction), which would make "days stuck
-- at this stage" wrong every time someone touches an unrelated field.
-- A trigger, not an application-level set-on-write, deliberately —
-- admission_inquiries.status is written from several places (PATCH
-- /inquiries/:id, convert-to-application, both workflow-completion
-- sites, the fee-hold-expiry sweep) and a trigger covers all of them,
-- current and future, without relying on each call site remembering to
-- set it — the same class of gap Phase 7 just went around finding and
-- closing one column at a time.
ALTER TABLE public.admission_inquiries
  ADD COLUMN status_changed_at timestamp with time zone DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_admission_inquiry_status_changed_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admission_inquiries_status_changed
  BEFORE UPDATE ON public.admission_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.set_admission_inquiry_status_changed_at();
