-- Phase 2 of plan.md: class-level locking, scoped within an admission
-- cycle. Deliberately added to admission_seat_ledger rather than a new
-- table or admission_cycles itself — admission_cycles is one row per
-- (school, academic_year), but locking is per-class, and the seat ledger
-- is already the per-(school, class) governance table Phase 1 built.
-- "Extend, don't duplicate" applied to the ledger a second time rather
-- than inventing a parallel per-class table.
ALTER TABLE public.admission_seat_ledger
  ADD COLUMN is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN locked_at timestamp with time zone,
  ADD COLUMN locked_by uuid REFERENCES public.users(id),
  ADD COLUMN lock_reason text;
