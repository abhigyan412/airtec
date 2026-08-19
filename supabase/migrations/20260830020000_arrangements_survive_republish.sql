-- ═══════════════════════════════════════════════════════════════
-- Cover assignments must survive the timetable being republished
-- ═══════════════════════════════════════════════════════════════
--
-- arrangements.timetable_period_id was ON DELETE CASCADE, and all three
-- of the functions that put a timetable live (replace_periods, publish,
-- rollback) work by deleting every row for the affected sections and
-- reinserting them with fresh ids. So publishing a timetable at eleven
-- in the morning silently deleted every substitute assignment for that
-- day: teachers who had accepted cover no longer had it, the arrangement
-- queue came back empty, classes stood unstaffed, and nobody was told
-- anything. Observed in production — a rollback to the imported
-- timetable erased same-day cover for three confirmed absences.
--
-- The cascade was never needed. An arrangement already stores the class,
-- section, day, period number, start and end time and subject name on
-- its own row; the period link is a convenience, not the record. So the
-- link is allowed to go null, and is re-established afterwards by
-- matching the section, weekday and period number, which is what
-- actually identifies a slot.

ALTER TABLE public.arrangements
  DROP CONSTRAINT IF EXISTS arrangements_timetable_period_id_fkey;

ALTER TABLE public.arrangements
  ADD CONSTRAINT arrangements_timetable_period_id_fkey
  FOREIGN KEY (timetable_period_id)
  REFERENCES public.timetable_periods(id) ON DELETE SET NULL;

-- ── re-link ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.timetable_relink_arrangements(
    p_school_id uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_linked integer;
BEGIN
    -- Only today and later. A detached arrangement from last week is
    -- history and re-pointing it at a period that has since been
    -- rewritten would be inventing a fact.
    WITH candidate AS (
        SELECT a.id AS arrangement_id, tp.id AS period_id,
               ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY tp.id) AS pick
          FROM public.arrangements a
          JOIN public.timetable_periods tp
            ON tp.school_id       = a.school_id
           AND tp.section_id      = a.section_id
           AND tp.day_of_week     = a.day_of_week
           AND tp.period_number   = a.period_number
           AND tp.is_break        = false
         WHERE a.school_id           = p_school_id
           AND a.timetable_period_id IS NULL
           AND a.status             <> 'cancelled'
           AND a.arrangement_date   >= CURRENT_DATE
           -- Never produce a second live arrangement against one period
           -- on one date; that is what the partial unique index forbids.
           AND NOT EXISTS (
               SELECT 1 FROM public.arrangements other
                WHERE other.timetable_period_id = tp.id
                  AND other.arrangement_date    = a.arrangement_date
                  AND other.status             <> 'cancelled'
           )
    )
    UPDATE public.arrangements a
       SET timetable_period_id = c.period_id
      FROM candidate c
     WHERE a.id = c.arrangement_id
       AND c.pick = 1;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    RETURN v_linked;
END;
$$;

COMMENT ON FUNCTION public.timetable_relink_arrangements(uuid) IS
  'Re-points same-day-and-later cover assignments at the current timetable rows after a republish, matching on section + weekday + period number.';

-- ── the three functions that replace periods now re-link afterwards ──
-- Reproduced from 20260829020000 with a single added PERFORM each, so
-- the whole definition stays readable in one place rather than being
-- assembled from a diff.

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

    PERFORM public.timetable_relink_arrangements(p_school_id);

    RETURN v_inserted;
END;
$$;

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

    PERFORM public.timetable_relink_arrangements(v_school_id);

    RETURN v_inserted;
END;
$$;

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

    PERFORM public.timetable_relink_arrangements(v_school_id);

    RETURN v_restored;
END;
$$;
