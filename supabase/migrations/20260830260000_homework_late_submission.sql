-- Homework module plan.md Phase 6: late submissions were previously
-- unhandled entirely — no concept of "late" existed. Same permissive
-- default as every other admission/homework toggle: schools accept late
-- work by default, with a 0-day grace period, and can turn either off.

ALTER TABLE public.schools
  ADD COLUMN homework_accept_late_submissions boolean NOT NULL DEFAULT true,
  ADD COLUMN homework_late_grace_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.homework_students
  ADD COLUMN is_late boolean;
