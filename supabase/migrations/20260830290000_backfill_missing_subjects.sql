-- Found while verifying homework module Phase 11: getTeacherContext()
-- (shared/utils/teacherContext.ts) drops a teaching assignment whose
-- timetable_periods.subject_name has no case-insensitive match in the
-- subjects table — dropping sectionIds for that teacher, which silently
-- broke studentInfoById (blank names on the needs-attention panel),
-- almost certainly classes_performance and the exam-score-drop check too
-- (same ctx.sectionIds), and Phase 10's chapter-linked homework Subject
-- dropdown pre-fill. Root cause was never in the matching code — 13
-- distinct senior-secondary subject names used across 319 real
-- timetable_periods rows for Delhi Public School Lucknow (Mathematics,
-- Physics, Chemistry, Biology, Computer Science, Accountancy, Business
-- Studies, Economics, History, Geography, Political Science, Social
-- Science, Physical Education) were never registered in subjects at all —
-- only junior/middle-school names (Maths, Science, SST, ...) were.
--
-- Dynamic, not a hardcoded list: backfills whatever's actually missing for
-- any school, matching the exact simple shape every existing subjects row
-- already uses (school-wide, class_id null, subject_type 'core',
-- is_elective false) — same convention as Maths/Science/SST. Idempotent —
-- safe to re-run, a second pass finds nothing missing.

INSERT INTO public.subjects (school_id, name, is_elective, subject_type)
SELECT DISTINCT tp.school_id, tp.subject_name, false, 'core'
FROM public.timetable_periods tp
WHERE tp.is_break = false
  AND NOT EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.school_id = tp.school_id AND lower(s.name) = lower(tp.subject_name)
  );

-- Closes the other half of the same gap: subject_id has existed on
-- timetable_periods all along but was never populated for these rows
-- (confirmed: 0 of the 319 affected rows had it set) — only the free-text
-- subject_name was ever written. Wiring it up now means any code that
-- keys off subject_id directly (rather than re-deriving it via
-- name-matching, the fragile part of this whole bug) starts working too.
UPDATE public.timetable_periods tp
SET subject_id = s.id
FROM public.subjects s
WHERE tp.subject_id IS NULL
  AND s.school_id = tp.school_id
  AND lower(s.name) = lower(tp.subject_name);
