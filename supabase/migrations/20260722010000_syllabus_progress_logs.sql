-- Ties daily_progress_notes to a specific chapter, so a teacher's daily
-- entry against a chapter is the single source of truth for "covered vs
-- left" — replacing the earlier design where chapter completion was a
-- one-off toggle disconnected from the day-by-day log.

ALTER TABLE public.daily_progress_notes
  ADD COLUMN chapter_id uuid REFERENCES public.syllabus_chapters(id) ON DELETE SET NULL,
  ADD COLUMN progress_status text CHECK (progress_status IN ('started', 'in_progress', 'completed'));

CREATE INDEX daily_progress_notes_chapter_idx ON public.daily_progress_notes (chapter_id);
