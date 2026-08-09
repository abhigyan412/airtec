-- Staff & HR Phase 2: payroll completion. LOP was previously hardcoded
-- to 0 at payslip generation time despite the attendance report already
-- computing real unmarked/absent counts (Phase 1 session work) — this
-- wires that data into actual deductions, and adds statutory line items
-- (employer PF, TDS, slab-based professional tax) and loan recovery as
-- real payslip fields instead of folding everything into
-- "other_deductions".

alter table public.salary_structures add column pf_employer numeric default 0;

alter table public.payslips add column pf_employer numeric default 0;
alter table public.payslips add column tds numeric default 0;
alter table public.payslips add column loan_deduction numeric default 0;

-- Drive-by fix: the frontend (hr/payroll/page.tsx) already renders an
-- 'on_hold' payment_status badge, but the DB constraint never allowed
-- it — caught while already altering this table for the columns above.
alter table public.payslips drop constraint payslips_payment_status_check;
alter table public.payslips add constraint payslips_payment_status_check
  check (payment_status in ('pending','approved','paid','failed','on_hold'));

-- Same convention as the existing weekly_off_days/low_attendance_threshold_pct
-- school-level settings.
alter table public.schools add column lop_grace_days integer default 0;
alter table public.schools add column lop_per_day_formula text default 'gross_30'
  check (lop_per_day_formula in ('gross_30','working_days'));

-- School-configurable professional tax bands. Real PT tables vary by
-- Indian state in ways that can't be verified as current here, so this
-- is a lookup a school configures rather than hardcoded state rules.
-- Falls back to salary_structures.professional_tax's existing flat
-- value when no slabs are configured for a school.
create table public.professional_tax_slabs (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  min_gross numeric not null,
  max_gross numeric,
  amount numeric not null,
  created_at timestamptz default now()
);
create index idx_professional_tax_slabs_school on public.professional_tax_slabs(school_id);

create table public.staff_loans (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  principal_amount numeric not null,
  reason text,
  installment_amount numeric not null,
  installments_total integer not null,
  installments_paid integer default 0,
  status text not null default 'active' check (status in ('active','settled','cancelled')),
  issued_by uuid references public.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_staff_loans_user on public.staff_loans(user_id);
create index idx_staff_loans_school on public.staff_loans(school_id);

-- Payslip-ready notifications need a new type in the same closed union
-- notifications.type is constrained to (matches NotificationType in
-- backend/src/shared/utils/notifications.ts, updated alongside this).
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'attendance_absent','leave_approved','leave_rejected',
        'tc_approved','tc_rejected','discount_approved','discount_rejected',
        'homework_assigned','exam_result_published','fee_due_soon','fee_overdue',
        'payslip_generated'
    ]));

-- No new permission codes: loans and statutory config are payroll-
-- adjacent financial actions, so they reuse staff.payroll_manage
-- (write) / staff.payroll_view (read) rather than fragmenting an
-- existing responsibility domain — see Phase 1's own reasoning for
-- why staff.promote/staff.exit_manage got separate codes (they were
-- genuinely different domains, career vs payroll).
