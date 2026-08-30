-- Composite Terms previously flattened every subject to one plain
-- percentage, even when the member exams recorded it as split Theory +
-- Practical — meaning a school using per-subject pass criteria (must pass
-- Theory AND Practical separately) never got that check applied at the
-- Term level, only within each member exam's own standalone result.
-- Mirrors exam_subjects/student_marks' own split columns, one level up.
alter table public.result_group_subjects
  add column theory_max_marks numeric,
  add column theory_pass_marks numeric,
  add column practical_max_marks numeric,
  add column practical_pass_marks numeric;

alter table public.result_group_subject_marks
  add column theory_marks_obtained numeric,
  add column practical_marks_obtained numeric;
