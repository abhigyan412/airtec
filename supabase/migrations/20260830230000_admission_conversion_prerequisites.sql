-- User asked to make entrance-test completion and document submission
-- hard prerequisites for converting an inquiry to a formal application,
-- as school-configurable toggles (both default off — same "absence is
-- permissive" convention as every other admission setting).
ALTER TABLE public.schools
  ADD COLUMN admission_require_entrance_test_before_conversion boolean NOT NULL DEFAULT false,
  ADD COLUMN admission_require_documents_before_conversion boolean NOT NULL DEFAULT false;

-- Documents currently can ONLY attach to a formal application
-- (application_id was NOT NULL) — structurally impossible to require
-- "documents submitted" before an application exists. Extended to also
-- accept an inquiry_id, mirroring the exact (inquiry_id, application_id)
-- dual-FK pattern admission_slot_bookings already uses for the same
-- "this can happen before or after conversion" reason.
ALTER TABLE public.application_documents
  ALTER COLUMN application_id DROP NOT NULL,
  ADD COLUMN inquiry_id uuid REFERENCES public.admission_inquiries(id) ON DELETE CASCADE,
  ADD CONSTRAINT application_documents_has_subject
    CHECK ((inquiry_id IS NOT NULL) OR (application_id IS NOT NULL));

CREATE INDEX idx_application_documents_inquiry ON public.application_documents USING btree (inquiry_id);
