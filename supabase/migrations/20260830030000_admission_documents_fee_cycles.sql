-- application_documents: bring it in line with the student-documents /
-- staff-documents sibling tables so the same upload pattern applies
ALTER TABLE public.application_documents
  ADD COLUMN school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  ADD COLUMN mime_type text,
  ADD COLUMN file_size text,
  ADD COLUMN uploaded_by uuid REFERENCES public.users(id);

CREATE INDEX idx_application_documents_application_id
  ON public.application_documents USING btree (application_id);

-- admission_applications: audit trail for admission-internal fee collection
ALTER TABLE public.admission_applications
  ADD COLUMN fee_paid_at timestamp with time zone,
  ADD COLUMN fee_payment_method text,
  ADD COLUMN fee_payment_reference text,
  ADD COLUMN fee_collected_by uuid REFERENCES public.users(id);

-- admission_cycles: per-school, per-academic-year open/close window.
-- Absence of a row = always open (permissive default), matching the
-- NULL-means-all-enabled convention already used by schools.enabled_modules.
CREATE TABLE public.admission_cycles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id),
    opens_at timestamp with time zone,
    closes_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (school_id, academic_year_id)
);
CREATE INDEX idx_admission_cycles_school ON public.admission_cycles USING btree (school_id);
CREATE TRIGGER trg_admission_cycles_updated BEFORE UPDATE ON public.admission_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
ALTER TABLE public.admission_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON public.admission_cycles
  USING ((school_id = ( SELECT users.school_id FROM public.users WHERE (users.id = auth.uid()))));

-- storage bucket for admission document uploads, same pattern as staff-photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('admission-documents', 'admission-documents', true)
ON CONFLICT (id) DO NOTHING;
