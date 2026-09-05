-- Result Settings gap-closing, Phase D: multi-component subjects beyond
-- Theory/Practical.
--
-- Theory and Practical are hardcoded columns everywhere (exam_subjects,
-- exam_template_subjects, student_marks, result_group_subjects,
-- result_group_subject_marks, plus a lot of frontend UI) — a subject
-- needing Written + Oral + Project, or a separate Internal Assessment
-- component, had nowhere to go. Deliberately scoped narrow: Theory and
-- Practical stay exactly as they are, unchanged, in every table and every
-- screen. This only adds an OPTIONAL extra layer for subjects that need
-- more than those two — every existing subject has zero rows here and is
-- completely unaffected.
--
-- Template support (exam_template_subjects gaining the same shape)
-- deliberately deferred to a fast-follow if real usage asks for it — this
-- covers real, manually-scheduled exams first, the same "manual creation
-- realistically caps at a handful of subjects" reasoning the codebase's
-- own hotfix history (see exam/plan.md, "same O(subjects) bug, second
-- location") already used to scope down `POST /templates`'s own
-- belt-and-braces sync.

create table public.exam_subject_extra_components (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  exam_subject_id uuid not null references public.exam_subjects(id) on delete cascade,
  component_label text not null,
  max_marks numeric not null,
  pass_marks numeric not null default 0,
  component_date date,
  start_time time without time zone,
  end_time time without time zone,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index exam_subject_extra_components_subject_idx on public.exam_subject_extra_components (exam_subject_id);

create table public.student_component_marks (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  exam_subject_extra_component_id uuid not null references public.exam_subject_extra_components(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  marks_obtained numeric,
  is_absent boolean not null default false,
  entered_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_subject_extra_component_id, student_id)
);
create index student_component_marks_component_idx on public.student_component_marks (exam_subject_extra_component_id);
create index student_component_marks_student_idx on public.student_component_marks (student_id);
