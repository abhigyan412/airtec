-- Chapter due dates should track the school's actual exam calendar
-- (Unit Test 1 -> Half Yearly -> Unit Test 2 -> Annual, from the
-- existing exams table) instead of an arbitrary hand-typed date that
-- has no real anchor. exam_id is optional so a chapter can still use a
-- plain custom date (planned_date) when there's no matching exam yet.
ALTER TABLE public.syllabus_chapters
  ADD COLUMN exam_id uuid REFERENCES public.exams(id);

CREATE INDEX syllabus_chapters_exam_idx ON public.syllabus_chapters (exam_id);
