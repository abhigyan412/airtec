-- The subjects table was created via the Supabase Table Editor UI, which
-- enables RLS by default with no policies attached. That blocked all writes
-- (including from the service-role key in some contexts) with "new row
-- violates row-level security policy for table \"subjects\"".
--
-- Every other table the app writes to has RLS disabled — authorization is
-- enforced at the Express layer (requireRole/requirePermissionV2), not via
-- Postgres RLS policies. Disable RLS here to match that convention.
ALTER TABLE public.subjects DISABLE ROW LEVEL SECURITY;
