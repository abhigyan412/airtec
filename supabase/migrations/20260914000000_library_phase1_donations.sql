-- Library Phase 1: the book-bank donation intake queue. A common
-- Indian-school affordability practice — a student donates last year's
-- textbook, the school reviews and redistributes it — distinct from
-- the acquisition-request/periodicals tables a later phase adds.
create table public.book_donations (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  donated_by_student_id uuid references public.students(id) on delete set null,
  title text not null,
  condition text check (condition in ('new', 'good', 'worn', 'damaged')),
  -- null = pending review, true = accepted (see accepted_copy_id), false = rejected.
  accepted boolean,
  accepted_copy_id uuid references public.book_copies(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_book_donations_school on public.book_donations (school_id);
create index idx_book_donations_pending on public.book_donations (school_id) where accepted is null;
