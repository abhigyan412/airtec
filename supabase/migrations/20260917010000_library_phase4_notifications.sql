-- New notification types for Library Phase 4's mass recall and
-- acquisition-request status updates. Same pattern as every prior
-- addition: a type present in code but missing from this constraint is
-- silently rejected by Postgres.
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
        'exam_datesheet_announced',
        -- Transport module
        'transport_document_expiring','student_boarded','student_alighted',
        'transport_incident_reported','transport_service_due',
        -- Library module
        'library_due_soon','library_overdue','library_fine_imposed','library_reservation_ready',
        'library_recalled','library_acquisition_update'
    ]::text[]));
