-- Removing a school, as one supported operation.
--
-- Deleting a school is a cascade across ~40 tables and, for a seeded demo,
-- roughly a hundred thousand rows: 1,880 students, 85k attendance records,
-- 10k ledger entries, a full year of invoices. Issued from the client that
-- is a single statement, and it dies on the API's statement timeout every
-- time — leaving the ledger already cleared and the school still standing,
-- which is the worst of both outcomes.
--
-- Three obstacles, all handled here so no caller has to know about them:
--
--   1. Four tables reference schools with ON DELETE NO ACTION
--      (audit_logs, daily_progress_notes, homework, syllabus_chapters) and
--      block the delete outright.
--   2. fee_ledger_entries is append-only and refuses DELETE even through a
--      cascade. fee_ledger_force_delete (20260827000000) is the sanctioned
--      way past that, and is reused rather than reimplemented.
--   3. The whole thing needs longer than the API's statement timeout.
--
-- SECURITY DEFINER and granted only to service_role, for the same reason
-- fee_ledger_force_delete is: this erases a school's entire history, and
-- an anon or authenticated caller must not be able to do it by guessing a
-- uuid. The seed and the test runners authenticate as service_role.

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
BEGIN
    IF p_school_id IS NULL THEN
        RAISE EXCEPTION 'school_force_delete requires a school_id — refusing to delete every school';
    END IF;

    SELECT name INTO v_name FROM public.schools WHERE id = p_school_id;
    IF v_name IS NULL THEN
        RETURN jsonb_build_object('deleted', false, 'reason', 'no such school');
    END IF;

    -- A hundred thousand cascading deletes will not finish inside the
    -- API's default budget, and a half-finished teardown is worse than
    -- none. LOCAL, so it reverts with the transaction.
    SET LOCAL statement_timeout = 0;

    SELECT count(*) INTO v_students FROM public.students WHERE school_id = p_school_id;
    SELECT count(*) INTO v_users FROM public.users WHERE school_id = p_school_id;

    -- 1. The four that would block the cascade.
    DELETE FROM public.audit_logs            WHERE school_id = p_school_id;
    DELETE FROM public.daily_progress_notes  WHERE school_id = p_school_id;
    DELETE FROM public.homework              WHERE school_id = p_school_id;
    DELETE FROM public.syllabus_chapters     WHERE school_id = p_school_id;

    -- 2. The append-only ledger, through its own sanctioned door.
    v_ledger := public.fee_ledger_force_delete(p_school_id);

    -- 3. Everything else goes with the school.
    DELETE FROM public.schools WHERE id = p_school_id;

    RETURN jsonb_build_object(
        'deleted', true,
        'school', v_name,
        'ledger_entries', v_ledger,
        'students', v_students,
        'users', v_users
    );
END;
$$;

REVOKE ALL ON FUNCTION public.school_force_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_force_delete(uuid) TO service_role;
