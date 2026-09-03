-- Standalone table for the SchoolKnot demo mapping. No foreign keys, nothing
-- references it — teardown is a single DROP. Create it once per Supabase
-- project (already created on the demo project):
create table if not exists public.schoolknot_staff_mapping (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  email text not null,
  schoolknot_school text not null,
  reg text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (school_id, email)
);

-- Teardown (with the schoolknot.* files):
--   drop table if exists public.schoolknot_staff_mapping;
