-- Staff & HR Phase 6: documents & compliance. Mirrors student_documents
-- exactly (backend/src/modules/sis/routes.ts) for staff — same base64
-- upload -> storage bucket -> getPublicUrl() shape, just a new bucket
-- and table. No migration created the existing buckets (resources,
-- student-documents, student-photos) — they were made via the Supabase
-- dashboard — so this one creates staff-documents itself for
-- reproducibility rather than requiring a manual step.

insert into storage.buckets (id, name, public)
values ('staff-documents', 'staff-documents', true)
on conflict (id) do nothing;

create table public.staff_documents (
  id uuid default extensions.uuid_generate_v4() primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  document_type text not null default 'other'
    check (document_type in ('contract','id_proof','certification','police_verification','offer_letter','policy','other')),
  document_name text not null,
  file_url text not null,
  file_size text,
  mime_type text,
  notes text,
  expiry_date date,
  -- Simple e-acknowledgment: a timestamp + who, no cryptographic
  -- signing. Self-only — see POST .../documents/:doc_id/acknowledge.
  requires_acknowledgment boolean default false,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id),
  uploaded_by uuid references public.users(id),
  created_at timestamptz default now()
);
create index idx_staff_documents_user on public.staff_documents(user_id);
create index idx_staff_documents_school on public.staff_documents(school_id);
create index idx_staff_documents_expiry on public.staff_documents(expiry_date) where expiry_date is not null;

-- No new permission codes: view is self-or-staff.edit, upload/delete
-- are staff.edit, acknowledge is self-only — same non-fragmentation
-- principle as every prior phase.
