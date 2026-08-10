-- Payroll Stage 7: salary arrears — the inverse of Fees' arrears, here
-- the SCHOOL owes the employee back-pay (a late-processed promotion, a
-- backdated pay-scale revision).
--
-- Four states, not three: 'pending' is the obvious omission from a
-- literal reading of "status (staged / applied / cancelled)" — the rest
-- of the same plan text is explicit that nothing auto-approves ("a
-- human must confirm before they ride along on a payslip") and that
-- decide() is what MOVES a row to 'staged' ("Approval sets status to
-- staged"). Both auto-staged and manual rows start 'pending' and go
-- through the same decide() approval, same as payslip_corrections.
create table public.salary_arrears (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  from_month integer not null check (from_month between 1 and 12),
  from_year integer not null,
  to_month integer not null check (to_month between 1 and 12),
  to_year integer not null,
  amount numeric not null,
  reason text not null,
  source text not null default 'manual' check (source in ('manual', 'auto_promotion')),
  -- staff_position_history row id for auto-staged (one arrears row per
  -- intervening period, all pointing at the same promotion); null for manual.
  source_ref_id uuid,
  status text not null default 'pending' check (status in ('pending', 'staged', 'applied', 'cancelled')),
  applied_to_payslip_id uuid references public.payslips(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create index idx_salary_arrears_user on public.salary_arrears(user_id);
create index idx_salary_arrears_school_status on public.salary_arrears(school_id, status);
-- Generate's lookup: staged arrears for a user, not yet applied.
create index idx_salary_arrears_staged on public.salary_arrears(user_id) where status = 'staged';

-- Stage 6 note: arrears must be trackable as their OWN bucket in the
-- YTD tax projection (so Section 89 relief can be applied later without
-- re-identifying which rupees were arrears) — a separate column, not
-- folded into gross_salary, and included in net_salary since it's real
-- money paid out this payslip.
alter table public.payslips add column if not exists arrears_amount numeric not null default 0;
