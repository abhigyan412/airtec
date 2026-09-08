-- Recruitment QR/public-apply flow: a candidate's resume needs
-- somewhere to land, same base64 -> storage bucket -> getPublicUrl()
-- shape as every other document feature in this app (student_documents,
-- staff_documents, application_documents, transport documents).
insert into storage.buckets (id, name, public)
values ('recruitment-documents', 'recruitment-documents', true)
on conflict (id) do nothing;
