-- remaining-work-plan.md Section A4: Phase 7's audit-column pass covered
-- Seat Ledger, Documents, and Pipeline, and explicitly named these four
-- config tables as a found-but-deferred gap — each already has
-- updated_at (via the existing update_updated_at() trigger) but no
-- created_by/updated_by, unlike every other write path in this module.
-- Plain columns, same convention as everywhere else — no new audit
-- infrastructure.
ALTER TABLE public.admission_cycles
  ADD COLUMN created_by uuid REFERENCES public.users(id),
  ADD COLUMN updated_by uuid REFERENCES public.users(id);

ALTER TABLE public.admission_slots
  ADD COLUMN created_by uuid REFERENCES public.users(id),
  ADD COLUMN updated_by uuid REFERENCES public.users(id);

ALTER TABLE public.admission_class_settings
  ADD COLUMN created_by uuid REFERENCES public.users(id),
  ADD COLUMN updated_by uuid REFERENCES public.users(id);

ALTER TABLE public.admission_document_requirements
  ADD COLUMN created_by uuid REFERENCES public.users(id);
-- No updated_by here: this table has no UPDATE path anywhere in the
-- codebase, only INSERT (add a requirement) and DELETE (remove one) —
-- confirmed by reading the document-requirements routes.
