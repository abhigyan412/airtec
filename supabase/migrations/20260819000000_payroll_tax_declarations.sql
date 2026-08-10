-- Payroll Stage 6: year-to-date tax computation.
--
-- The academic_years table is already this school's fiscal year (seeded
-- April-March, confirmed against backend/src/seed.ts) — no new fiscal-year
-- concept needed, just linking to the one that already exists.
--
-- staff_tax_declarations holds what a staff member has told payroll
-- they're claiming for this FY; the TDS computation reads it to reduce
-- projected taxable income. tax_declaration_windows holds the per-year
-- cutoff after which self-service edits are refused (payroll still needs
-- a stable number to withhold correctly for the rest of the year).

create table public.staff_tax_declarations (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  -- Statutory cap (₹150,000) is enforced in application code, not here —
  -- keeping the raw declared figure on file is more honest than silently
  -- truncating it at the DB layer.
  section_80c numeric not null default 0,
  hra_exemption numeric not null default 0,
  other_exemptions numeric not null default 0,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, academic_year_id)
);
create index idx_tax_declarations_school_year on public.staff_tax_declarations(school_id, academic_year_id);

create table public.tax_declaration_windows (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  lock_date date not null,
  unique (school_id, academic_year_id)
);
