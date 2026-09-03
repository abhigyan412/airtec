-- New notification type for the "Announce Exam" action (Examination
-- Settings -> Announce Exam tab): staff picks a real exam and notifies
-- every affected student/parent that its datesheet is out. Every trigger
-- site's type must be in this constraint or the insert is silently
-- rejected — see 20260829010000's own copy of this same comment.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'attendance_absent','leave_approved','leave_rejected',
        'tc_approved','tc_rejected','discount_approved','discount_rejected',
        'homework_assigned','exam_result_published','fee_due_soon','fee_overdue',
        'payslip_generated',
        'probation_ending','document_expiring','contract_review_due','work_anniversary',
        'payslip_regen_needed','absconded_review_needed',
        -- Timetable module
        'timetable_assigned','timetable_changed','timetable_published',
        'arrangement_assigned','arrangement_reminder','arrangement_escalated',
        'arrangement_declined','arrangement_cancelled','arrangement_unfilled',
        'absence_detected','workload_breach','booking_overridden',
        -- Exam module
        'exam_datesheet_announced'
    ]::text[]));
