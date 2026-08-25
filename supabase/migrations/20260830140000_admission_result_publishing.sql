-- Phase 6c of plan.md: entrance-test result publishing, via the shared
-- workflow engine (verified viable — same startWorkflow/actOnWorkflow
-- already used by "Admission Approval Workflow"), entityType
-- 'admission_slot_booking'. result_published is a denormalized
-- convenience flag set on workflow completion, mirroring how
-- admission_applications.status flips to 'admitted' on that workflow's
-- completion rather than requiring every reader to re-derive it from
-- workflow_instances.
ALTER TABLE public.admission_slot_bookings
  ADD COLUMN result_published boolean NOT NULL DEFAULT false,
  ADD COLUMN result_published_at timestamp with time zone;
