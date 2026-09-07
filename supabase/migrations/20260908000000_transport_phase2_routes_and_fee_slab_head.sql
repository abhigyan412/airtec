-- Transport Phase 2: routes/stops/student assignments already exist from
-- Phase 0 — this migration only closes a real gap found while wiring fee
-- slabs into billing: transport_fee_slabs had no way to say WHICH fee
-- head it prices. The obvious-looking fix (match fee_heads.code =
-- 'TRANSPORT') is fragile — that's a demo-seed convention
-- (backend/src/seedFees.ts), not a real constraint, so a school that
-- named or coded their transport fee head differently would never get
-- slab pricing applied, silently. Explicit is correct here: the school
-- picks which fee head a slab plan prices, same principle as this
-- session's earlier finding about name-based role matching being
-- fragile (EXCLUDED_ROLES/SUPER_ROLES).
--
-- Zero rows exist in transport_fee_slabs today (Fee Slabs is a brand
-- new Phase 0 feature with no adoption yet), so this is safe to add as
-- NOT NULL directly rather than nullable-then-backfill.
alter table public.transport_fee_slabs
  add column fee_head_id uuid not null references public.fee_heads(id) on delete cascade;

create index idx_transport_fee_slabs_fee_head on public.transport_fee_slabs (fee_head_id);
