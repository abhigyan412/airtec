-- Reusable composite-Term blueprints: a school configures the STRUCTURE
-- once ("Term 1 = Unit Test 1 20% + Unit Test 2 20% + Half Yearly 60%")
-- and applies it against a class every year instead of manually adding
-- each member exam + weight by hand every time. Mirrors exam_templates'
-- shape (a blueprint table + a slots table), one level up for Result
-- Groups instead of real exams.
create table public.term_templates (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index term_templates_school_idx on public.term_templates (school_id);

-- exam_type is an optional hint only, never enforced — it pre-filters/
-- sorts the "pick the real exam for this slot" dropdown at apply-time.
-- No date/instance data here on purpose, same reasoning
-- exam_template_subjects already documents for itself: a template is
-- reused across years, only a real applied Result Group has real member
-- exams.
create table public.term_template_slots (
  id uuid primary key default extensions.uuid_generate_v4(),
  term_template_id uuid not null references public.term_templates(id) on delete cascade,
  label text not null,
  exam_type text check (exam_type in ('unit_test','monthly','half_yearly','annual','pre_board','practical','other')),
  weight_percent numeric not null check (weight_percent > 0 and weight_percent <= 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index term_template_slots_template_idx on public.term_template_slots (term_template_id);
