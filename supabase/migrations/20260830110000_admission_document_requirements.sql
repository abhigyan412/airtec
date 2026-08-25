-- Phase 5 of plan.md: mandatory document checklist, keyed on (school, class)
-- rather than literally (board, class) as the draft phrased it — verified
-- a school has one affiliation_board (schools.affiliation_board) shared
-- across all its classes in this schema, so "per board" is redundant
-- within a single school's own checklist.
--
-- No row for a class = no checklist configured = never blocks (same
-- "absence is permissive" convention as admission_cycles and the seat
-- lock — a class nobody has configured shouldn't silently stop admitting).
CREATE TABLE public.admission_document_requirements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    document_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE (school_id, class_id, document_type)
);
CREATE INDEX idx_admission_document_requirements_class ON public.admission_document_requirements USING btree (school_id, class_id);
ALTER TABLE public.admission_document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON public.admission_document_requirements
  USING ((school_id = ( SELECT users.school_id FROM public.users WHERE (users.id = auth.uid()))));

-- Override trail — Principal-only, reason required, per decisions.md.
-- Plain columns, matching the established convention rather than a
-- separate audit table (same reasoning as Phase 3/7).
ALTER TABLE public.admission_applications
  ADD COLUMN document_gap_override_at timestamp with time zone,
  ADD COLUMN document_gap_override_by uuid REFERENCES public.users(id),
  ADD COLUMN document_gap_override_reason text;
