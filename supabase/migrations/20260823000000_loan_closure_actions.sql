-- UI audit gap: the only loan action was a single generic "Cancel"
-- (PATCH status='cancelled'), usable even on a loan with installments
-- already paid — which isn't a cancellation, it's either an early
-- payoff (fully recovered, just not via the normal schedule) or a
-- write-off (school forgives the remainder). Splitting into three real
-- outcomes rather than one ambiguous status transition.
alter table public.staff_loans drop constraint staff_loans_status_check;
alter table public.staff_loans add constraint staff_loans_status_check
  check (status in ('active', 'settled', 'written_off', 'cancelled'));

alter table public.staff_loans add column if not exists closure_note text;
alter table public.staff_loans add column if not exists closed_at timestamptz;
