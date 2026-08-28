-- Homework module plan.md Phase 10 — the standout move: cross-link
-- homework to the syllabus/chapter-pacing engine. Nullable — most
-- homework won't be chapter-tied — matching how daily_progress_notes
-- .chapter_id already handles the same "optional link" case.

ALTER TABLE public.homework
  ADD COLUMN chapter_id uuid REFERENCES public.syllabus_chapters(id) ON DELETE SET NULL;

CREATE INDEX idx_homework_chapter ON public.homework USING btree (chapter_id);
