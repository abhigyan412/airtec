-- Re-sequences the admission fee: it used to be collectible (and the seat
-- reserved / fee-hold clock started) the moment an application was
-- created, with the admission-approval workflow completing straight to
-- 'admitted' regardless of fee status. The intended flow is: approval
-- completes -> Fee Pending -> Accountant collects the fee -> only then
-- Admitted, seat confirmed. 'fee_pending' was never a legal status value.
ALTER TABLE public.admission_applications
  DROP CONSTRAINT admission_applications_status_check;
ALTER TABLE public.admission_applications
  ADD CONSTRAINT admission_applications_status_check
  CHECK ((status = ANY (ARRAY[
    'pending'::text, 'counselor_approved'::text, 'documents_verified'::text,
    'fee_paid'::text, 'principal_approved'::text, 'fee_pending'::text,
    'admitted'::text, 'rejected'::text
  ])));

-- The section a candidate is enrolled into is chosen at the final
-- approval step (WorkflowPipeline's section picker, already built) but
-- student creation now happens later, at fee collection — this persists
-- that choice across the gap instead of asking a second time.
ALTER TABLE public.admission_applications
  ADD COLUMN admitted_section_id uuid REFERENCES public.sections(id);
