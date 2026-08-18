-- Removing a school, by draining rather than by enumeration.
--
-- Two earlier attempts tried to name the obstacles. Both were wrong within
-- one run, because the obstacles are transitive:
--
--   v1 hardcoded the four tables that block a delete of `schools`. It hit
--      workflow_approvals, which blocks the delete of `users` instead.
--   v2 asked the catalogue for every NO ACTION foreign key pointing at
--      schools or users. It hit issued_certificates, which does not point
--      at either — it points at certificate_templates, which v2 had just
--      emptied.
--
-- Chasing that chain by hand is a losing game, and it breaks again every
-- time somebody adds a table. What is actually true of this schema is
-- simpler: it is multi-tenant by `school_id`, and almost every table
-- carries that column. So rather than work out the correct order, clear
-- every school-scoped table repeatedly and let the order sort itself out —
-- a table whose dependents are still populated raises a foreign key
-- violation, is skipped, and is retried on the next pass once they are
-- gone.
--
-- Each pass strictly reduces the number of remaining tables or the loop
-- stops, so it terminates. In practice a school clears in three or four.
--
-- SECURITY DEFINER, service_role only: this erases a school's entire
-- history and an anon caller must not be able to do it by guessing a uuid.

CREATE OR REPLACE FUNCTION public.school_force_delete(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_name      text;
    v_ledger    integer := 0;
    v_students  integer := 0;
    v_users     integer := 0;
    v_passes    integer := 0;
    v_cleared   jsonb   := '{}'::jsonb;
    v_pending   text[];
    v_next      text[];
    v_progress  boolean;
    tbl         text;
    removed     integer;
BEGIN
    IF p_school_id IS NULL THEN
        RAISE EXCEPTION 'school_force_delete requires a school_id — refusing to delete every school';
    END IF;

    SELECT name INTO v_name FROM public.schools WHERE id = p_school_id;
    IF v_name IS NULL THEN
        RETURN jsonb_build_object('deleted', false, 'reason', 'no such school');
    END IF;

    -- ~100k deletes will not finish inside the API's budget, and a
    -- half-finished teardown is worse than none. LOCAL, so it reverts with
    -- the transaction.
    SET LOCAL statement_timeout = 0;

    SELECT count(*) INTO v_students FROM public.students WHERE school_id = p_school_id;
    SELECT count(*) INTO v_users    FROM public.users    WHERE school_id = p_school_id;

    -- The append-only ledger refuses DELETE even through a cascade;
    -- fee_ledger_force_delete (20260827000000) is the sanctioned way past
    -- it and has to run before anything tries to remove its rows.
    v_ledger := public.fee_ledger_force_delete(p_school_id);

    -- Every school-scoped table except the two anchors, which go last.
    SELECT array_agg(c.relname::text ORDER BY c.relname)
      INTO v_pending
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'school_id' AND a.attnum > 0
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('schools', 'users');

    WHILE array_length(v_pending, 1) > 0 AND v_passes < 20 LOOP
        v_passes  := v_passes + 1;
        v_progress := false;
        v_next     := ARRAY[]::text[];

        FOREACH tbl IN ARRAY v_pending LOOP
            BEGIN
                EXECUTE format('DELETE FROM public.%I WHERE school_id = $1', tbl) USING p_school_id;
                GET DIAGNOSTICS removed = ROW_COUNT;
                v_progress := true;
                IF removed > 0 THEN
                    v_cleared := v_cleared || jsonb_build_object(tbl, removed);
                END IF;
            EXCEPTION WHEN foreign_key_violation THEN
                -- Something downstream still points here. Try again once
                -- this pass has cleared whatever it was.
                v_next := v_next || tbl;
            END;
        END LOOP;

        EXIT WHEN NOT v_progress;   -- nothing moved; retrying cannot help
        v_pending := v_next;
    END LOOP;

    IF array_length(v_pending, 1) > 0 THEN
        RAISE EXCEPTION 'could not clear % after % passes: %',
            v_name, v_passes, array_to_string(v_pending, ', ');
    END IF;

    DELETE FROM public.users   WHERE school_id = p_school_id;
    DELETE FROM public.schools WHERE id = p_school_id;

    RETURN jsonb_build_object(
        'deleted', true,
        'school', v_name,
        'passes', v_passes,
        'ledger_entries', v_ledger,
        'students', v_students,
        'users', v_users,
        'cleared', v_cleared
    );
END;
$$;

REVOKE ALL ON FUNCTION public.school_force_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_force_delete(uuid) TO service_role;
