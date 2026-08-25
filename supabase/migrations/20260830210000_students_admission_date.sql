-- A student admitted through the admission pipeline has a real admission
-- date (when the fee was collected and the record created) worth showing
-- on their profile — `created_at` is a timestamp meant for auditing, not
-- a field anyone expects to see displayed as "when they joined". Existing
-- students backfilled from created_at (their record's creation date is
-- the best available proxy for students that predate this column); new
-- ones get it set explicitly by the code path that creates them (SIS
-- POST /students, or the admission module's createStudentForApplication),
-- not a DB default, so each path can use its own true "admitted on" date.
ALTER TABLE public.students
  ADD COLUMN admission_date date;

UPDATE public.students
SET admission_date = created_at::date
WHERE admission_date IS NULL;
