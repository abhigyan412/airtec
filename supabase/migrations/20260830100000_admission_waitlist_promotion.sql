-- Phase 4 of plan.md: waitlist auto-promotion. Response-deadline length is
-- a per-school setting, same typed-column-on-schools convention as every
-- other admission setting so far.
ALTER TABLE public.schools
  ADD COLUMN admission_waitlist_response_days integer NOT NULL DEFAULT 3;

-- No real send channel exists yet (Phase 8 still blocked on a provider
-- choice — see decisions.md), so "auto-notify" here means: the next-ranked
-- candidate is automatically selected and a response clock starts,
-- visible to staff, who follow up manually (call/WhatsApp by hand,
-- logged the same way any other follow-up is) rather than an automated
-- message actually being sent. waitlist_offer_made_at IS NULL is how
-- tryPromoteWaitlist() finds candidates who haven't been offered yet.
ALTER TABLE public.admission_inquiries
  ADD COLUMN waitlist_offer_made_at timestamp with time zone,
  ADD COLUMN waitlist_offer_deadline timestamp with time zone;
