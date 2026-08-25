-- Admission offer letter: number + issuance audit trail, matching the
-- INQ/APP/ADM document-number convention (nextDocumentNumber). The letter
-- is only generatable (documents module) once these are set.
ALTER TABLE public.admission_applications
  ADD COLUMN offer_letter_number text,
  ADD COLUMN offer_letter_issued_at timestamp with time zone,
  ADD COLUMN offer_letter_issued_by uuid REFERENCES public.users(id);
