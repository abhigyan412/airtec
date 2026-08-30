-- Total-sync follow-up: Theory and Practical routinely happen on different
-- days in a real school datesheet, but exam_subjects only ever had one
-- exam_date/start_time/end_time for the whole subject row. These stay the
-- Theory schedule when split (or the whole subject's schedule when not
-- split) -- no rename, purely additive.
alter table public.exam_subjects
  add column practical_exam_date date,
  add column practical_start_time time,
  add column practical_end_time time;

-- exam_template_subjects deliberately carries no date columns (a template
-- is reused across years; dates only exist on the real exam_subjects rows
-- an "apply" creates) but it needs the same split-marks structure as a real
-- subject so a template can be authored as split and have that carry
-- through at apply-time.
alter table public.exam_template_subjects
  add column theory_max_marks numeric,
  add column theory_pass_marks numeric,
  add column practical_max_marks numeric,
  add column practical_pass_marks numeric;
