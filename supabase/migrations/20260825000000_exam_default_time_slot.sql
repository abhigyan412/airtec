-- An exam's subjects usually all run at the same time of day (e.g. every
-- Unit Test 1 paper is 9:00-11:00) — picking a default time slot once at
-- exam-creation time, rather than re-picking it on every single "Add
-- Subject" afterward, is the same "don't be repetitive" reasoning
-- exam_time_slots itself was built for. Still fully overridable per
-- subject; this is only ever a pre-fill.
ALTER TABLE public.exams
    ADD COLUMN default_time_slot_id uuid REFERENCES public.exam_time_slots(id) ON DELETE SET NULL;
