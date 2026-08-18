-- The list of tables a school owns, so a client can drain them one
-- statement at a time.
--
-- school_force_delete (20260829050000) does the whole teardown correctly,
-- but it does it in a single transaction — and a single transaction is
-- exactly what the API will not give us for ~100k rows. `SET LOCAL
-- statement_timeout = 0` inside the function does nothing about the
-- gateway cancelling the request wrapped around it, so the function only
-- works over a direct psql connection.
--
-- Rather than make every caller keep a psql connection to hand, this
-- exposes the one thing a client cannot work out for itself: which tables
-- are school-scoped. PostgREST does not expose information_schema, and a
-- hardcoded list in application code is wrong the day somebody adds a
-- table. With the list, the seed can issue one DELETE per table per pass
-- — each its own request, none of them near the timeout — and retry on
-- foreign key violations until the order sorts itself out, which is the
-- same drain the function does internally.
--
-- Read-only and harmless, so unlike the delete functions it is safe for
-- any authenticated caller.

CREATE OR REPLACE FUNCTION public.school_scoped_tables()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), '{}')
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'school_id' AND a.attnum > 0
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('schools', 'users');
$$;

GRANT EXECUTE ON FUNCTION public.school_scoped_tables() TO authenticated, service_role;
