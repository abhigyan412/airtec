-- student_promotions had RLS enabled with zero policies — same class of
-- bug as subjects (20260722040000) and schools (20260723000000). It
-- silently swallowed every insert from the promote/transfer endpoint
-- (the insert's error was also never checked in application code, which
-- is fixed separately), so the audit trail for every class/section
-- transfer was lost while the actual student record change went through
-- fine. Disabling to match the rest of the schema's convention:
-- authorization enforced at the Express layer, not via Postgres RLS.
ALTER TABLE public.student_promotions DISABLE ROW LEVEL SECURITY;

-- Proactive sweep after finding the third instance of this bug: every
-- other public table with RLS enabled and zero policies attached, found
-- via
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
--   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname);
-- All were created via the Supabase Table Editor UI (which defaults RLS
-- on with no policies) rather than a migration, same as subjects/schools/
-- student_promotions above. None had visibly failed yet, but parents in
-- particular is actively written to during admission — this was a matter
-- of when, not if.
ALTER TABLE public.application_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_sources DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents DISABLE ROW LEVEL SECURITY;
