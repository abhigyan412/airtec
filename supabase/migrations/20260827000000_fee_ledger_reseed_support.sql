-- One sanctioned way to delete ledger rows, instead of three ad-hoc ones.
--
-- fee_ledger_append_only (20260824030000) refuses UPDATE and DELETE on
-- fee_ledger_entries, and it should: a journal you can rewrite is not a
-- journal, and corrections belong as reversing entries. That is the right rule
-- for the application.
--
-- It is the wrong rule for tearing a dataset down, and three separate things
-- have now hit it, each for the same reason — a cascading delete still fires
-- row-level triggers, so anything that removes a school is refused:
--
--   * every integration suite's afterAll, which deletes its fixture school;
--   * removing a school outright;
--   * `npm run seed:fees`, whose whole job is to clear a school's fee data and
--     rebuild it, and which has been unable to run at all against a database
--     that already has postings.
--
-- Rather than let each of those disable the trigger for itself — three places
-- that can erase financial history, each needing its own review — the ability
-- lives here, once. The trigger stays absolute for every other caller.
--
-- Scoped to one school per call, SECURITY DEFINER because disabling a trigger
-- requires owning the table, and executable only by service_role: the seed and
-- test runners authenticate as that. An anon or authenticated caller must not
-- be able to erase a school's books by guessing a uuid.

CREATE OR REPLACE FUNCTION public.fee_ledger_force_delete(p_school_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    removed integer;
BEGIN
    IF p_school_id IS NULL THEN
        RAISE EXCEPTION 'fee_ledger_force_delete requires a school_id — refusing to clear every school''s ledger';
    END IF;

    SELECT count(*) INTO removed
      FROM public.fee_ledger_entries WHERE school_id = p_school_id;
    IF removed = 0 THEN
        RETURN 0;
    END IF;

    ALTER TABLE public.fee_ledger_entries DISABLE TRIGGER fee_ledger_append_only;

    BEGIN
        DELETE FROM public.fee_ledger_entries WHERE school_id = p_school_id;
    EXCEPTION WHEN OTHERS THEN
        -- The ledger is never left unguarded, even on an unexpected failure.
        ALTER TABLE public.fee_ledger_entries ENABLE TRIGGER fee_ledger_append_only;
        RAISE;
    END;

    ALTER TABLE public.fee_ledger_entries ENABLE TRIGGER fee_ledger_append_only;
    RETURN removed;
END;
$$;

COMMENT ON FUNCTION public.fee_ledger_force_delete IS
    'Deletes one school''s ledger entries, briefly lifting the append-only trigger. Teardown and reseed only; service_role. Corrections in the application are still reversing entries.';

REVOKE ALL ON FUNCTION public.fee_ledger_force_delete(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fee_ledger_force_delete(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fee_ledger_force_delete(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fee_ledger_force_delete(uuid) TO service_role;

-- purge_vitest_schools (20260826000000) did its own trigger juggling. It now
-- defers to the function above, so there is exactly one definition of how the
-- ledger may be cleared and one place to audit if that ever needs revisiting.
CREATE OR REPLACE FUNCTION public.purge_vitest_schools()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    doomed uuid;
    purged integer := 0;
BEGIN
    FOR doomed IN SELECT id FROM public.schools WHERE name LIKE '\_\_vitest\_%' LOOP
        PERFORM public.fee_ledger_force_delete(doomed);
        DELETE FROM public.schools WHERE id = doomed;
        purged := purged + 1;
    END LOOP;
    RETURN purged;
END;
$$;

COMMENT ON FUNCTION public.purge_vitest_schools IS
    'Deletes schools named __vitest_%, clearing their ledger via fee_ledger_force_delete first. Test teardown only; service_role.';

REVOKE ALL ON FUNCTION public.purge_vitest_schools() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_vitest_schools() FROM anon;
REVOKE ALL ON FUNCTION public.purge_vitest_schools() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_vitest_schools() TO service_role;
