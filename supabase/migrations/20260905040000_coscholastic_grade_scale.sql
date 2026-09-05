-- Co-scholastic grading follow-up: lets each area grade against a
-- configured set of labels (reusing exam_grade_scales — the same
-- reusable letter-grade table scholastic grading already uses, rather
-- than a parallel system) so grading is a click-to-select dropdown
-- instead of a free-text field.
--
-- A school-scoped MAPPING table, not a column on coscholastic_areas
-- itself — coscholastic_areas' 5 seeded rows (Discipline, ...) are shared
-- system rows (school_id IS NULL) across every school; a column on that
-- shared row would leak one school's scale choice to every other school
-- the moment they set one. This table lets each school independently pick
-- a scale for any area — a shared system one or its own custom one — with
-- zero risk of cross-school leakage, and works identically for both kinds
-- of area rather than needing two different mechanisms.
create table public.coscholastic_area_grade_scales (
  school_id uuid not null references public.schools(id) on delete cascade,
  area_id uuid not null references public.coscholastic_areas(id) on delete cascade,
  grade_scale_id uuid not null references public.exam_grade_scales(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (school_id, area_id)
);
