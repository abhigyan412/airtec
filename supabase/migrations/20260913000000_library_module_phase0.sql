-- Library module, Phase 0: catalog + copies + members + the
-- customization backbone (settings + borrowing policies + permissions).
-- Circulation/fines/acquisition tables land in their own phases —
-- nothing here is read by any route yet, same "schema well ahead of
-- code" discipline as Result Settings Phase 1a and Transport Phase 0.
--
-- Design notes, from real Indian-school research (not guessed):
--  * is_circulating on book_titles (not just a category label) so
--    Reference/periodical items are enforced as room-only, not just
--    conventionally treated that way by a librarian who might forget.
--  * library_settings.timetable_subject_name is free text, not a hard-
--    coded 'Library' match — schools label the mandated CBSE library
--    period differently ("Library Hour", "Reading Period"), and this
--    is what a later circulation phase matches against
--    timetable_periods.subject_name to know today's library periods.
--  * library_members wraps a user_id + member_type rather than having
--    circulation join separately to students/staff — issue/return
--    logic shouldn't care which table the borrower actually lives in.

create table public.book_titles (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  subtitle text,
  authors text[] default '{}',
  publisher text,
  isbn text,
  edition text,
  language text,
  category text not null default 'fiction'
    check (category in ('fiction', 'non_fiction', 'reference', 'textbook', 'periodical', 'av_media', 'other')),
  is_circulating boolean not null default true,
  subject_name text,
  class_id uuid references public.classes(id) on delete set null,
  cover_url text,
  description text,
  classification_code text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_book_titles_school on public.book_titles (school_id);
create index idx_book_titles_isbn on public.book_titles (school_id, isbn) where isbn is not null;

create table public.book_copies (
  id uuid primary key default extensions.uuid_generate_v4(),
  title_id uuid not null references public.book_titles(id) on delete cascade,
  -- Denormalized from book_titles.school_id: accession numbers are a
  -- school-wide sequence in real library practice (never reused across
  -- titles), and a unique index needs school_id on this row directly —
  -- a correlated subquery into book_titles isn't valid in an index
  -- expression. Set alongside title_id wherever a copy is created.
  school_id uuid not null references public.schools(id) on delete cascade,
  accession_no text not null,
  barcode text,
  shelf_location text,
  condition text not null default 'good' check (condition in ('new', 'good', 'worn', 'damaged', 'lost')),
  status text not null default 'available' check (status in ('available', 'issued', 'reserved', 'lost', 'withdrawn', 'under_repair')),
  acquired_date date,
  cost numeric(10,2),
  source text not null default 'purchased' check (source in ('purchased', 'donated', 'book_bank')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, accession_no)
);
create index idx_book_copies_title on public.book_copies (title_id);
create index idx_book_copies_school on public.book_copies (school_id);
create index idx_book_copies_barcode on public.book_copies (barcode) where barcode is not null;

create table public.library_members (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  member_type text not null check (member_type in ('student', 'staff')),
  is_active boolean not null default true,
  membership_valid_until date,
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);
create index idx_library_members_school on public.library_members (school_id);

create table public.library_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  default_loan_days integer not null default 14,
  default_fine_per_day numeric(10,2) not null default 0,
  default_max_books integer not null default 3,
  grace_days integer not null default 0,
  timetable_subject_name text not null default 'Library',
  updated_at timestamptz not null default now()
);

-- Per-role or per-category override of the defaults above — a row here
-- beats library_settings' default the same way Result Settings' subject
-- overrides beat the class-level default. applies_to_role_id and
-- applies_to_category are both nullable; exactly one is expected to be
-- set per row (enforced in the application layer, not a CHECK, since
-- "exactly one of two nullable columns" as a CHECK reads worse than it
-- validates).
create table public.library_borrowing_policies (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  applies_to_role_id uuid references public.roles(id) on delete cascade,
  applies_to_category text check (applies_to_category in ('fiction', 'non_fiction', 'reference', 'textbook', 'periodical', 'av_media', 'other')),
  max_books integer,
  loan_days integer,
  renewal_limit integer,
  fine_per_day numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_library_borrowing_policies_school on public.library_borrowing_policies (school_id);
-- At most one policy row per role, and at most one per category — two
-- rows targeting the same role/category would leave "which one applies"
-- undefined for whatever later resolves a member's actual limits.
create unique index idx_library_borrowing_policies_role
  on public.library_borrowing_policies (school_id, applies_to_role_id) where applies_to_role_id is not null;
create unique index idx_library_borrowing_policies_category
  on public.library_borrowing_policies (school_id, applies_to_category) where applies_to_category is not null;

-- ═══════════════════════════════════════════════════════════════
-- PERMISSIONS
-- ═══════════════════════════════════════════════════════════════

insert into public.permissions (module, action, permission_code, description) values
  ('library', 'view',                'library.view',                'View the book catalog, loans and reservations'),
  ('library', 'manage_catalog',      'library.manage_catalog',      'Add or edit book titles and copies'),
  ('library', 'circulation',         'library.circulation',         'Issue, return and renew books'),
  ('library', 'manage_fines',        'library.manage_fines',        'Impose or waive library fines and lost-book charges'),
  ('library', 'settings_manage',     'library.settings_manage',     'Configure borrowing policies, fine rules and workflows'),
  ('library', 'manage_acquisition',  'library.manage_acquisition',  'Manage acquisition requests, donations and periodicals')
on conflict (permission_code) do nothing;

-- Backfill onto every existing school's roles — seedDefaultRoles() only
-- grants new codes to roles created from here on, not roles that
-- already exist for a school (same reasoning as every prior
-- permission-rollout migration this session).
with new_grants (role_name, permission_code) as (
  values
    ('School Admin',  'library.view'),
    ('School Admin',  'library.manage_catalog'),
    ('School Admin',  'library.circulation'),
    ('School Admin',  'library.manage_fines'),
    ('School Admin',  'library.settings_manage'),
    ('School Admin',  'library.manage_acquisition'),

    ('Principal',     'library.view'),
    ('Principal',     'library.manage_catalog'),
    ('Principal',     'library.circulation'),
    ('Principal',     'library.manage_fines'),
    ('Principal',     'library.settings_manage'),
    ('Principal',     'library.manage_acquisition'),

    -- Librarian previously had no library.* grants at all (only
    -- resource.* for the unrelated Resource Centre).
    ('Librarian',     'library.view'),
    ('Librarian',     'library.manage_catalog'),
    ('Librarian',     'library.circulation'),
    ('Librarian',     'library.manage_fines'),
    ('Librarian',     'library.settings_manage'),
    ('Librarian',     'library.manage_acquisition')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
