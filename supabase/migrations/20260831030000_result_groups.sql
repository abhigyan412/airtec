-- Result Settings, Phase 1c: composite "Term" results — a weighted blend of
-- several exams (e.g. UT1 20% + UT2 20% + Half Yearly 60%) into one result,
-- alongside each member exam's own standalone result untouched. Mirrors
-- exams/exam_subjects/student_marks/report_cards exactly (same four-table
-- shape) so the Phase 2 computation core (computeReportCard()) can serve
-- both a single exam and a composite group with the same function.

create table public.result_groups (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  academic_year_id uuid references public.academic_years(id),
  class_id uuid not null references public.classes(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','result_declared','result_published')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index result_groups_school_class_idx on public.result_groups (school_id, class_id);

create table public.result_group_exams (
  id uuid primary key default extensions.uuid_generate_v4(),
  result_group_id uuid not null references public.result_groups(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  weight_percent numeric not null check (weight_percent > 0 and weight_percent <= 100),
  created_at timestamptz not null default now(),
  unique (result_group_id, exam_id)
);

-- An explicit, curated subject list (synced from member exams' subjects,
-- then editable) rather than an implicit union computed on every read.
create table public.result_group_subjects (
  id uuid primary key default extensions.uuid_generate_v4(),
  result_group_id uuid not null references public.result_groups(id) on delete cascade,
  subject_name text not null,
  max_marks numeric not null default 100,
  pass_marks numeric not null default 33,
  created_at timestamptz not null default now(),
  unique (result_group_id, subject_name)
);

-- Computed, never manually entered. contributing_exam_count lets the
-- weighted average renormalize when a student is missing one member exam's
-- mark for this subject, instead of silently treating the gap as a zero.
create table public.result_group_subject_marks (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  result_group_id uuid not null references public.result_groups(id) on delete cascade,
  result_group_subject_id uuid not null references public.result_group_subjects(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  weighted_percent numeric,
  marks_obtained numeric,
  contributing_exam_count integer not null default 0,
  is_pass boolean,
  grade text,
  grade_point numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (result_group_subject_id, student_id)
);
create index result_group_subject_marks_group_idx on public.result_group_subject_marks (result_group_id);

-- Mirrors report_cards exactly, including the edge-case fields added to it
-- in the previous migration.
create table public.result_group_cards (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  result_group_id uuid not null references public.result_groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  total_marks numeric,
  obtained_marks numeric,
  percentage numeric,
  grade text,
  overall_cgpa numeric,
  rank integer,
  is_pass boolean,
  result_status text check (result_status in ('pass','fail','compartment','not_eligible','withheld')),
  grace_marks_applied_total numeric not null default 0,
  remarks_source text not null default 'legacy' check (remarks_source in ('legacy','rule','manual')),
  remarks text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (result_group_id, student_id)
);
create index result_group_cards_group_idx on public.result_group_cards (result_group_id);
