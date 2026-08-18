-- Removing a school, without a hand-maintained list of obstacles.
--
-- The first version (20260829030000) hardcoded the four tables that
-- reference schools with ON DELETE NO ACTION. That was already the wrong
-- shape and it failed on the first real run: deleting a school cascades
-- into `users`, and `users` is itself referenced by 109 foreign keys —
-- workflow_approvals.approved_by among them — several of which are also
-- NO ACTION and block the delete one at a time, in whatever order
-- Postgres happens to check them.
--
-- Enumerating those by hand means the list is wrong again the next time
-- anyone adds a table. So this asks the catalogue instead: find every
-- foreign key pointing at schools or users that would refuse a delete,
-- and clear those rows first. A new table with a NO ACTION reference is
-- handled the day it is created, without anyone remembering to come here.
--
-- Still SECURITY DEFINER, still service_role only: this erases a school's
-- entire history and an anon caller must not be able to do it by guessing
-- a uuid.

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
    v_cleared   jsonb   := '[]'::jsonb;
    r           record;
    removed     integer;
BEGIN
    IF p_school_id IS NULL THEN
        RAISE EXCEPTION 'school_force_delete requires a school_id — refusing to delete every school';
    END IF;

    SELECT name INTO v_name FROM public.schools WHERE id = p_school_id;
    IF v_name IS NULL THEN
        RETURN jsonb_build_object('deleted', false, 'reason', 'no such school');
    END IF;

    -- ~100k cascading deletes will not finish inside the API's budget, and
    -- a half-finished teardown is worse than none. LOCAL, so it reverts
    -- with the transaction.
    SET LOCAL statement_timeout = 0;

    SELECT count(*) INTO v_students FROM public.students WHERE school_id = p_school_id;
    SELECT count(*) INTO v_users    FROM public.users    WHERE school_id = p_school_id;

    -- The append-only ledger first: it refuses DELETE even through a
    -- cascade, and fee_ledger_force_delete (20260827000000) is the one
    -- sanctioned way past that.
    v_ledger := public.fee_ledger_force_delete(p_school_id);

    -- Every single-column foreign key that points at schools or users and
    -- would block a delete. Ordered so that user-referencing tables go
    -- first — clearing those is what lets the users rows cascade away.
    FOR r IN
        SELECT c.conrelid::regclass::text AS tbl,
               a.attname                  AS col,
               c.confrelid::regclass::text AS target
          FROM pg_constraint c
          JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.contype = 'f'
           AND c.confdeltype IN ('a', 'r')            -- NO ACTION / RESTRICT
           AND array_length(c.conkey, 1) = 1          -- single-column only
           AND c.confrelid IN ('public.users'::regclass, 'public.schools'::regclass)
         ORDER BY CASE WHEN c.confrelid = 'public.users'::regclass THEN 0 ELSE 1 END
    LOOP
        IF r.target = 'users' THEN
            EXECUTE format(
                'DELETE FROM %s WHERE %I IN (SELECT id FROM public.users WHERE school_id = $1)',
                r.tbl, r.col) USING p_school_id;
        ELSE
            EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING p_school_id;
        END IF;

        GET DIAGNOSTICS removed = ROW_COUNT;
        IF removed > 0 THEN
            v_cleared := v_cleared || jsonb_build_object('table', r.tbl, 'rows', removed);
        END IF;
    END LOOP;

    DELETE FROM public.schools WHERE id = p_school_id;

    RETURN jsonb_build_object(
        'deleted', true,
        'school', v_name,
        'ledger_entries', v_ledger,
        'students', v_students,
        'users', v_users,
        'cleared', v_cleared
    );
END;
$$;

REVOKE ALL ON FUNCTION public.school_force_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_force_delete(uuid) TO service_role;
