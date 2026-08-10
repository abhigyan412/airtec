-- Payroll Stage 3 + 4.
--
-- Stage 3: closing the notice-period double-pay window found in the
-- audit — employment_status only flips to 'resigned' at settlement
-- APPROVAL, so someone whose last working day has already passed but
-- whose settlement hasn't been approved yet still generates normally.
--
-- Stage 4: a real correction path for an approved/paid payslip.
-- payslips keeps its UNIQUE(user_id, month, year) exactly as-is —
-- Generate's .upsert(..., {onConflict:'user_id,month,year'}) needs a
-- real (non-partial) unique index to target, so "keep both on record"
-- is done by snapshotting the ORIGINAL figures into a correction row
-- and updating the live payslip in place, rather than by trying to
-- keep two payslips rows alive for the same period.

alter table public.payslips add column if not exists payment_exported boolean not null default false;
alter table public.payslips add column if not exists correction_adjustment numeric not null default 0;

create table public.payslip_corrections (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('void_replace', 'adjustment')),
  reason text not null,
  -- void_replace: what the payslip said before, and what it's being
  -- corrected to (applied by overwriting the live payslip row and
  -- kicking it back to 'pending' for re-approval — nothing has been
  -- paid out under the wrong figures yet).
  original_values jsonb,
  corrected_values jsonb,
  -- adjustment: money already left via bank export or was marked paid
  -- outside it, so the ORIGINAL payslip stands as historically
  -- accurate. Positive = a top-up owed to the employee, negative = a
  -- recovery owed back to the school — applied as its own line on
  -- whichever payslip is generated for them NEXT, not retroactively.
  adjustment_amount numeric,
  applied_to_payslip_id uuid references public.payslips(id),
  requested_by uuid not null references public.users(id),
  requested_at timestamptz not null default now(),
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index idx_payslip_corrections_payslip on public.payslip_corrections(payslip_id);
create index idx_payslip_corrections_user_pending on public.payslip_corrections(user_id) where decision = 'approved' and kind = 'adjustment' and applied_to_payslip_id is null;
-- One open (undecided) correction per payslip at a time — a second
-- request while one is already pending is confusion, not a new fact.
create unique index idx_payslip_corrections_one_open on public.payslip_corrections(payslip_id) where decision = 'pending';

-- ── DB-level guard against double-accounting LOP across a payslip and
-- an exit settlement for the same final month ─────────────────────
--
-- The application is supposed to net settlement's lop_deduction to 0
-- when a regular payslip already exists for the month containing
-- last_working_day (that payslip already deducted it). This trigger
-- makes that a hard rule, not just application discipline: settling
-- an exit is refused if a payslip exists for that month with nonzero
-- lop_amount AND the settlement is also trying to carry a nonzero
-- lop_deduction of its own.
create or replace function public.check_exit_settlement_no_double_lop()
returns trigger as $$
declare
  v_payslip_lop numeric;
begin
  if NEW.status = 'settled' and (OLD.status is distinct from 'settled') then
    select p.lop_amount into v_payslip_lop
    from public.payslips p
    where p.user_id = NEW.user_id
      and make_date(p.year, p.month, 1) = date_trunc('month', NEW.last_working_day)::date
    limit 1;

    if v_payslip_lop is not null and v_payslip_lop > 0 and coalesce(NEW.lop_deduction, 0) > 0 then
      raise exception 'A payslip already exists for the exit month and already deducted LOP (%). Settlement lop_deduction must be netted to 0 before settling — recompute settlement instead of settling with both nonzero.', v_payslip_lop;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_exit_settlement_no_double_lop
  before update on public.staff_exits
  for each row execute function public.check_exit_settlement_no_double_lop();
