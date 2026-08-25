-- Bookable slots for admission — entrance tests and interviews now,
-- deliberately generic (slot_type) so campus-tour booking (Phase 3) reuses
-- the same entity instead of a second scheduling system.
CREATE TABLE public.admission_slots (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    slot_type text NOT NULL,
    academic_year_id uuid REFERENCES public.academic_years(id),
    class_id uuid REFERENCES public.classes(id),
    title text NOT NULL,
    location text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    capacity integer,
    assigned_staff_id uuid REFERENCES public.users(id),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admission_slots_slot_type_check
      CHECK ((slot_type = ANY (ARRAY['entrance_exam'::text, 'interview'::text, 'campus_tour'::text])))
);
CREATE INDEX idx_admission_slots_school ON public.admission_slots USING btree (school_id);
CREATE INDEX idx_admission_slots_starts_at ON public.admission_slots USING btree (starts_at);
CREATE TRIGGER trg_admission_slots_updated BEFORE UPDATE ON public.admission_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
ALTER TABLE public.admission_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON public.admission_slots
  USING ((school_id = ( SELECT users.school_id FROM public.users WHERE (users.id = auth.uid()))));

-- A booking always belongs to an inquiry and/or an application — entrance
-- tests typically happen at inquiry stage, but a slot can be booked
-- against either (or both, once an inquiry has converted).
CREATE TABLE public.admission_slot_bookings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL REFERENCES public.admission_slots(id) ON DELETE CASCADE,
    inquiry_id uuid REFERENCES public.admission_inquiries(id) ON DELETE CASCADE,
    application_id uuid REFERENCES public.admission_applications(id) ON DELETE CASCADE,
    status text DEFAULT 'booked'::text NOT NULL,
    result text,
    booked_at timestamp with time zone DEFAULT now(),
    booked_by uuid REFERENCES public.users(id),
    CONSTRAINT admission_slot_bookings_status_check
      CHECK ((status = ANY (ARRAY['booked'::text, 'attended'::text, 'no_show'::text, 'cancelled'::text]))),
    CONSTRAINT admission_slot_bookings_has_subject
      CHECK ((inquiry_id IS NOT NULL) OR (application_id IS NOT NULL))
);
CREATE INDEX idx_admission_slot_bookings_slot ON public.admission_slot_bookings USING btree (slot_id);
CREATE INDEX idx_admission_slot_bookings_inquiry ON public.admission_slot_bookings USING btree (inquiry_id);
CREATE INDEX idx_admission_slot_bookings_application ON public.admission_slot_bookings USING btree (application_id);
ALTER TABLE public.admission_slot_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON public.admission_slot_bookings
  USING ((school_id = ( SELECT users.school_id FROM public.users WHERE (users.id = auth.uid()))));
