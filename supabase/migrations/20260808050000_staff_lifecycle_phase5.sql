-- Staff & HR Phase 5: recruitment paperwork layer. job_applications has
-- always had a single rating/interview_notes pair — whoever last edited
-- the candidate's card overwrote whichever came before, with no concept
-- of "who scored this candidate." This adds per-interviewer scorecards
-- and a tracked background-check sub-status; the offer letter document
-- itself (GET /documents/offer-letter/:application_id) needs no schema
-- change, it just renders existing job_applications/job_postings data.

alter table public.job_applications
  add column background_check_status text not null default 'not_started'
    check (background_check_status in ('not_started','in_progress','cleared','flagged')),
  add column background_check_notes text;

-- One scorecard per interviewer per candidate — resubmitting updates it
-- rather than creating a duplicate. Not gated on staff.recruitment_manage
-- (see backend/src/modules/hrms/routes.ts): the person best placed to
-- score a candidate is often a subject-matter teacher on the interview
-- panel, not whoever manages the recruitment pipeline.
create table public.job_application_interviewers (
  id uuid default extensions.uuid_generate_v4() primary key,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  interviewer_id uuid not null references public.users(id),
  rating numeric check (rating between 1 and 5),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (application_id, interviewer_id)
);
create index idx_job_application_interviewers_application on public.job_application_interviewers(application_id);
