-- Chapters can now be scoped to a specific section (different sections of
-- the same class may run at different paces / have different due dates
-- set by management) — null section_id means "applies to every section
-- of the class", matching how homework.section_id and
-- timetable_periods.section_id already work.

ALTER TABLE public.syllabus_chapters
  ADD COLUMN section_id uuid REFERENCES public.sections(id);

CREATE INDEX syllabus_chapters_section_idx ON public.syllabus_chapters (section_id);
