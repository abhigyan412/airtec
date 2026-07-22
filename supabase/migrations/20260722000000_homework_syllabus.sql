-- Homework/Classwork + Syllabus Progress Tracking
-- Two separate systems per product decision:
--   1. Chapter-level syllabus planning (planned date vs actual completion date)
--   2. Freeform daily progress notes (not tied to a specific chapter)
-- plus homework/classwork assignment (bulk to a class/section, or individual
-- students via the homework_students junction table).

insert into public.permissions (module, action, permission_code, description) values
  ('homework', 'view', 'homework.view', 'View homework and classwork assignments'),
  ('homework', 'create', 'homework.create', 'Assign homework or classwork (bulk or individual)'),
  ('homework', 'delete', 'homework.delete', 'Delete/cancel a homework or classwork assignment'),
  ('syllabus', 'view', 'syllabus.view', 'View syllabus chapter plans and completion progress'),
  ('syllabus', 'plan', 'syllabus.plan', 'Define chapters and planned completion dates for a subject'),
  ('syllabus', 'log_progress', 'syllabus.log_progress', 'Mark chapters complete and log daily progress notes')
on conflict (permission_code) do nothing;

create table public.homework (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id),
  class_id uuid not null references public.classes(id),
  section_id uuid references public.sections(id),
  subject_name text not null,
  type text not null default 'homework' check (type in ('homework', 'classwork')),
  assignment_type text not null default 'class' check (assignment_type in ('class', 'individual')),
  title text not null,
  description text,
  attachment_url text,
  assigned_date date not null default current_date,
  due_date date,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.homework_students (
  id uuid primary key default extensions.uuid_generate_v4(),
  homework_id uuid not null references public.homework(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  unique (homework_id, student_id)
);

create table public.syllabus_chapters (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id),
  class_id uuid not null references public.classes(id),
  subject_name text not null,
  academic_year_id uuid references public.academic_years(id),
  chapter_number integer,
  chapter_name text not null,
  planned_date date,
  actual_completion_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_progress_notes (
  id uuid primary key default extensions.uuid_generate_v4(),
  school_id uuid not null references public.schools(id),
  class_id uuid not null references public.classes(id),
  section_id uuid references public.sections(id),
  subject_name text not null,
  teacher_id uuid not null references public.users(id),
  note_date date not null default current_date,
  note text not null,
  created_at timestamptz not null default now()
);

create index homework_school_class_idx on public.homework (school_id, class_id);
create index homework_students_student_idx on public.homework_students (student_id);
create index syllabus_chapters_school_class_subject_idx on public.syllabus_chapters (school_id, class_id, subject_name);
create index daily_progress_notes_school_class_date_idx on public.daily_progress_notes (school_id, class_id, note_date);
