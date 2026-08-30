-- Result Settings, Phase 1b: theory/practical split + edge-case columns on
-- the three existing exam tables. Every column is nullable or defaults to
-- a value matching today's exact behavior — purely additive, no existing
-- column touched. Nothing reads these yet (Phase 2 refactor wires them up).

-- exam_subjects: theory/practical split (all four nullable; enforced
-- all-null-or-all-four-non-null in the route, not a DB CHECK, since the
-- server also needs to recompute max_marks = theory + practical on every
-- write rather than trust a client-sent total) + is_additional, the
-- actual-exam-level mirror of exam_subject_result_overrides.is_additional
-- (substitution is decided per real exam instance).
alter table public.exam_subjects
  add column theory_max_marks numeric,
  add column theory_pass_marks numeric,
  add column practical_max_marks numeric,
  add column practical_pass_marks numeric,
  add column is_additional boolean not null default false;

-- student_marks: mirrors the split; grace_marks_applied is an always-visible
-- audit trail (never folded invisibly into marks_obtained);
-- result_status_override is a manual per-student/per-subject exception
-- ("Absent - Medical", "Result Withheld") that supersedes computed output.
alter table public.student_marks
  add column theory_marks_obtained numeric,
  add column practical_marks_obtained numeric,
  add column theory_is_absent boolean not null default false,
  add column practical_is_absent boolean not null default false,
  add column grade_point numeric,
  add column grace_marks_applied numeric not null default 0,
  add column result_status_override text;

-- report_cards: result_status is NULL by default, meaning "legacy is_pass
-- boolean only" - existing report cards are unaffected until a class rule
-- actually populates a richer status. remarks_source tracks provenance so
-- the UI can show whether a remark came from the old fixed strings, a
-- configured remarks rule, or a manual student-level override.
alter table public.report_cards
  add column overall_cgpa numeric,
  add column result_status text check (result_status in ('pass','fail','compartment','not_eligible','withheld')),
  add column grace_marks_applied_total numeric not null default 0,
  add column remarks_source text not null default 'legacy' check (remarks_source in ('legacy','rule','manual'));
