-- Result Settings, Phase 1a: the configuration tables. Nothing here is read
-- by any existing code path yet — computeGrade() and generate-results are
-- untouched until Phase 2's refactor, so applying this migration changes
-- nothing about how any existing exam's results compute.
--
-- Reusable grading/remarks tables, then the actual per-class/per-subject
-- rule tables that reference them. Every rule table is keyed on exam_type
-- (the enum already on every `exams` row), not a template id — `exams` has
-- no column recording which exam_templates row it came from, and most
-- exams are created from scratch with no template at all, so a template FK
-- would leave those exams unable to resolve a type-specific rule. exam_type
-- is nullable everywhere it appears here: NULL means "this class's default
-- rule, applied to any exam type with no row of its own".

-- ═══════════════════════════════════════════════════════════════
-- GRADE SCALES — reusable letter-grade / CGPA tables
-- ═══════════════════════════════════════════════════════════════

create table public.exam_grade_scales (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid references public.schools(id) on delete cascade,
  name text not null,
  scale_type text not null check (scale_type in ('grade','cgpa')),
  is_system boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exam_grade_scales_school_idx on public.exam_grade_scales (school_id);

create table public.exam_grade_bands (
  id uuid primary key default extensions.uuid_generate_v4(),
  grade_scale_id uuid not null references public.exam_grade_scales(id) on delete cascade,
  min_percent numeric not null,
  max_percent numeric not null,
  grade_label text not null,
  grade_point numeric,
  is_pass boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (grade_scale_id, sort_order)
);
create index exam_grade_bands_scale_idx on public.exam_grade_bands (grade_scale_id);

-- ═══════════════════════════════════════════════════════════════
-- REMARKS RULES — outcome -> free-text remark, same reusable pattern
-- ═══════════════════════════════════════════════════════════════

create table public.exam_remarks_rules (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid references public.schools(id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exam_remarks_rules_school_idx on public.exam_remarks_rules (school_id);

create table public.exam_remarks_bands (
  id uuid primary key default extensions.uuid_generate_v4(),
  remarks_rule_id uuid not null references public.exam_remarks_rules(id) on delete cascade,
  -- Matched against the computed outcome's result_status directly. When
  -- match_status = 'pass' and min/max_percent are also set, the band only
  -- fires within that percentage range (lets a school say "Pass, 90%+ ->
  -- Excellent" as a finer band than a flat "Pass" -> "Pass"). A row with
  -- match_status='pass' and no percent range is the catch-all for every
  -- passing result not covered by a narrower band.
  match_status text not null check (match_status in ('pass','fail','compartment','not_eligible','withheld')),
  min_percent numeric,
  max_percent numeric,
  remark_text text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (remarks_rule_id, sort_order)
);
create index exam_remarks_bands_rule_idx on public.exam_remarks_bands (remarks_rule_id);

-- ═══════════════════════════════════════════════════════════════
-- CLASS RESULT RULES — the core per-class(+exam-type) policy
-- ═══════════════════════════════════════════════════════════════

create table public.exam_class_result_rules (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  exam_type text check (exam_type in ('unit_test','monthly','half_yearly','annual','pre_board','practical','other')),

  promotion_policy text not null default 'standard' check (promotion_policy in ('standard','no_detention')),

  pass_criteria_mode text not null default 'aggregate' check (pass_criteria_mode in ('aggregate','per_subject')),
  pass_criteria_requires_aggregate boolean not null default true,
  aggregate_pass_percent numeric not null default 33,

  best_of_subjects_count integer,
  allow_additional_subject_substitution boolean not null default false,

  compartment_policy text not null default 'none' check (compartment_policy in ('none','allow')),
  compartment_max_failed_subjects integer,

  min_attendance_percent numeric,

  max_grace_marks_per_subject numeric not null default 0,
  max_grace_marks_total numeric not null default 0,

  rounding_mode text not null default 'nearest' check (rounding_mode in ('nearest','floor','ceil')),
  rounding_decimals integer not null default 2,

  grading_mode text not null default 'marks' check (grading_mode in ('marks','grade_only','cgpa')),
  grade_scale_id uuid references public.exam_grade_scales(id) on delete set null,
  remarks_rule_id uuid references public.exam_remarks_rules(id) on delete set null,

  applied_preset_key text,

  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A plain UNIQUE(school_id, class_id, exam_type) would NOT stop two
-- class-default rows (exam_type both NULL) for the same class, since
-- Postgres treats NULLs as distinct for uniqueness. Two partial indexes
-- instead: at most one row per (school, class, type) when type is set, at
-- most one default row per (school, class) when it's not.
create unique index exam_class_result_rules_type_uidx
  on public.exam_class_result_rules (school_id, class_id, exam_type)
  where exam_type is not null;
create unique index exam_class_result_rules_default_uidx
  on public.exam_class_result_rules (school_id, class_id)
  where exam_type is null;

-- ═══════════════════════════════════════════════════════════════
-- SUBJECT-LEVEL OVERRIDES — per (class, exam type, subject) deviations
-- from the resolved class rule; every field independently nullable
-- (NULL = inherit).
-- ═══════════════════════════════════════════════════════════════

create table public.exam_subject_result_overrides (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  exam_type text check (exam_type in ('unit_test','monthly','half_yearly','annual','pre_board','practical','other')),
  subject_name text not null,

  pass_criteria_mode text check (pass_criteria_mode in ('aggregate','per_subject')),
  aggregate_pass_percent numeric,
  grading_mode text check (grading_mode in ('marks','grade_only','cgpa')),
  grade_scale_id uuid references public.exam_grade_scales(id) on delete set null,

  -- UI hint only, pre-checks "Split Theory/Practical" when this subject is
  -- next added to a real exam's datesheet. Enforcement source of truth is
  -- always the specific exam_subjects row's own split columns.
  has_practical boolean not null default false,
  is_additional boolean not null default false,
  include_in_aggregate boolean not null default true,
  subject_group_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index exam_subject_overrides_type_uidx
  on public.exam_subject_result_overrides (school_id, class_id, exam_type, subject_name)
  where exam_type is not null;
create unique index exam_subject_overrides_default_uidx
  on public.exam_subject_result_overrides (school_id, class_id, subject_name)
  where exam_type is null;

-- ═══════════════════════════════════════════════════════════════
-- SEED: two system scales/rules (school_id NULL, is_system true) — never
-- read by default (the fallback path is "no grade_scale_id set", not
-- "read this row"). They exist so a school can explicitly adopt "what it
-- already had" (Generic) or a real board scale (CBSE) as an editable
-- starting point, or duplicate either into a custom one.
-- ═══════════════════════════════════════════════════════════════

insert into public.exam_grade_scales (id, school_id, name, scale_type, is_system) values
  ('00000000-0000-0000-0000-0000000000e1', null, 'Generic (Legacy Bands)', 'grade', true),
  ('00000000-0000-0000-0000-0000000000e2', null, 'CBSE 9-Point CGPA', 'cgpa', true);

-- Matches computeGrade() (exam/routes.ts:712) exactly: >=90 A+, >=80 A,
-- >=70 B+, >=60 B, >=50 C, >=33 D, else F.
insert into public.exam_grade_bands (grade_scale_id, min_percent, max_percent, grade_label, grade_point, is_pass, sort_order) values
  ('00000000-0000-0000-0000-0000000000e1', 90, 100,   'A+', null, true,  1),
  ('00000000-0000-0000-0000-0000000000e1', 80, 89.99, 'A',  null, true,  2),
  ('00000000-0000-0000-0000-0000000000e1', 70, 79.99, 'B+', null, true,  3),
  ('00000000-0000-0000-0000-0000000000e1', 60, 69.99, 'B',  null, true,  4),
  ('00000000-0000-0000-0000-0000000000e1', 50, 59.99, 'C',  null, true,  5),
  ('00000000-0000-0000-0000-0000000000e1', 33, 49.99, 'D',  null, true,  6),
  ('00000000-0000-0000-0000-0000000000e1', 0,  32.99, 'F',  null, false, 7);

-- CBSE's real 9-point scale (A1..E2).
insert into public.exam_grade_bands (grade_scale_id, min_percent, max_percent, grade_label, grade_point, is_pass, sort_order) values
  ('00000000-0000-0000-0000-0000000000e2', 91, 100,   'A1', 10, true,  1),
  ('00000000-0000-0000-0000-0000000000e2', 81, 90.99, 'A2', 9,  true,  2),
  ('00000000-0000-0000-0000-0000000000e2', 71, 80.99, 'B1', 8,  true,  3),
  ('00000000-0000-0000-0000-0000000000e2', 61, 70.99, 'B2', 7,  true,  4),
  ('00000000-0000-0000-0000-0000000000e2', 51, 60.99, 'C1', 6,  true,  5),
  ('00000000-0000-0000-0000-0000000000e2', 41, 50.99, 'C2', 5,  true,  6),
  ('00000000-0000-0000-0000-0000000000e2', 33, 40.99, 'D',  4,  true,  7),
  ('00000000-0000-0000-0000-0000000000e2', 21, 32.99, 'E1', 0,  false, 8),
  ('00000000-0000-0000-0000-0000000000e2', 0,  20.99, 'E2', 0,  false, 9);

insert into public.exam_remarks_rules (id, school_id, name, is_system) values
  ('00000000-0000-0000-0000-0000000000e3', null, 'Standard (Legacy)', true);

insert into public.exam_remarks_bands (remarks_rule_id, match_status, min_percent, max_percent, remark_text, sort_order) values
  ('00000000-0000-0000-0000-0000000000e3', 'pass',         null, null, 'Pass',                    1),
  ('00000000-0000-0000-0000-0000000000e3', 'fail',         null, null, 'Fail',                    2),
  ('00000000-0000-0000-0000-0000000000e3', 'compartment',  null, null, 'Compartment',             3),
  ('00000000-0000-0000-0000-0000000000e3', 'not_eligible', null, null, 'Not Eligible to Appear',  4),
  ('00000000-0000-0000-0000-0000000000e3', 'withheld',     null, null, 'Result Withheld',         5);
