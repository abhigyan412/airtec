-- Exam Time Slots + Exam Templates.
--
-- A school's exam calendar is structurally fixed year to year (the same
-- "Half Yearly Examination" recurs with the same classes/subjects/timing,
-- only actual dates shift) — today every exam is rebuilt from scratch,
-- one class+subject at a time via POST /exams/subjects/add. This adds a
-- reusable blueprint layer on top of the existing exams/exam_subjects
-- tables (unchanged) so a new instance can be created from a template in
-- one step, with only dates left to fill in.

CREATE TABLE public.exam_time_slots (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name text NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.exam_templates (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name text NOT NULL,
    exam_type text NOT NULL CHECK (exam_type = ANY (ARRAY['unit_test','monthly','half_yearly','annual','pre_board','practical','other'])),
    grading_system text NOT NULL DEFAULT 'marks' CHECK (grading_system = ANY (ARRAY['marks','grades','cgpa'])),
    created_by uuid REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- No date columns here on purpose — a template is reused across years,
-- dates only exist on the real exam_subjects rows an "apply" creates.
CREATE TABLE public.exam_template_subjects (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    template_id uuid NOT NULL REFERENCES public.exam_templates(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    subject_name text NOT NULL,
    time_slot_id uuid REFERENCES public.exam_time_slots(id) ON DELETE SET NULL,
    max_marks numeric NOT NULL DEFAULT 100,
    pass_marks numeric NOT NULL DEFAULT 33,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exam_time_slots_school_idx ON public.exam_time_slots (school_id);
CREATE INDEX exam_templates_school_idx ON public.exam_templates (school_id);
CREATE INDEX exam_template_subjects_template_idx ON public.exam_template_subjects (template_id);

-- RLS stays off, matching this schema's established convention —
-- authorization is enforced in Express (requirePermissionV2), not at
-- the database.
