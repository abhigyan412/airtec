-- Test-fixture teardown, and why it needs help from the database.
--
-- The integration tests run against this project on purpose (see
-- feeMoneyPaths.test.ts for the reasoning) and each builds a disposable school
-- named __vitest_<suite>_<timestamp>. Every one of those suites already deletes
-- its school in afterAll, and every one of those deletes has been failing
-- silently since the ledger became append-only:
--
--   DELETE FROM schools -> ON DELETE CASCADE -> DELETE FROM fee_ledger_entries
--                       -> fee_ledger_append_only RAISEs
--
-- A cascading delete still fires row-level triggers, so the whole statement is
-- refused. supabase-js returns that as an error object rather than throwing, the
-- teardowns never checked it, and the schools accumulated — 21 of them, holding
-- 970 ledger rows, against 2 real schools.
--
-- The trigger is not the thing to relax. Immutability is worth more than tidy
-- fixtures, and a journal that makes an exception for one caller is not
-- immutable. So the exception lives here instead: one function, which can only
-- ever see rows whose school is named like a test fixture.
--
-- SECURITY DEFINER because disabling a trigger requires owning the table.
-- Execute is revoked from everyone except service_role, which is what the test
-- runner authenticates as — an anon caller must not be able to delete schools by
-- guessing a name.

CREATE OR REPLACE FUNCTION public.purge_vitest_schools()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    purged integer;
BEGIN
    -- Nothing to do, and nothing to unlock, if no fixture is left behind.
    SELECT count(*) INTO purged FROM public.schools WHERE name LIKE '\_\_vitest\_%';
    IF purged = 0 THEN
        RETURN 0;
    END IF;

    ALTER TABLE public.fee_ledger_entries DISABLE TRIGGER fee_ledger_append_only;

    BEGIN
        DELETE FROM public.schools WHERE name LIKE '\_\_vitest\_%';
    EXCEPTION WHEN OTHERS THEN
        -- Never leave the ledger unguarded, even on an unexpected failure.
        ALTER TABLE public.fee_ledger_entries ENABLE TRIGGER fee_ledger_append_only;
        RAISE;
    END;

    ALTER TABLE public.fee_ledger_entries ENABLE TRIGGER fee_ledger_append_only;
    RETURN purged;
END;
$$;

COMMENT ON FUNCTION public.purge_vitest_schools IS
    'Deletes schools named __vitest_%, briefly disabling the append-only ledger trigger so the cascade can complete. Test teardown only; service_role.';

REVOKE ALL ON FUNCTION public.purge_vitest_schools() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_vitest_schools() FROM anon;
REVOKE ALL ON FUNCTION public.purge_vitest_schools() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_vitest_schools() TO service_role;
