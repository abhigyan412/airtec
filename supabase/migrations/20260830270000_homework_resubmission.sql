-- Homework module plan.md Phase 9: resubmission after grading. Chosen
-- conservative default (off) unlike most other toggles in this module —
-- an ungated resubmission could be used to game a grade after seeing
-- feedback, per decisions.md's own reasoning for this one.

ALTER TABLE public.schools
  ADD COLUMN homework_resubmission_allowed boolean NOT NULL DEFAULT false;
