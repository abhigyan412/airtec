-- 23 tenant-scoped tables were missing any index on school_id at all —
-- found by cross-referencing every table with a school_id column against
-- every table with a btree index leading on it (66/89 covered before this
-- migration). Tier 1 below composite-indexes school_id with whatever
-- column every real call site actually filters alongside it (verified by
-- grepping the route handlers, not guessed) — these are the tables that
-- grow with students x days, staff x months, or exams x students, exactly
-- the dimension that compounds as more schools onboard. Tier 2 is a plain
-- school_id index on lower-growth config/reference tables — cheap, and
-- keeps every tenant-scoped table consistent with the same discipline.
--
-- CONCURRENTLY: this runs against the live production database, some of
-- these tables (users, attendance) are read on nearly every request, and
-- CONCURRENTLY avoids taking an exclusive lock while the index builds.
-- It cannot run inside a transaction block, so this file must be applied
-- statement-by-statement via psql, not through a single transactional
-- migration runner.

-- ── Tier 1: composite, matches verified real query shape ───────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_school_active ON public.users (school_id, is_active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_school_date ON public.attendance (school_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_attendance_school_date ON public.staff_attendance (school_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_requests_school_status ON public.leave_requests (school_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_balances_school ON public.leave_balances (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payslips_school_month_year ON public.payslips (school_id, month, year);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_marks_school_exam ON public.student_marks (school_id, exam_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_cards_school_exam ON public.report_cards (school_id, exam_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_invoices_school_status ON public.fee_invoices (school_id, status);
-- fee_installments was dropped (not recreated) by 20260809000000_fee_model_rewrite.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_school_created ON public.complaints (school_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_classes_school ON public.classes (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sections_school ON public.sections (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subjects_school ON public.subjects (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_families_school2 ON public.families (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_documents_school ON public.student_documents (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfer_certificates_school ON public.transfer_certificates (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issued_certificates_school ON public.issued_certificates (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_promotions_school ON public.student_promotions (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_class_teacher_assignments_school ON public.class_teacher_assignments (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_slot_bookings_school ON public.admission_slot_bookings (school_id);

-- ── Tier 2: plain school_id, low-growth config/reference tables ────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_academic_years_school ON public.academic_years (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_class_settings_school ON public.admission_class_settings (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificate_templates_school ON public.certificate_templates (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_counters_school ON public.document_counters (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exam_subjects_school ON public.exam_subjects (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exams_school ON public.exams (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_action_requests_school ON public.fee_action_requests (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_adhoc_charges_school ON public.fee_adhoc_charges (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_concession_rules_school ON public.fee_concession_rules (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_discount_limits_school2 ON public.fee_discount_limits (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_discounts_school ON public.fee_discounts (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_heads_school ON public.fee_heads (school_id);
-- fee_optional_opt_ins was dropped (not recreated) by 20260809000000_fee_model_rewrite.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_payment_orders_school ON public.fee_payment_orders (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_scholarships_school ON public.fee_scholarships (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_structures_school ON public.fee_structures (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_holidays_school ON public.holidays (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_houses_school ON public.houses (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inquiry_sources_school ON public.inquiry_sources (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_applications_school ON public.job_applications (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_postings_school ON public.job_postings (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parents_school ON public.parents (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_period_slot_defs_school ON public.period_slot_defs (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_school ON public.push_subscriptions (school_id);
-- receipt_counters was dropped in favor of document_counters (already indexed above)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_resources_school ON public.resources (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_permissions_school ON public.role_permissions (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rte_rates_school ON public.rte_rates (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rte_reimbursement_claims_school ON public.rte_reimbursement_claims (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_salary_structures_school ON public.salary_structures (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_section_day_templates_school ON public.section_day_templates (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teacher_constraints_school ON public.teacher_constraints (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timetable_draft_periods_school ON public.timetable_draft_periods (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timetable_settings_school ON public.timetable_settings (school_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_definitions_school ON public.workflow_definitions (school_id);
