-- Phase 6a of plan.md: entrance mode per class. A new small table rather
-- than a column on admission_slots (a slot_type CHECK enum with no
-- free-form field to extend) or on admission_seat_ledger (semantically a
-- stretch — that table is capacity/reservation state, not assessment
-- config) — matches the precedent already set by
-- admission_document_requirements getting its own table for the same
-- "distinct per-class concern" reason in Phase 5. Named generically
-- (admission_class_settings, not admission_entrance_mode) so future
-- per-class admission settings (e.g. "is an entrance test required at
-- all") have a home to extend rather than triggering a fourth new table.
CREATE TABLE public.admission_class_settings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    entrance_mode text NOT NULL DEFAULT 'interview',
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (school_id, class_id),
    CONSTRAINT admission_class_settings_entrance_mode_check
      CHECK ((entrance_mode = ANY (ARRAY['interview'::text, 'written_mcq'::text, 'written_subjective'::text, 'observation'::text])))
);
CREATE TRIGGER trg_admission_class_settings_updated BEFORE UPDATE ON public.admission_class_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
ALTER TABLE public.admission_class_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON public.admission_class_settings
  USING ((school_id = ( SELECT users.school_id FROM public.users WHERE (users.id = auth.uid()))));
