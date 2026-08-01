-- Teacher-role dashboard: dynamic, per-academic-year homeroom assignment.
--
-- Which sections/subjects a teacher TEACHES is derived live from
-- timetable_periods (see backend/src/shared/utils/teacherContext.ts) —
-- the timetable is the single source of truth for that, so building it
-- is the only admin step; there's no separate "assign this teacher to
-- this subject" record to fall out of sync with it.
--
-- Whether a teacher is additionally the homeroom ("class") teacher for
-- one section is a different fact and DOES need its own table:
-- class_teacher_assignments below. Deliberately not a static column on
-- the teacher's profile — sections.class_teacher_id (dropped below) was
-- exactly that, and a homeroom assignment changes every year, so it has
-- to resolve per academic_year_id like every other year-scoped table in
-- this schema (fee_invoices, exams, student_promotions, timetable_periods
-- all use the same pattern).

CREATE TABLE public.class_teacher_assignments (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);
-- At most one active homeroom per teacher per year, and at most one
-- active class teacher per section per year — both directions of the
-- same real-world rule, enforced at the database rather than trusted to
-- application code.
CREATE UNIQUE INDEX class_teacher_assignments_one_per_teacher_year
    ON public.class_teacher_assignments (teacher_id, academic_year_id) WHERE is_active;
CREATE UNIQUE INDEX class_teacher_assignments_one_per_section_year
    ON public.class_teacher_assignments (section_id, academic_year_id) WHERE is_active;
CREATE INDEX class_teacher_assignments_teacher_idx ON public.class_teacher_assignments (teacher_id) WHERE is_active;

-- RLS stays off, matching this schema's established convention —
-- authorization is enforced in Express (getTeacherContext + route-level
-- scoping), not at the database.

-- ── Backfill class_teacher_assignments from sections.class_teacher_id ─
-- sections isn't itself year-scoped (classes/students are), so "the
-- teacher currently set on this section" is backfilled against each
-- school's CURRENT academic year — the only reading of a still-set
-- class_teacher_id that means anything today.
INSERT INTO public.class_teacher_assignments (school_id, teacher_id, section_id, academic_year_id, is_active)
SELECT sec.school_id, sec.class_teacher_id, sec.id, ay.id, true
FROM public.sections sec
JOIN public.academic_years ay ON ay.school_id = sec.school_id AND ay.is_current = true
WHERE sec.class_teacher_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── Sync the RBAC "Class Teacher" role for backfilled assignments ───
-- Dashboard scoping now comes entirely from class_teacher_assignments,
-- but the elevated permissions that role already carries (student.edit,
-- exam.result_publish, complaint.resolve) still gate through the RBAC
-- tables — keep them in sync so a teacher who was already a homeroom
-- teacher a moment ago doesn't lose permissions they already had.
-- Schools whose RBAC tables haven't been seeded yet (seedDefaultRoles()
-- runs lazily — see backend/src/modules/rbac/seed.ts) simply match zero
-- rows here; every assignment made from this point forward is synced by
-- the application layer (POST /teacher/class-teacher-assignments)
-- regardless of whether this backfill found a role to grant.
INSERT INTO public.user_roles (user_id, role_id, school_id)
SELECT cta.teacher_id, r.id, cta.school_id
FROM public.class_teacher_assignments cta
JOIN public.roles r ON r.school_id = cta.school_id AND r.name = 'Class Teacher'
WHERE cta.is_active
ON CONFLICT DO NOTHING;

-- ── Drop the now-superseded static column ────────────────────────────
ALTER TABLE public.sections DROP COLUMN class_teacher_id;

-- ── Minimal submission/grading status for homework ───────────────────
-- homework_students was purely an assignment junction (homework_id,
-- student_id) with no notion of progress. Needed so the teacher
-- dashboard's "To grade" (submitted, awaiting a grade) and "Homework
-- assigned" cards have real data instead of being permanently empty.
ALTER TABLE public.homework_students
    ADD COLUMN status text NOT NULL DEFAULT 'assigned'
        CHECK (status IN ('assigned', 'submitted', 'graded'));
