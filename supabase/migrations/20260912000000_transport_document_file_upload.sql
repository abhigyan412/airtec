-- vehicle_documents and driver_documents tracked type/number/expiry
-- since Phase 0 but never an actual scan of the document itself — the
-- exact same base64 -> storage bucket -> getPublicUrl() shape every
-- other document feature in this app already uses (student_documents,
-- staff_documents, application_documents). Nullable, not required:
-- a school can log "insurance expires March" before they have the
-- scanned copy on hand, and attach it later.
insert into storage.buckets (id, name, public)
values ('transport-documents', 'transport-documents', true)
on conflict (id) do nothing;

alter table public.vehicle_documents
  add column file_url text,
  add column file_size text,
  add column mime_type text;

alter table public.driver_documents
  add column file_url text,
  add column file_size text,
  add column mime_type text;
