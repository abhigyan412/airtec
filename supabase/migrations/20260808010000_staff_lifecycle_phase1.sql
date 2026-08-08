-- Staff & HR Phase 1: career lifecycle (promotion/transfer history,
-- resignation/exit, probation). Designation/department on staff_profiles
-- were previously overwritten in place by the generic Edit Profile form
-- with no history — this migration adds the history table and the exit
-- process, neither of which existed before.

-- Position/designation/department history. Never overwritten in place —
-- every change closes the currently-open row (effective_to) and opens a
-- new one. Mirrors the salary_structures deactivate-then-insert pattern.
create table public.staff_position_history (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  designation text,
  department text,
  branch text,
  salary_structure_id uuid references public.salary_structures(id),
  effective_from date not null,
  effective_to date,
  reason text,
  changed_by uuid references public.users(id),
  created_at timestamptz default now()
);
create index idx_staff_position_history_user on public.staff_position_history(user_id);
create index idx_staff_position_history_school on public.staff_position_history(school_id);

-- Exit / resignation record — one per staff member per resignation.
-- Settlement figures are computed once (on submit-settlement) and
-- stored here rather than recomputed on every read — leave balances
-- keep changing after submission, and this is what was actually
-- submitted for approval.
create table public.staff_exits (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  resignation_date date not null,
  last_working_day date not null,
  notice_period_days integer,
  reason text,
  status text not null default 'initiated'
    check (status in ('initiated','notice_period','cleared','settled')),
  initiated_by uuid references public.users(id),
  pending_leave_days numeric,
  leave_payout numeric,
  lop_deduction numeric default 0,
  advances_deduction numeric default 0,
  net_settlement numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_staff_exits_user on public.staff_exits(user_id);
create index idx_staff_exits_school on public.staff_exits(school_id);

-- Simple checklist, not a full asset-management system. Seeded with a
-- fixed default item set in application code when an exit is created.
create table public.staff_exit_checklist_items (
  id uuid default extensions.uuid_generate_v4() primary key,
  exit_id uuid not null references public.staff_exits(id) on delete cascade,
  item_name text not null,
  is_completed boolean default false,
  completed_by uuid references public.users(id),
  completed_at timestamptz,
  notes text
);
create index idx_staff_exit_checklist_exit on public.staff_exit_checklist_items(exit_id);

alter table public.staff_profiles add column probation_end_date date;

-- ═══════════════════════════════════════════════════════════════
-- Permissions — same two-part treatment as 20260808000000: new codes
-- into the registry, then backfilled into role_permissions_v2 for
-- existing live schools' already-seeded roles (seedDefaultRoles() only
-- helps brand-new schools going forward — see that migration's header
-- comment for why both halves are required).
-- ═══════════════════════════════════════════════════════════════

insert into public.permissions (module, action, permission_code, description) values
  ('staff', 'promote',      'staff.promote',      'Promote or transfer a staff member (designation/department/salary change with history)'),
  ('staff', 'exit_manage',  'staff.exit_manage',  'Manage staff resignation, clearance and full & final settlement')
on conflict (permission_code) do nothing;

with new_grants (role_name, permission_code) as (
  values
    ('School Admin', 'staff.promote'), ('Principal', 'staff.promote'),
    ('Vice Principal', 'staff.promote'), ('HR', 'staff.promote'),
    ('School Admin', 'staff.exit_manage'), ('Principal', 'staff.exit_manage'),
    ('Vice Principal', 'staff.exit_manage'), ('HR', 'staff.exit_manage')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
