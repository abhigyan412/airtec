-- ═══════════════════════════════════════════════════════════════
-- Don't queue cover for lessons that have already been taught
-- ═══════════════════════════════════════════════════════════════
--
-- Marking a teacher absent fans their day out into the cover queue.
-- Done at two in the afternoon, that queued every period they had that
-- day — including the five that finished hours ago. The manager was then
-- looking at "8 periods · 8 still uncovered" for a day that was nearly
-- over, with no way to tell which of them anybody could still do
-- anything about. Reported from the live school.
--
-- The cutoff is passed in rather than read from the database clock.
-- period start_time is local wall-clock ("08:20"), and the database runs
-- in UTC, so comparing against LOCALTIME here would be five and a half
-- hours out for this school and differently wrong for the next one. The
-- application already knows the school's current local time; it says so.
--
-- NULL means "no cutoff", which is the right default for a future date
-- and keeps every existing caller working unchanged.

CREATE OR REPLACE FUNCTION public.timetable_materialize_arrangements(
    p_absence_id uuid,
    p_not_before time DEFAULT NULL
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
       -- Already taught. Nobody can cover it now.
       AND (p_not_before IS NULL OR tp.start_time > p_not_before)
       AND CASE v_scope
             WHEN 'full_day'     THEN true
             WHEN 'periods'      THEN tp.period_number = ANY (v_periods)
             WHEN 'early_leave'  THEN tp.period_number >= v_from
             WHEN 'late_arrival' THEN tp.period_number < v_from
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

-- The one-argument version has to go. Adding a defaulted parameter with
-- CREATE OR REPLACE makes an OVERLOAD, not a replacement, and then a
-- single-argument call matches both and Postgres refuses it as
-- ambiguous. Dropped after the new one exists so there is no window
-- where neither is callable.
DROP FUNCTION IF EXISTS public.timetable_materialize_arrangements(uuid);

GRANT EXECUTE ON FUNCTION public.timetable_materialize_arrangements(uuid, time) TO authenticated, service_role;
