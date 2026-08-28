-- Organizational Settings -> Syllabus Setup, "Upload a reference document"
-- option — a raw file (a CBSE-issued syllabus PDF, a scanned copy of
-- last year's plan, whatever the school already has) kept as-is against
-- a class/section/subject, distinct from syllabus_chapters (the
-- structured chapter-by-chapter plan the Import and Type-it-in options
-- both write into). Section is nullable for the same reason it is on
-- syllabus_chapters itself: null means "applies to every section of the
-- class".

create table public.syllabus_documents (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id),
  class_id uuid not null references public.classes(id),
  section_id uuid references public.sections(id),
  subject_name text not null,
  document_name text not null,
  file_url text not null,
  file_size text,
  mime_type text,
  uploaded_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index syllabus_documents_school_class_subject_idx on public.syllabus_documents (school_id, class_id, subject_name);

insert into storage.buckets (id, name, public)
values ('syllabus-documents', 'syllabus-documents', true)
on conflict (id) do nothing;
