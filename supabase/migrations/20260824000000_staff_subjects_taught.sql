-- A teacher's subjects have never been a real, settable fact anywhere in
-- this schema — every "what does this teacher teach" answer (substitute
-- matching, free-faculty's per-day summary) has always been re-derived
-- from whatever periods happen to be scheduled to them, which drifts
-- depending on which slice of the timetable is being looked at and can't
-- be set ahead of a teacher ever being scheduled at all. This adds a
-- real, admin-settable list on the staff profile that /timetable/substitutes
-- now prefers over the derived-from-periods fallback.
ALTER TABLE public.staff_profiles
  ADD COLUMN subjects text[] NOT NULL DEFAULT '{}'::text[];
