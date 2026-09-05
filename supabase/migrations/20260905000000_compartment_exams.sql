-- Result Settings gap-closing, Phase A: compartment re-exams.
--
-- compartment_policy on exam_class_result_rules has always been able to
-- FLAG a result 'compartment' (see resultComputation.ts), but nothing lets
-- a school actually record that student's re-take and produce a revised
-- final result — the compartment status was a dead end. This migration
-- adds the two pieces needed: a real exam_type a compartment re-take can
-- use (so it flows through the entire existing exam lifecycle —
-- Draft/Published/Ongoing/Completed, datesheet, Marks Entry,
-- generate-results — completely unmodified), and an audit trail for the
-- one moment this feature ever overwrites an already-published
-- report_cards row (finalizing a compartment result onto the original
-- exam's card).
--
-- Purely additive: a school that never uses this sees no behavior change
-- anywhere (no existing constraint loosened in a way that changes what was
-- already valid, no existing row touched).

-- 'compartment' joins the same 7-value exam_type list every other check
-- constraint on this enum already uses (see exam_class_result_rules,
-- exam_subject_result_overrides, exam_templates, term_templates) — same
-- drop/add-constraint pattern 20260724000000_notifications.sql already
-- established for widening a check constraint on live data. Deliberately
-- NOT added to those other per-exam-type-rule tables' check constraints,
-- nor to any user-facing "pick an exam type" dropdown (New Exam, Exam
-- Templates, Generate Structure, Term Templates) — a compartment exam is
-- never hand-created or hand-planned, only ever produced by
-- POST /exams/:id/compartment/create below, and always resolves against
-- the class's DEFAULT rule at finalize time, never a compartment-specific
-- override (see finalize's own comment in exam/routes.ts).
ALTER TABLE public.exams DROP CONSTRAINT exams_exam_type_check;
ALTER TABLE public.exams ADD CONSTRAINT exams_exam_type_check
  CHECK (exam_type = ANY (ARRAY['unit_test'::text, 'monthly'::text, 'half_yearly'::text, 'annual'::text, 'pre_board'::text, 'practical'::text, 'other'::text, 'compartment'::text]));

-- Traces a compartment exam back to the original it's re-taking subjects
-- from. Null for every one of today's exams (a standalone/composite-term
-- member is never "of" another exam) and for every future exam that isn't
-- itself a compartment re-take.
ALTER TABLE public.exams
  ADD COLUMN compartment_of_exam_id uuid REFERENCES public.exams(id) ON DELETE SET NULL;
CREATE INDEX exams_compartment_of_idx ON public.exams (compartment_of_exam_id) WHERE compartment_of_exam_id IS NOT NULL;

-- Snapshot of a report_cards row taken the one time this feature ever
-- overwrites one in place (POST /exams/:id/compartment/finalize) — the
-- original percentage/status/grade a family already saw stays recoverable,
-- never silently lost to the revision.
CREATE TABLE public.report_card_revisions (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  report_card_id uuid NOT NULL REFERENCES public.report_cards(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  compartment_exam_id uuid REFERENCES public.exams(id) ON DELETE SET NULL,
  previous_snapshot jsonb NOT NULL,
  reason text NOT NULL,
  revised_by uuid REFERENCES public.users(id),
  revised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_card_revisions_report_card_idx ON public.report_card_revisions (report_card_id);
CREATE INDEX report_card_revisions_school_idx ON public.report_card_revisions (school_id);
