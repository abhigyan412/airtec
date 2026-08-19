-- A teacher's subjects have never been a real, settable fact anywhere in
-- this schema — every "what does this teacher teach" answer (substitute
-- matching, free-faculty's per-day summary) has always been re-derived
-- from whatever periods happen to be scheduled to them, which drifts
-- depending on which slice of the timetable is being looked at and can't
-- be set ahead of a teacher ever being scheduled at all. This adds a
-- real, admin-settable list on the staff profile that /timetable/substitutes
-- now prefers over the derived-from-periods fallback.
-- Renumbered from 20260824000000, which it shared with
-- fee_production_hardening. Migration runners key on the version, not the
-- filename, so only one of the two was ever applied — and the loser was
-- this one. The column therefore did not exist in any database built by
-- the tooling, and GET /students/timetable/teachers returned a 500 on
-- every school: "column staff_profiles_1.subjects does not exist". The
-- visible symptom was the Teacher View dropdown being permanently empty.
--
-- IF NOT EXISTS because an environment that applied it by iterating files
-- rather than versions already has the column.
ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS subjects text[] NOT NULL DEFAULT '{}'::text[];
