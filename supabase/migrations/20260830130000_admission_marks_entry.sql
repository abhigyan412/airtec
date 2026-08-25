-- Phase 6b-i of plan.md: manual marks entry for written entrance tests.
-- Deliberately NOT auto-evaluation (6b-ii, still blocked — see
-- decisions.md) — this is a human typing in a score, same as the
-- existing exam module's student_marks.marks_obtained, just living on
-- admission_slot_bookings instead of a new table since that row is
-- already the "candidate x entrance-event" relationship these scores
-- belong to.
ALTER TABLE public.admission_slot_bookings
  ADD COLUMN marks_obtained numeric,
  ADD COLUMN max_marks numeric,
  ADD COLUMN is_pass boolean;

-- Pass threshold is a per-class setting, reusing admission_class_settings
-- (Phase 6a) rather than a new table — this is exactly the "future
-- per-class settings have a home to extend into" case that table's
-- comment anticipated.
ALTER TABLE public.admission_class_settings
  ADD COLUMN pass_marks_percent integer NOT NULL DEFAULT 40;
