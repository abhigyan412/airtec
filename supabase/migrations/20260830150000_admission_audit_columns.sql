-- Phase 7 of plan.md: consistent *_at/*_by/reason columns, not new audit
-- infrastructure — matching the existing fee-column convention, applied
-- to the two real gaps an audit found (not a blanket pass over every
-- admission table, which was never Phase 7's scope):
--
-- 1. application_documents: DELETE was a hard delete with zero trace —
--    a verified document's entire history (who uploaded it, who verified
--    it, when) could vanish with one call. Soft-delete instead.
-- 2. admission_inquiries: PATCH lets ANY field change, including status,
--    with no record of who made the change. Every other write path in
--    this module already tracks an actor; this was the one that didn't.
--
-- Seat Ledger already has updated_by/updated_at/updated_reason (Phase 1)
-- and locked_at/locked_by/lock_reason (Phase 2) — audited already,
-- confirmed by reading the schema, nothing to add there.
ALTER TABLE public.application_documents
  ADD COLUMN deleted_at timestamp with time zone,
  ADD COLUMN deleted_by uuid REFERENCES public.users(id);

ALTER TABLE public.admission_inquiries
  ADD COLUMN updated_by uuid REFERENCES public.users(id);
