-- Library Phase 4: textbook distribution (compliance record, not a
-- loan), acquisition requests, periodicals/serials, and stock
-- verification audits.

-- RTE/state-scheme free-textbook distribution is a give, not a lend —
-- modeling it as a book_loan (with a due date that will never be met)
-- would be wrong. book_name is always stored so the record stays
-- self-contained even if the linked title is later edited or removed.
create table public.textbook_distributions (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id),
  title_id uuid references public.book_titles(id) on delete set null,
  book_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  scheme text not null check (scheme in ('rte', 'state_free_textbook', 'other')),
  distributed_at timestamptz not null default now(),
  distributed_by uuid references public.users(id),
  notes text
);
create index idx_textbook_distributions_school on public.textbook_distributions (school_id);
create index idx_textbook_distributions_student on public.textbook_distributions (student_id);
create index idx_textbook_distributions_year on public.textbook_distributions (academic_year_id);

-- A purchase decision is a budget call — same Librarian-review then
-- Principal-approval tier as Transport's Vehicle Onboarding. The
-- workflow definition (book_acquisition_request entity type) was
-- already seeded in Phase 0; this table is what it actually attaches to.
create table public.book_acquisition_requests (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  title text not null,
  author text,
  reason text,
  estimated_cost numeric(10,2),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'ordered', 'received')),
  received_copy_id uuid references public.book_copies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_book_acquisition_requests_school on public.book_acquisition_requests (school_id);

-- Periodicals/serials (newspapers, magazines) — a subscription plus the
-- expected issues under it, so a librarian can see "issue due this week
-- never arrived" instead of relying on memory.
create table public.periodicals (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual')),
  vendor text,
  subscription_valid_until date,
  created_at timestamptz not null default now()
);
create index idx_periodicals_school on public.periodicals (school_id);

create table public.periodical_issues (
  id uuid primary key default extensions.uuid_generate_v4(),
  periodical_id uuid not null references public.periodicals(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  issue_date date not null,
  received_at timestamptz,
  status text not null default 'expected' check (status in ('expected', 'received', 'missing')),
  unique (periodical_id, issue_date)
);
create index idx_periodical_issues_school on public.periodical_issues (school_id);

-- Stock verification: a periodic physical count against the register,
-- the same accountability exercise every real library runs (and every
-- audit checklist expects), scoped as one audit "session" with one row
-- per copy checked against.
create table public.library_stock_audits (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_by uuid references public.users(id)
);
create index idx_library_stock_audits_school on public.library_stock_audits (school_id);

create table public.library_stock_audit_items (
  id uuid primary key default extensions.uuid_generate_v4(),
  audit_id uuid not null references public.library_stock_audits(id) on delete cascade,
  copy_id uuid not null references public.book_copies(id) on delete cascade,
  expected_status text not null,
  found boolean,
  discrepancy_note text,
  scanned_at timestamptz,
  unique (audit_id, copy_id)
);
create index idx_library_stock_audit_items_audit on public.library_stock_audit_items (audit_id);

-- Stock verification is a distinct, occasional formal accountability
-- process (often run jointly with the Principal), not a day-to-day
-- catalog edit — its own permission code rather than piggybacking on
-- library.manage_catalog.
insert into public.permissions (module, action, permission_code, description) values
  ('library', 'stock_audit', 'library.stock_audit', 'Run and record physical stock-verification audits')
on conflict (permission_code) do nothing;

with new_grants (role_name, permission_code) as (
  values
    ('School Admin', 'library.stock_audit'),
    ('Principal',    'library.stock_audit'),
    ('Librarian',    'library.stock_audit')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
