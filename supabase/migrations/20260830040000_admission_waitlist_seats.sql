-- Waitlist: the inquiry pipeline had no home for "good candidate, no seat
-- yet" other than leaving them stuck at 'approved' or wrongly marking
-- them 'lost'. waitlist_rank lets counselors order the waitlist manually.
ALTER TABLE public.admission_inquiries
  DROP CONSTRAINT admission_inquiries_status_check;
ALTER TABLE public.admission_inquiries
  ADD CONSTRAINT admission_inquiries_status_check
  CHECK ((status = ANY (ARRAY[
    'new'::text, 'follow_up'::text, 'interested'::text, 'documents_submitted'::text,
    'entrance_exam'::text, 'approved'::text, 'waitlisted'::text, 'fee_pending'::text,
    'admitted'::text, 'rejected'::text, 'lost'::text
  ])));
ALTER TABLE public.admission_inquiries
  ADD COLUMN waitlist_rank integer;
