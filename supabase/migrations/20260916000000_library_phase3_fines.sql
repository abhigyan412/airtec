-- Library Phase 3: fines. school_id is denormalized here (reachable via
-- member_id -> library_members.school_id) for the same reason every
-- other tenant-scoped table in this session gets it directly — simpler,
-- indexable queries instead of a join on every request.
create table public.library_fines (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  loan_id uuid references public.book_loans(id) on delete cascade,
  member_id uuid not null references public.library_members(id) on delete cascade,
  fine_type text not null check (fine_type in ('overdue', 'lost', 'damage')),
  amount numeric(10,2) not null,
  calc_basis text not null default 'flat' check (calc_basis in ('flat', 'per_day', 'pct_of_cost')),
  status text not null default 'pending' check (status in ('pending', 'waived', 'billed')),
  fee_adhoc_charge_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_library_fines_school on public.library_fines (school_id);
create index idx_library_fines_member on public.library_fines (member_id);
create index idx_library_fines_loan on public.library_fines (loan_id) where loan_id is not null;
-- One pending overdue fine per loan — the daily sweep updates its
-- amount as days accrue rather than creating a new row every run.
create unique index idx_library_fines_one_pending_overdue_per_loan
  on public.library_fines (loan_id) where fine_type = 'overdue' and status = 'pending';
