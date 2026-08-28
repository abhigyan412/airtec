-- Homework module plan.md Phase 1 (submission) + Phase 2 (grading).
-- homework_students.status ('assigned'|'submitted'|'graded') has existed
-- since the teacher-dashboard migration, read by three dashboard surfaces,
-- written by nothing — this is the write-side those columns were always
-- missing. decisions.md resolved 2026-08-27: marks + written feedback
-- (not accept/reject), and a new dedicated storage bucket.

ALTER TABLE public.homework_students
  ADD COLUMN submission_text text,
  ADD COLUMN submission_file_url text,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN marks_obtained numeric,
  ADD COLUMN max_marks numeric,
  ADD COLUMN feedback text,
  ADD COLUMN graded_at timestamptz,
  ADD COLUMN graded_by uuid REFERENCES public.users(id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-submissions', 'homework-submissions', true)
ON CONFLICT (id) DO NOTHING;
