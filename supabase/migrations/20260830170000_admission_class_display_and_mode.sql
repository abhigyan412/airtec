-- Item 2 (user request): add "previous academic percentage" as an
-- entrance mode — some schools admit based on prior school performance
-- rather than a fresh test/interview. admission_inquiries already
-- captures previous_percentage at inquiry stage, so this mode has real
-- data to evaluate against once 6b-ii (or a simpler rule) reads it.
ALTER TABLE public.admission_class_settings
  DROP CONSTRAINT admission_class_settings_entrance_mode_check;
ALTER TABLE public.admission_class_settings
  ADD CONSTRAINT admission_class_settings_entrance_mode_check
  CHECK ((entrance_mode = ANY (ARRAY[
    'interview'::text, 'written_mcq'::text, 'written_subjective'::text,
    'observation'::text, 'previous_academic_percentage'::text
  ])));

-- Item 3 (user request): class numbering display style (numeric vs
-- Roman), school-wide, single source of truth. Lives on `schools`
-- alongside every other school-level setting in this codebase, even
-- though it's set from the Classes & Sections screen rather than an
-- admission one — that screen's backend routes already live in
-- admission/routes.ts (an existing convention, not something started
-- here), so the endpoint follows suit.
ALTER TABLE public.schools
  ADD COLUMN class_display_style text NOT NULL DEFAULT 'numeric'
  CONSTRAINT schools_class_display_style_check CHECK (class_display_style IN ('numeric', 'roman'));
