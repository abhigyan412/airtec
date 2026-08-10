-- Payroll Stage 9: variable and non-fixed-salary staff.
--
-- Architecture check (done by reading, not by building first): Stage 5's
-- buildPayslipSegments/computeSegmentGross are keyed on FIXED salary
-- component fields (basic_salary, hra, da, ...), not on salary_structures
-- as an opaque FK — an hourly or per-session structure has no such
-- fields to prorate, so those two types get their own resolver branch
-- in Generate entirely, never forced through segmentation. Stipends,
-- by contrast, are additive on top of whatever gross the EXISTING path
-- already produced (fixed_monthly, unaffected) — no segment-model
-- change needed for them at all, confirming the plan's own hypothesis.

alter table public.salary_structures
  add column if not exists type text not null default 'fixed_monthly'
    check (type in ('fixed_monthly', 'hourly', 'per_session')),
  add column if not exists hourly_rate numeric;

-- Extra-responsibility stipend: additive on top of an existing fixed
-- structure, attached to the role ASSIGNMENT (not the role definition
-- itself, since the same role could carry a different stipend for a
-- different person, or none at all) — one nullable column, not a new
-- table, since it's a single number per assignment.
alter table public.user_roles add column if not exists stipend_amount numeric;

alter table public.schools
  add column if not exists overtime_rate_multiplier numeric not null default 1.5
    check (overtime_rate_multiplier > 0);

-- Per-session staff (invigilation, extra classes, ...) have no fixed
-- salary components at all — earnings come entirely from approved
-- entries here. Unapproved (approved_by is null) is deliberately not
-- picked up by Generate — same "approval performs the action" posture
-- as everything else added this session.
create table public.staff_duty_log (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  session_type text not null,
  description text,
  rate numeric not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.users(id),
  approved_at timestamptz
);
create index idx_staff_duty_log_user_date on public.staff_duty_log(user_id, date);
create index idx_staff_duty_log_school on public.staff_duty_log(school_id);

-- Three more earnings lines, same "separate column, added on top of
-- gross, doesn't feed PF/PT/TDS" treatment bonus_amount/leave_encashment
-- already get — consistent with this codebase's existing posture that
-- one-off/variable additions aren't folded into the taxable monthly
-- rate Stage 6 projects from.
alter table public.payslips
  add column if not exists stipend_amount numeric not null default 0,
  add column if not exists overtime_amount numeric not null default 0,
  add column if not exists session_pay_amount numeric not null default 0;
