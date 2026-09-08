-- Real bug found in live verification: deriving the next accession
-- number from the MAX existing book_copies.accession_no only sees
-- currently-existing rows — delete a copy and the number it held gets
-- handed out again, which is exactly what a real library accession
-- register must never do (once assigned, a number is retired for
-- good, whether or not the physical book is still in the collection).
--
-- Fix: a durable per-school counter that only ever increments,
-- independent of book_copies' row history. Assigned atomically inside
-- Postgres (insert-or-increment-and-return in one statement) so two
-- concurrent "add a copy" calls can never receive the same number —
-- the Supabase JS client has no atomic "increment and return" op of
-- its own, so this has to be a function, the same reason this schema
-- already used Postgres functions for fee-invoice status derivation.
alter table public.library_settings
  add column next_accession_seq integer not null default 1;

create or replace function public.library_next_accession_no(p_school_id uuid)
returns text
language plpgsql
as $$
declare
  v_seq integer;
begin
  insert into public.library_settings (school_id, next_accession_seq)
  values (p_school_id, 2)
  on conflict (school_id) do update set next_accession_seq = library_settings.next_accession_seq + 1
  returning next_accession_seq - 1 into v_seq;
  return 'ACC-' || lpad(v_seq::text, 6, '0');
end;
$$;
