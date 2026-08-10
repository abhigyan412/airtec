-- Payroll Stage 10.1: absconded staff.
--
-- Nobody formally "exits" someone who simply stops showing up — until
-- now the only path was to manually flip them to resigned/terminated,
-- which implies a decision that was never actually made. This adds a
-- real intermediate state plus a configurable sweep to detect it.

alter table public.staff_profiles drop constraint staff_profiles_employment_status_check;
alter table public.staff_profiles add constraint staff_profiles_employment_status_check
  check (employment_status = any (array['active','on_leave','suspended','resigned','terminated','absconded']::text[]));

alter table public.schools
  add column if not exists absconded_threshold_days integer not null default 15
    check (absconded_threshold_days > 0),
  -- A school opts into automatic status changes; default is "surface
  -- for review," same posture as every other automation added this
  -- session (suspension pay policy, segment proration) — never silently
  -- change someone's employment status without an explicit opt-in.
  add column if not exists absconded_auto_flag boolean not null default false;

-- Two new notification types: the absconded sweep's review-required
-- alert, and Stage 10.2a's "attendance was corrected, regenerate the
-- payslip" nudge to whoever holds staff.payroll_manage.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'attendance_absent','leave_approved','leave_rejected',
        'tc_approved','tc_rejected','discount_approved','discount_rejected',
        'homework_assigned','exam_result_published','fee_due_soon','fee_overdue',
        'payslip_generated',
        'probation_ending','document_expiring','contract_review_due','work_anniversary',
        'payslip_regen_needed','absconded_review_needed'
    ]::text[]));
