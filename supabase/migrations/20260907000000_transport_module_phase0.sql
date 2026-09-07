-- Transportation module, Phase 0: schema + permissions only. Nothing in
-- the backend reads these tables yet (fleet/network/trips routes land in
-- later phases) — this migration is safe to apply well ahead of any code
-- that uses it, same discipline as Result Settings Phase 1a.
--
-- Design notes:
--  * drivers is its own profile table (not just users.role='driver')
--    because a driver's license/expiry fields don't belong on every
--    user, and a school may want to onboard a driver before they have a
--    login at all. user_id is nullable and filled in once/if the driver
--    gets app access (matches how a driver is staff for push purposes —
--    see plan's App Integration section).
--  * vehicle_documents / driver_documents share one shape (doc_type,
--    number, issued_date, expiry_date) rather than two near-identical
--    tables, since both need the exact same expiry-alert treatment.
--  * driver_absences -> trip_substitute_assignments mirrors
--    teacher_absences -> arrangements (timetable module) deliberately —
--    same "absence creates a substitute overlay" shape, so the
--    materialize-on-create idiom can be reused when trips exist (Phase 4).
--  * transport_fee_slabs is modeled on professional_tax_slabs
--    (hrms/routes.ts) — a range-match lookup table — but a slab can also
--    be a flat named zone (label only, no distance range) or tied to a
--    specific route once routes exist, so schools aren't forced into a
--    distance-formula they don't use.

-- ═══════════════════════════════════════════════════════════════
-- FLEET
-- ═══════════════════════════════════════════════════════════════

create table public.vehicles (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  registration_no text not null,
  vehicle_type text not null default 'bus' check (vehicle_type in ('bus', 'van', 'minibus', 'car', 'other')),
  capacity integer not null check (capacity > 0),
  status text not null default 'active' check (status in ('active', 'in_service', 'maintenance', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, registration_no)
);
create index idx_vehicles_school on public.vehicles (school_id);

create table public.drivers (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  full_name text not null,
  phone text,
  license_no text not null,
  license_class text,
  license_expiry date,
  status text not null default 'active' check (status in ('active', 'on_leave', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_drivers_school on public.drivers (school_id);
create index idx_drivers_user on public.drivers (user_id) where user_id is not null;

-- Shared compliance-document shape for both vehicles and drivers, kept as
-- two tables (not a polymorphic one) so the FK stays a real, checkable
-- constraint rather than an owner_type/owner_id pair.
create table public.vehicle_documents (
  id uuid primary key default extensions.uuid_generate_v4(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  doc_type text not null check (doc_type in ('rc', 'insurance', 'permit', 'fitness', 'pollution', 'other')),
  document_no text,
  issued_date date,
  expiry_date date,
  created_at timestamptz not null default now()
);
create index idx_vehicle_documents_vehicle on public.vehicle_documents (vehicle_id);
create index idx_vehicle_documents_expiry on public.vehicle_documents (expiry_date) where expiry_date is not null;

create table public.driver_documents (
  id uuid primary key default extensions.uuid_generate_v4(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  doc_type text not null check (doc_type in ('license', 'medical_certificate', 'police_verification', 'other')),
  document_no text,
  issued_date date,
  expiry_date date,
  created_at timestamptz not null default now()
);
create index idx_driver_documents_driver on public.driver_documents (driver_id);
create index idx_driver_documents_expiry on public.driver_documents (expiry_date) where expiry_date is not null;

-- ═══════════════════════════════════════════════════════════════
-- ROUTES & STOPS
-- ═══════════════════════════════════════════════════════════════

create table public.routes (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);
create index idx_routes_school on public.routes (school_id);

create table public.stops (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  lat numeric,
  lng numeric,
  created_at timestamptz not null default now()
);
create index idx_stops_school on public.stops (school_id);

create table public.route_stops (
  id uuid primary key default extensions.uuid_generate_v4(),
  route_id uuid not null references public.routes(id) on delete cascade,
  stop_id uuid not null references public.stops(id) on delete cascade,
  sequence_no integer not null,
  distance_from_school_km numeric,
  unique (route_id, sequence_no)
);
create index idx_route_stops_route on public.route_stops (route_id);

create table public.student_transport_assignments (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  stop_id uuid not null references public.stops(id) on delete cascade,
  direction text not null default 'both' check (direction in ('pickup', 'drop', 'both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_student_transport_assignments_school on public.student_transport_assignments (school_id);
create index idx_student_transport_assignments_route on public.student_transport_assignments (route_id);
-- Partial, not a plain UNIQUE(student_id, is_active) — a plain constraint
-- would also cap a student to exactly one INACTIVE row ever, which is
-- wrong: every past route change leaves behind an is_active=false row,
-- and there can be many of those over a student's history. This only
-- enforces "at most one currently-active assignment per student."
create unique index idx_student_transport_assignments_one_active
  on public.student_transport_assignments (student_id) where is_active;

-- ═══════════════════════════════════════════════════════════════
-- FEE SLABS — school-defined, not hardcoded (Result-Settings parity)
-- ═══════════════════════════════════════════════════════════════

create table public.transport_fee_slabs (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  label text not null,
  route_id uuid references public.routes(id) on delete cascade,
  min_distance_km numeric,
  max_distance_km numeric,
  amount numeric(10,2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_transport_fee_slabs_school on public.transport_fee_slabs (school_id);
create index idx_transport_fee_slabs_route on public.transport_fee_slabs (route_id) where route_id is not null;

-- ═══════════════════════════════════════════════════════════════
-- TRIPS, BOARDING, LOCATION
-- ═══════════════════════════════════════════════════════════════

create table public.vehicle_trips (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  trip_date date not null,
  shift text not null default 'morning' check (shift in ('morning', 'afternoon')),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (route_id, trip_date, shift)
);
create index idx_vehicle_trips_school on public.vehicle_trips (school_id, trip_date);

create table public.trip_boarding_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  trip_id uuid not null references public.vehicle_trips(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  stop_id uuid references public.stops(id) on delete set null,
  event text not null check (event in ('boarded', 'alighted', 'absent_no_show')),
  method text not null default 'manual' check (method in ('manual', 'rfid', 'app')),
  recorded_by uuid references public.users(id),
  recorded_at timestamptz not null default now()
);
create index idx_trip_boarding_events_trip on public.trip_boarding_events (trip_id);
create index idx_trip_boarding_events_student on public.trip_boarding_events (student_id);

create table public.vehicle_location_pings (
  id uuid primary key default extensions.uuid_generate_v4(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  trip_id uuid references public.vehicle_trips(id) on delete cascade,
  lat numeric not null,
  lng numeric not null,
  recorded_at timestamptz not null default now()
);
create index idx_vehicle_location_pings_trip on public.vehicle_location_pings (trip_id, recorded_at desc);
create index idx_vehicle_location_pings_vehicle on public.vehicle_location_pings (vehicle_id, recorded_at desc);

-- ═══════════════════════════════════════════════════════════════
-- DRIVER ABSENCE -> SUBSTITUTE (mirrors teacher_absences/arrangements)
-- ═══════════════════════════════════════════════════════════════

create table public.driver_absences (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  absence_date date not null,
  reason text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (driver_id, absence_date)
);
create index idx_driver_absences_school on public.driver_absences (school_id, absence_date);

create table public.trip_substitute_assignments (
  id uuid primary key default extensions.uuid_generate_v4(),
  trip_id uuid not null references public.vehicle_trips(id) on delete cascade,
  absence_id uuid references public.driver_absences(id) on delete set null,
  absent_driver_id uuid not null references public.drivers(id),
  substitute_driver_id uuid references public.drivers(id),
  status text not null default 'unassigned' check (status in ('unassigned', 'assigned', 'acknowledged', 'declined')),
  assigned_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id)
);
create index idx_trip_substitute_assignments_trip on public.trip_substitute_assignments (trip_id);

-- ═══════════════════════════════════════════════════════════════
-- INCIDENTS / SOS
-- ═══════════════════════════════════════════════════════════════

create table public.transport_incidents (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  trip_id uuid references public.vehicle_trips(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  incident_type text not null check (incident_type in ('breakdown', 'accident', 'delay', 'sos', 'other')),
  reported_by uuid references public.users(id),
  status text not null default 'open' check (status in ('open', 'resolved')),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_transport_incidents_school on public.transport_incidents (school_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════
-- SCHOOL-LEVEL SETTINGS (boarding method, alert triggers, compliance
-- lead time) — one row per school, same "school configures the rules"
-- philosophy as everything else in this migration.
-- ═══════════════════════════════════════════════════════════════

create table public.transport_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  boarding_method text not null default 'manual' check (boarding_method in ('manual', 'rfid', 'app')),
  notify_boarded boolean not null default true,
  notify_alighted boolean not null default true,
  notify_delayed boolean not null default true,
  notify_approaching boolean not null default false,
  sync_boarding_to_attendance boolean not null default false,
  compliance_alert_lead_days integer not null default 30,
  updated_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════
-- PERMISSIONS — module.action convention, same shape as
-- 20260808000000_rbac_phase2_permissions.sql
-- ═══════════════════════════════════════════════════════════════

insert into public.permissions (module, action, permission_code, description) values
  ('transport', 'view',             'transport.view',             'View routes, stops, vehicles, drivers and trips'),
  ('transport', 'manage_fleet',     'transport.manage_fleet',     'Add or edit vehicles, drivers and their compliance documents'),
  ('transport', 'manage_routes',    'transport.manage_routes',    'Add or edit routes, stops and student stop assignments'),
  ('transport', 'manage_trips',     'transport.manage_trips',     'Schedule trips, assign substitute drivers, log incidents'),
  ('transport', 'mark_boarding',    'transport.mark_boarding',    'Record student boarding/alighting on a trip'),
  ('transport', 'settings_manage',  'transport.settings_manage',  'Configure fee slabs, workflows, boarding method and alert settings')
on conflict (permission_code) do nothing;

-- Backfill onto every existing school's roles — seedDefaultRoles() only
-- grants new codes to roles created from here on, not roles that already
-- exist for a school (same reasoning as rbac_phase2's own backfill step).
with new_grants (role_name, permission_code) as (
  values
    ('School Admin',    'transport.view'),
    ('School Admin',    'transport.manage_fleet'),
    ('School Admin',    'transport.manage_routes'),
    ('School Admin',    'transport.manage_trips'),
    ('School Admin',    'transport.mark_boarding'),
    ('School Admin',    'transport.settings_manage'),

    ('Principal',       'transport.view'),
    ('Principal',       'transport.manage_fleet'),
    ('Principal',       'transport.manage_routes'),
    ('Principal',       'transport.manage_trips'),
    ('Principal',       'transport.mark_boarding'),
    ('Principal',       'transport.settings_manage'),

    -- Transport Manager previously had only student.view (a placeholder
    -- role seeded with no real capability) — this is the first time it
    -- gets an actual permission set.
    ('Transport Manager','transport.view'),
    ('Transport Manager','transport.manage_fleet'),
    ('Transport Manager','transport.manage_routes'),
    ('Transport Manager','transport.manage_trips'),
    ('Transport Manager','transport.mark_boarding'),
    ('Transport Manager','transport.settings_manage')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
