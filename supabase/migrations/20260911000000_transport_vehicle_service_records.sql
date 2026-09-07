-- Vehicle Profile page needs a real maintenance history, not just
-- compliance documents (RC/insurance/permit/fitness/pollution already
-- tracked via vehicle_documents since Phase 0). next_service_due_date
-- lives on the service record itself (you log a service and note when
-- the next one should happen), not a separate column on vehicles —
-- the same shape vehicle_documents already uses (expiry lives on the
-- document, not the vehicle), so the same compliance-alert sweep can
-- be extended to cover it.
create table public.vehicle_service_records (
  id uuid primary key default extensions.uuid_generate_v4(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  service_date date not null,
  service_type text not null default 'routine' check (service_type in ('routine', 'repair', 'inspection', 'other')),
  odometer_km numeric,
  cost numeric(10,2),
  next_service_due_date date,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index idx_vehicle_service_records_vehicle on public.vehicle_service_records (vehicle_id, service_date desc);
create index idx_vehicle_service_records_due on public.vehicle_service_records (next_service_due_date) where next_service_due_date is not null;
