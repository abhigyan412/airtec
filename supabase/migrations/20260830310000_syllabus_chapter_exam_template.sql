-- Syllabus Setup: a chapter can now be tagged to a recurring exam
-- template (Half Yearly, Annual, Unit Test 1/2/3/4, ...) from Examination
-- Settings, not only a real scheduled exam instance — templates exist
-- before actual dated exams are ever scheduled for the year, which is
-- exactly when initial syllabus setup happens. Tag-only: no due_date is
-- computed from it (templates carry no date), it just labels which term
-- a chapter is meant to be covered by, until (or unless) it's later
-- linked to a real scheduled exam via exam_id.
alter table public.syllabus_chapters
  add column exam_template_id uuid references public.exam_templates(id);
