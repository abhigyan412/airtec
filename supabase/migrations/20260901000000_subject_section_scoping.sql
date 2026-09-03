-- 11th/12th "sections" are really academic streams (PCM/PCB/Commerce/
-- Humanities) with genuinely different subjects, but neither the master
-- subjects catalog nor exam_subjects/exam_template_subjects had any way to
-- say a subject belongs to just one stream — every class-scoped subject
-- applied to the whole class, mixing every stream's subjects together.
-- All three additions are nullable and purely additive: NULL keeps today's
-- exact "applies to the whole class" behavior, so classes 1-10 (which never
-- get a section picker) are completely unaffected.
alter table public.subjects
  add column section_id uuid references public.sections(id) on delete set null;
alter table public.exam_subjects
  add column section_id uuid references public.sections(id) on delete set null;
alter table public.exam_template_subjects
  add column section_id uuid references public.sections(id) on delete set null;
