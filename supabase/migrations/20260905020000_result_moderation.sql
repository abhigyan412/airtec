-- Result Settings gap-closing, Phase C: systemic moderation / scaling.
--
-- Grace marks (student_marks.grace_marks_applied, PATCH .../override) have
-- always been strictly per-student, per-subject, one API call each. A
-- board-wide or cohort-wide adjustment ("+5 marks to everyone scoring
-- 28-32% in Maths", "scale this subject's marks by 1.1 across the board")
-- had no bulk mechanism at all. This is the generic, auditable, reversible
-- counterpart — scoped per exam (and optionally per subject within it),
-- never materialized on its own: deleting a rule and re-running
-- generate-results (which already recomputes and upserts every time) is
-- the entire "reverse it" mechanism.
--
-- Purely additive: an exam with zero configured rules produces byte-
-- identical results to today.

create table public.exam_moderation_rules (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  -- null = applies to every subject in the exam.
  exam_subject_id uuid references public.exam_subjects(id) on delete cascade,
  rule_type text not null check (rule_type in ('flat_grace_band','scale_factor')),
  -- flat_grace_band: add grace_amount to any student's raw percentage
  -- falling within [band_min_percent, band_max_percent] (either bound
  -- null means unbounded on that side).
  band_min_percent numeric,
  band_max_percent numeric,
  grace_amount numeric,
  -- scale_factor: multiply every matching student's raw obtained marks.
  scale_factor numeric,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index exam_moderation_rules_exam_idx on public.exam_moderation_rules (exam_id);

-- Audit column, same shape as grace_marks_applied_total added alongside it
-- in 20260831020000_exam_subjects_practical_split.sql — always visible on
-- the report card once non-zero, never a hidden adjustment.
alter table public.report_cards
  add column moderation_marks_applied_total numeric not null default 0;
