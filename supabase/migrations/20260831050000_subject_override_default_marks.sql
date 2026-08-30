-- Result Settings could tell a real datesheet whether a subject is split
-- (has_practical) but had no say over its actual max/pass marks — a school
-- with a fixed policy (e.g. "Practical Examination English is always /100")
-- had nowhere to declare that; every Add Subject started from a generic
-- 100/33 default regardless of subject or exam type.
--
-- default_max_marks/default_pass_marks apply when the subject isn't split;
-- default_theory_*/default_practical_* apply when has_practical is true —
-- mirrors exam_subjects' own max_marks/pass_marks vs
-- theory_*/practical_* split exactly, one level up as a configurable
-- default rather than a real datesheet row's actual value. All nullable:
-- null means "no school-wide default set, Add Subject falls back to its
-- own generic default."
alter table public.exam_subject_result_overrides
  add column default_max_marks numeric,
  add column default_pass_marks numeric,
  add column default_theory_max_marks numeric,
  add column default_theory_pass_marks numeric,
  add column default_practical_max_marks numeric,
  add column default_practical_pass_marks numeric;
