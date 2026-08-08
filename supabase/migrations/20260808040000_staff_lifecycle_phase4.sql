-- Staff & HR Phase 4: leave policy depth. leave_types.carry_forward has
-- existed since the baseline schema but was never read anywhere — this
-- finally gives it (and three new policy fields) real behavior: monthly
-- accrual vs. today's implicit annual lump-sum, year-end carry-forward
-- capped per type, encashment of what's left, and comp-off (approved
-- like a leave request, credited like one too). Also adds a generic
-- delegated-approver fallback to the workflow engine so a single-holder
-- role (e.g. the one Principal) being on leave doesn't stall every
-- workflow that routes through it — not leave-specific, so it benefits
-- Exit/Regularization/Comp-Off approval as a side effect.

alter table public.leave_types
  add column accrual_frequency text not null default 'annual' check (accrual_frequency in ('annual','monthly')),
  add column max_carry_forward_days numeric default 0,
  add column is_encashable boolean default false,
  add column is_comp_off boolean default false;

-- Who may act on this person's behalf on workflow steps that require a
-- role they hold, while they are themselves on approved leave. Self- or
-- HR-settable via the same PUT /staff/:user_id/profile route as
-- shift_id (Phase 3). pending_leave_encashment_days is credited by the
-- year-end sweep and cleared at next payslip generation — stored as
-- days, not a rupee amount, so the payout uses that month's gross
-- (same reasoning as Phase 2's LOP: never a stale figure from January).
alter table public.staff_profiles
  add column leave_delegate_id uuid references public.users(id),
  add column pending_leave_encashment_days numeric default 0;

alter table public.payslips add column leave_encashment numeric default 0;

create table public.staff_comp_off_requests (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  worked_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
create index idx_staff_comp_off_requests_user on public.staff_comp_off_requests(user_id);
create index idx_staff_comp_off_requests_school on public.staff_comp_off_requests(school_id);

-- Dedupes the monthly accrual sweep the same way notifications' unique
-- index already dedupes fee reminders — unlike the once-a-year year-end
-- job, this one is plausibly re-triggered manually within the same
-- month (e.g. testing, or a host without a reliable long-lived cron),
-- and a re-run must not double-credit.
create table public.leave_accrual_log (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year integer not null,
  month integer not null,
  credited_days numeric not null,
  created_at timestamptz default now(),
  unique (user_id, leave_type_id, year, month)
);

-- No new permission codes: leave_types CRUD, comp-off approval, and the
-- manual accrual/year-end triggers all reuse staff.leave_approve — the
-- same "leave administration" responsibility domain already held by
-- School Admin/Principal/Vice Principal/HR by default.
