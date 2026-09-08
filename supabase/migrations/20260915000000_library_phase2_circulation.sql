-- Library Phase 2: circulation (loans + reservations), and a real
-- design fix to library_members caught before circulation was built
-- on top of it.
--
-- library_members.user_id was NOT NULL, referencing users(id) only —
-- meaning a student with no login account (the common case in Indian
-- schools; students.user_id is nullable and most students don't have
-- individual portal logins, only their parents do) could never become
-- a library member at all, even though physical book circulation has
-- to work for every student regardless of portal access. Fixed the
-- same way this session already fixed "exactly one of two nullable
-- FKs" for library_borrowing_policies: student_id and user_id are both
-- nullable, exactly one is set, and each gets its own partial unique
-- index rather than one constraint that can't express "unique per
-- whichever column is actually populated."
alter table public.library_members alter column user_id drop not null;
alter table public.library_members add column student_id uuid references public.students(id) on delete cascade;
alter table public.library_members add constraint library_members_exactly_one_owner
  check ((student_id is not null) <> (user_id is not null));

alter table public.library_members drop constraint library_members_school_id_user_id_key;
create unique index idx_library_members_student on public.library_members (school_id, student_id) where student_id is not null;
create unique index idx_library_members_user on public.library_members (school_id, user_id) where user_id is not null;

-- ═══════════════════════════════════════════════════════════════
-- LOANS & RESERVATIONS
-- ═══════════════════════════════════════════════════════════════
create table public.book_loans (
  id uuid primary key default extensions.uuid_generate_v4(),
  copy_id uuid not null references public.book_copies(id) on delete cascade,
  member_id uuid not null references public.library_members(id) on delete cascade,
  issued_at timestamptz not null default now(),
  due_date date not null,
  returned_at timestamptz,
  renewed_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'returned', 'overdue', 'lost', 'recalled')),
  issued_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index idx_book_loans_copy on public.book_loans (copy_id);
create index idx_book_loans_member on public.book_loans (member_id);
create index idx_book_loans_status on public.book_loans (status) where status in ('active', 'overdue');
-- A copy can only be on one ACTIVE loan at a time — the same
-- one-active-row-per-key shape this session used for
-- student_transport_assignments, enforced the same way (partial
-- unique index, not a plain one, since a copy's full history has many
-- returned/lost rows over its lifetime).
create unique index idx_book_loans_one_active_per_copy on public.book_loans (copy_id) where status in ('active', 'overdue');

create table public.book_reservations (
  id uuid primary key default extensions.uuid_generate_v4(),
  title_id uuid not null references public.book_titles(id) on delete cascade,
  member_id uuid not null references public.library_members(id) on delete cascade,
  reserved_at timestamptz not null default now(),
  queue_position integer not null,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'fulfilled', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_book_reservations_title on public.book_reservations (title_id);
create index idx_book_reservations_member on public.book_reservations (member_id);
-- One live (waiting/ready) reservation per member per title — no
-- queue-jumping by reserving the same title twice.
create unique index idx_book_reservations_one_live_per_member_title
  on public.book_reservations (title_id, member_id) where status in ('waiting', 'ready');
