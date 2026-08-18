-- ═══════════════════════════════════════════════════════════════
-- Timetable — the two operations that must not half-happen
-- ═══════════════════════════════════════════════════════════════
--
-- The Supabase JS client speaks PostgREST, which has no transactions:
-- every .insert()/.delete() is its own statement and its own commit. For
-- almost everything in this module that is fine — creating a subject
-- twice is untidy, not dangerous, and a re-run fixes it.
--
-- Two operations are not like that. Both replace a school's live
-- timetable, and both start by deleting it. A failure between the delete
-- and the insert leaves the school with no timetable at all, at 7am, on
-- the morning they were relying on it. So both are single function calls
-- — one statement from PostgREST's point of view, therefore one
-- transaction, therefore all-or-nothing.
--
-- Same reasoning as fee_collect_payment (20260824010000).

-- ═══════════════════════════════════════════════════════════════
-- 1. Replace the live grid for a set of sections
-- ═══════════════════════════════════════════════════════════════
-- Used by the spreadsheet importer. p_rows is an array of objects
-- matching timetable_periods' columns.

CREATE OR REPLACE FUNCTION public.timetable_replace_periods(
    p_school_id  uuid,
    p_section_ids uuid[],
    p_rows       jsonb,
    p_version_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_inserted integer;
BEGIN
    IF p_school_id IS NULL THEN
        RAISE EXCEPTION 'school_id is required';
    END IF;

    -- Scoped to the sections being replaced, never the whole school: a
    -- school may be importing one wing while the rest of the week stands.
    DELETE FROM public.timetable_periods
     WHERE school_id = p_school_id
       AND section_id = ANY (p_section_ids);

    INSERT INTO public.timetable_periods (
        school_id, class_id, section_id, academic_year_id,
        day_of_week, period_number, start_time, end_time,
        subject_id, subject_name, teacher_id, room_id,
        is_break, is_locked, is_double_part, version_id
    )
    SELECT
        p_school_id,
        (r->>'class_id')::uuid,
        (r->>'section_id')::uuid,
        NULLIF(r->>'academic_year_id', '')::uuid,
        (r->>'day_of_week')::int,
        (r->>'period_number')::int,
        (r->>'start_time')::time,
        (r->>'end_time')::time,
        NULLIF(r->>'subject_id', '')::uuid,
        r->>'subject_name',
        NULLIF(r->>'teacher_id', '')::uuid,
        NULLIF(r->>'room_id', '')::uuid,
        COALESCE((r->>'is_break')::boolean, false),
        COALESCE((r->>'is_locked')::boolean, false),
        COALESCE((r->>'is_double_part')::boolean, false),
        p_version_id
    FROM jsonb_array_elements(p_rows) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Publish a draft over the live timetable
-- ═══════════════════════════════════════════════════════════════
-- Snapshots what it replaced onto the outgoing version first, so a bad
-- publish is one call to undo rather than a database restore. A school
-- that has just lost its working timetable to a bad generation will not
-- wait for a support ticket.

CREATE OR REPLACE FUNCTION public.timetable_publish_draft(
    p_version_id uuid,
    p_actor      uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_school_id  uuid;
    v_status     text;
    v_sections   uuid[];
    v_snapshot   jsonb;
    v_inserted   integer;
BEGIN
    SELECT school_id, status INTO v_school_id, v_status
      FROM public.timetable_versions WHERE id = p_version_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'timetable version % not found', p_version_id;
    END IF;
    IF v_status <> 'draft' THEN
        RAISE EXCEPTION 'timetable version % is %, only a draft can be published', p_version_id, v_status;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT section_id), '{}')
      INTO v_sections
      FROM public.timetable_draft_periods
     WHERE version_id = p_version_id AND section_id IS NOT NULL;

    IF array_length(v_sections, 1) IS NULL THEN
        RAISE EXCEPTION 'timetable version % has no rows to publish', p_version_id;
    END IF;

    -- Keep the rows about to be destroyed.
    SELECT COALESCE(jsonb_agg(to_jsonb(tp) - 'id'), '[]'::jsonb)
      INTO v_snapshot
      FROM public.timetable_periods tp
     WHERE tp.school_id = v_school_id
       AND tp.section_id = ANY (v_sections);

    DELETE FROM public.timetable_periods
     WHERE school_id = v_school_id
       AND section_id = ANY (v_sections);

    INSERT INTO public.timetable_periods (
        school_id, class_id, section_id, day_of_week, period_number,
        start_time, end_time, subject_id, subject_name, teacher_id,
        room_id, is_break, is_locked, is_double_part, version_id
    )
    SELECT school_id, class_id, section_id, day_of_week, period_number,
           start_time, end_time, subject_id, subject_name, teacher_id,
           room_id, is_break, is_locked, is_double_part, version_id
      FROM public.timetable_draft_periods
     WHERE version_id = p_version_id;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Whatever was active for these sections is now history.
    UPDATE public.timetable_versions
       SET status = 'archived'
     WHERE school_id = v_school_id
       AND status = 'active'
       AND id <> p_version_id;

    UPDATE public.timetable_versions
       SET status = 'active',
           published_by = p_actor,
           published_at = now(),
           replaced_snapshot = v_snapshot
     WHERE id = p_version_id;

    DELETE FROM public.timetable_draft_periods WHERE version_id = p_version_id;

    RETURN v_inserted;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Roll a publish back
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.timetable_rollback_version(
    p_version_id uuid,
    p_actor      uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_school_id uuid;
    v_snapshot  jsonb;
    v_sections  uuid[];
    v_restored  integer;
BEGIN
    SELECT school_id, replaced_snapshot INTO v_school_id, v_snapshot
      FROM public.timetable_versions WHERE id = p_version_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'timetable version % not found', p_version_id;
    END IF;
    IF v_snapshot IS NULL OR jsonb_array_length(v_snapshot) = 0 THEN
        RAISE EXCEPTION 'timetable version % has nothing to roll back to', p_version_id;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT (r->>'section_id')::uuid), '{}')
      INTO v_sections
      FROM jsonb_array_elements(v_snapshot) AS r
     WHERE r->>'section_id' IS NOT NULL;

    DELETE FROM public.timetable_periods
     WHERE school_id = v_school_id
       AND section_id = ANY (v_sections);

    INSERT INTO public.timetable_periods (
        school_id, class_id, section_id, academic_year_id, day_of_week,
        period_number, start_time, end_time, subject_id, subject_name,
        teacher_id, room_id, is_break, is_locked, is_double_part, version_id
    )
    SELECT v_school_id,
           (r->>'class_id')::uuid,
           NULLIF(r->>'section_id', '')::uuid,
           NULLIF(r->>'academic_year_id', '')::uuid,
           (r->>'day_of_week')::int,
           (r->>'period_number')::int,
           (r->>'start_time')::time,
           (r->>'end_time')::time,
           NULLIF(r->>'subject_id', '')::uuid,
           r->>'subject_name',
           NULLIF(r->>'teacher_id', '')::uuid,
           NULLIF(r->>'room_id', '')::uuid,
           COALESCE((r->>'is_break')::boolean, false),
           COALESCE((r->>'is_locked')::boolean, false),
           COALESCE((r->>'is_double_part')::boolean, false),
           NULLIF(r->>'version_id', '')::uuid
      FROM jsonb_array_elements(v_snapshot) AS r;

    GET DIAGNOSTICS v_restored = ROW_COUNT;

    UPDATE public.timetable_versions
       SET status = 'archived', notes = COALESCE(notes || ' | ', '') || 'rolled back'
     WHERE id = p_version_id;

    INSERT INTO public.timetable_audit_log (school_id, actor_id, action, entity_type, entity_id, detail)
    VALUES (v_school_id, p_actor, 'rollback', 'timetable_version', p_version_id,
            jsonb_build_object('restored_rows', v_restored));

    RETURN v_restored;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4. Materialize the arrangement queue for an absence
-- ═══════════════════════════════════════════════════════════════
-- One statement so a half-materialized absence can't exist: the
-- alternative is a morning where three of a teacher's five periods show
-- up in the queue and nobody notices the other two until the bell.

CREATE OR REPLACE FUNCTION public.timetable_materialize_arrangements(
    p_absence_id uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_school_id  uuid;
    v_teacher_id uuid;
    v_date       date;
    v_scope      text;
    v_periods    integer[];
    v_from       integer;
    v_dow        integer;
    v_created    integer;
BEGIN
    SELECT school_id, teacher_id, absence_date, scope, periods, from_period
      INTO v_school_id, v_teacher_id, v_date, v_scope, v_periods, v_from
      FROM public.teacher_absences
     WHERE id = p_absence_id AND status <> 'cancelled';

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'absence % not found or cancelled', p_absence_id;
    END IF;

    -- Postgres: Sunday = 0. This schema: Monday = 1 .. Saturday = 6.
    v_dow := EXTRACT(ISODOW FROM v_date)::int;
    IF v_dow > 6 THEN
        RETURN 0;  -- Sunday is not a school day here.
    END IF;

    INSERT INTO public.arrangements (
        school_id, arrangement_date, absence_id, timetable_period_id,
        day_of_week, period_number, start_time, end_time,
        class_id, section_id, subject_id, subject_name,
        absent_teacher_id, status
    )
    SELECT
        v_school_id, v_date, p_absence_id, tp.id,
        tp.day_of_week, tp.period_number, tp.start_time, tp.end_time,
        tp.class_id, tp.section_id, tp.subject_id, tp.subject_name,
        v_teacher_id, 'unassigned'
      FROM public.timetable_periods tp
     WHERE tp.school_id = v_school_id
       AND tp.teacher_id = v_teacher_id
       AND tp.day_of_week = v_dow
       AND NOT tp.is_break
       AND CASE v_scope
             WHEN 'full_day'     THEN true
             WHEN 'periods'      THEN tp.period_number = ANY (v_periods)
             WHEN 'early_leave'  THEN tp.period_number >= v_from
             WHEN 'late_arrival' THEN tp.period_number < v_from
             -- Half-days split on the school's own break rather than on
             -- a hardcoded clock time: the break is where the school
             -- itself divides the day, and start times vary by season.
             WHEN 'first_half'   THEN tp.start_time < COALESCE(
                 (SELECT MIN(psd.start_time) FROM public.period_slot_defs psd
                   WHERE psd.school_id = v_school_id AND psd.kind IN ('break','lunch')),
                 '12:00'::time)
             WHEN 'second_half'  THEN tp.start_time >= COALESCE(
                 (SELECT MIN(psd.start_time) FROM public.period_slot_defs psd
                   WHERE psd.school_id = v_school_id AND psd.kind IN ('break','lunch')),
                 '12:00'::time)
             ELSE true
           END
    -- Re-running for the same absence must not duplicate the queue.
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;
    RETURN v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.timetable_replace_periods(uuid, uuid[], jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.timetable_publish_draft(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.timetable_rollback_version(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.timetable_materialize_arrangements(uuid) TO authenticated, service_role;
