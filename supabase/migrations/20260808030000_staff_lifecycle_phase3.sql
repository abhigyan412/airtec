-- Staff & HR Phase 3: attendance enterprise basics. No shift/roster
-- concept exists anywhere in the schema before this — attendance and
-- working-day math has always assumed one school-wide schedule
-- (schools.weekly_off_days). This adds an optional per-staff override,
-- plus self-service regularization requests (reusing the generic
-- workflow engine, same as Phase 1's exit process) and basic overtime
-- capture.

create table public.staff_shifts (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  start_time time,
  end_time time,
  off_days integer[] default '{0}', -- same convention as schools.weekly_off_days
  created_at timestamptz default now()
);
create index idx_staff_shifts_school on public.staff_shifts(school_id);

-- Nullable: unset means "use the school-wide schedule" — today's
-- existing behavior, unchanged for every staff member until someone
-- explicitly assigns a shift.
alter table public.staff_profiles add column shift_id uuid references public.staff_shifts(id);

alter table public.staff_attendance add column overtime_hours numeric default 0;

create table public.staff_attendance_regularizations (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  requested_status text not null check (requested_status in ('present','absent','half_day','on_leave')),
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
create index idx_staff_attendance_regularizations_user on public.staff_attendance_regularizations(user_id);
create index idx_staff_attendance_regularizations_school on public.staff_attendance_regularizations(school_id);

-- No new permission codes: shift CRUD/assignment reuses staff.edit
-- (same domain as other staff_profiles field edits); regularization
-- approval reuses staff.attendance_mark (same responsibility as
-- marking attendance directly) — same non-fragmentation principle as
-- Phase 2's loans/statutory config.
