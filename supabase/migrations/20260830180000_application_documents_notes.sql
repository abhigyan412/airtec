-- application_documents was brought in line with the student-documents
-- sibling table's shape (school_id, mime_type, file_size, uploaded_by) in
-- 20260830030000, but that migration missed `notes` — student_documents
-- has always had it, and POST /applications/:id/documents (routes.ts) has
-- always tried to write it, and the upload form has always had a "Notes"
-- field. Every document upload for an application has been failing with
-- "Could not find the 'notes' column" until this ships.
ALTER TABLE public.application_documents
  ADD COLUMN notes text;
