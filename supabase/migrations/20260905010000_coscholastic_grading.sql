-- Result Settings gap-closing, Phase B: co-scholastic / qualitative
-- grading — CBSE-style Discipline / Work Education / Health & Physical
-- Education / Attitude & Values / Life Skills grades.
--
-- Deliberately NOT modeled as exam subjects (the "grade_only,
-- include_in_aggregate: false" workaround this gap review flagged) —
-- co-scholastic assessment isn't tied to any one exam's datesheet, has no
-- marks/max-marks concept, and is graded directly by the class teacher
-- once per Term, not per exam. It hooks into result_groups (the existing
-- "Term" concept) instead.
--
-- Purely additive: a school that never configures an area or enters an
-- assessment sees no behavior change anywhere else in the app.

create table public.coscholastic_areas (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid references public.schools(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_system boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coscholastic_areas_school_idx on public.coscholastic_areas (school_id);

create table public.coscholastic_assessments (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  result_group_id uuid not null references public.result_groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  area_id uuid not null references public.coscholastic_areas(id) on delete cascade,
  grade_label text not null,
  remarks text,
  assessed_by uuid references public.users(id),
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (result_group_id, student_id, area_id)
);
create index coscholastic_assessments_group_idx on public.coscholastic_assessments (result_group_id);
create index coscholastic_assessments_student_idx on public.coscholastic_assessments (student_id);

-- Seed: CBSE's standard five co-scholastic areas, as system rows
-- (school_id NULL, is_system true) — same seed convention
-- 20260831010000_result_settings_schema.sql already used for grade
-- scales/remarks rules. Never read by default; a school explicitly picks
-- these up (or edits/replaces them) via the Co-Scholastic Areas tab.
insert into public.coscholastic_areas (school_id, name, sort_order, is_system) values
  (null, 'Discipline', 1, true),
  (null, 'Work Education', 2, true),
  (null, 'Health & Physical Education', 3, true),
  (null, 'Attitude & Values', 4, true),
  (null, 'Life Skills', 5, true);
