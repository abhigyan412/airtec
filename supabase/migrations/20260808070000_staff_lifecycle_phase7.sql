-- Staff & HR Phase 7 (final, cross-cutting): notification triggers need
-- 4 new types in notifications' closed union; department-scoped role
-- assignment needs one nullable column on user_roles (unset = today's
-- existing school-wide behavior, unchanged for everyone until an admin
-- explicitly restricts a role assignment to a department).

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'attendance_absent','leave_approved','leave_rejected',
        'tc_approved','tc_rejected','discount_approved','discount_rejected',
        'homework_assigned','exam_result_published','fee_due_soon','fee_overdue',
        'payslip_generated',
        'probation_ending','document_expiring','contract_review_due','work_anniversary'
    ]::text[]));

alter table public.user_roles add column department_scope text;
