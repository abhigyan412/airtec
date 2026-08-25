-- Phase 1 of plan.md: seat capacity becomes a stored, stateful ledger
-- (available/reserved/confirmed/frozen) instead of a live calculation
-- recomputed from sections/students/applications on every request.
--
-- Deliberately keyed on (school_id, class_id) only, NOT
-- (academic_year_id, class_id) as plan.md's phrasing suggested — verified
-- that sections/classes are not year-scoped anywhere in this schema today,
-- so introducing year-scoping to capacity would be a materially bigger
-- change than "evolve the existing calculation in place" implies. Revisit
-- if sections ever become year-scoped.
--
-- No campus column — verified no campus/multi-campus concept exists
-- anywhere in this codebase (see decisions.md, adopted 2026-08-20).
CREATE TABLE public.admission_seat_ledger (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    capacity integer NOT NULL DEFAULT 0,
    frozen integer NOT NULL DEFAULT 0,
    reserved integer NOT NULL DEFAULT 0,
    confirmed integer NOT NULL DEFAULT 0,
    updated_by uuid REFERENCES public.users(id),
    updated_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (school_id, class_id)
);
CREATE INDEX idx_admission_seat_ledger_school ON public.admission_seat_ledger USING btree (school_id);
CREATE TRIGGER trg_admission_seat_ledger_updated BEFORE UPDATE ON public.admission_seat_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
ALTER TABLE public.admission_seat_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON public.admission_seat_ledger
  USING ((school_id = ( SELECT users.school_id FROM public.users WHERE (users.id = auth.uid()))));

-- Backfill: seed a ledger row for every class, computing exactly what the
-- old getClassSeatAvailability() would have returned live, so switching
-- reads over to the ledger doesn't silently zero out existing schools'
-- real capacity/enrollment/in-flight-application state.
INSERT INTO public.admission_seat_ledger (school_id, class_id, capacity, confirmed, reserved, frozen)
SELECT
  c.school_id,
  c.id,
  COALESCE(cap.capacity, 0),
  COALESCE(enr.confirmed, 0),
  COALESCE(res.reserved, 0),
  0
FROM public.classes c
LEFT JOIN (
  SELECT class_id, SUM(COALESCE(max_strength, 0)) AS capacity
  FROM public.sections GROUP BY class_id
) cap ON cap.class_id = c.id
LEFT JOIN (
  SELECT class_id, COUNT(*) AS confirmed
  FROM public.students WHERE status = 'active' GROUP BY class_id
) enr ON enr.class_id = c.id
LEFT JOIN (
  SELECT applying_for_class_id AS class_id, COUNT(*) AS reserved
  FROM public.admission_applications
  WHERE status NOT IN ('admitted', 'rejected') AND applying_for_class_id IS NOT NULL
  GROUP BY applying_for_class_id
) res ON res.class_id = c.id
ON CONFLICT (school_id, class_id) DO NOTHING;
