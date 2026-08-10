-- Payroll Stage 2 + 5: salary structures gain a real date range, and a
-- payslip gains segments so a mid-month promotion can be represented
-- and prorated instead of the whole month landing on whichever
-- structure happens to be is_active when Generate runs.

-- ── Stage 2: salary_structures gets an end date ─────────────────────
-- is_active stays (other code still reads "what's current"), but
-- effective_to is now the authoritative field for resolving which
-- structure applied to which part of a billing period.
alter table public.salary_structures add column if not exists effective_to date;

create index if not exists idx_salary_structures_user_period
  on public.salary_structures (user_id, effective_from);

-- Backfill: for each user's history ordered by effective_from, a row's
-- effective_to is the day before the next row's effective_from. The
-- latest row per user is left NULL (still in effect).
with ordered as (
  select id, user_id,
         lead(effective_from) over (partition by user_id order by effective_from, created_at) as next_from
  from public.salary_structures
)
update public.salary_structures s
set effective_to = ordered.next_from - 1
from ordered
where s.id = ordered.id and ordered.next_from is not null and s.effective_to is null;

-- ── Stage 5: per-school proration basis for a segmented month ───────
-- Same pattern as lop_per_day_formula: a school-wide choice, not a
-- per-run one.
alter table public.schools add column if not exists segment_proration_basis text
  not null default 'calendar_days'
  check (segment_proration_basis in ('calendar_days', 'working_days'));

-- ── Stage 5: one payslip, one or more segments ───────────────────────
-- A payslip with no mid-month salary change gets exactly one segment
-- spanning the whole period — the existing single-structure case
-- becomes segment-count-of-one, not a separate code path.
create table public.payslip_segments (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  salary_structure_id uuid references public.salary_structures(id),
  segment_from date not null,
  segment_to date not null,
  -- Days this segment counted for, and the period's total under the
  -- same basis — kept alongside each other so the breakdown UI can
  -- show "12 of 30 days" without recomputing anything.
  basis_days numeric not null,
  total_basis_days numeric not null,
  basic_salary numeric not null default 0,
  hra numeric not null default 0,
  da numeric not null default 0,
  conveyance_allowance numeric not null default 0,
  medical_allowance numeric not null default 0,
  other_allowances numeric not null default 0,
  gross_salary numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index idx_payslip_segments_payslip on public.payslip_segments(payslip_id);
create index idx_payslip_segments_user on public.payslip_segments(user_id);
