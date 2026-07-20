--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_years (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_current boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: adhoc_fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adhoc_fees (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid,
    class_id uuid,
    title text NOT NULL,
    description text,
    amount numeric NOT NULL,
    due_date date,
    status text DEFAULT 'unpaid'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT adhoc_fees_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'cancelled'::text])))
);


--
-- Name: admission_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admission_applications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    inquiry_id uuid,
    application_number text,
    student_first_name text NOT NULL,
    student_last_name text NOT NULL,
    date_of_birth date,
    gender text,
    father_name text,
    father_phone text NOT NULL,
    mother_name text,
    mother_phone text,
    applying_for_class_id uuid,
    academic_year_id uuid,
    stream text,
    previous_school text,
    status text DEFAULT 'pending'::text NOT NULL,
    counselor_id uuid,
    counselor_approved_at timestamp with time zone,
    counselor_notes text,
    accountant_id uuid,
    accountant_approved_at timestamp with time zone,
    principal_id uuid,
    principal_approved_at timestamp with time zone,
    principal_notes text,
    student_id uuid,
    application_fee_paid boolean DEFAULT false,
    application_fee_amount numeric,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admission_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'counselor_approved'::text, 'documents_verified'::text, 'fee_paid'::text, 'principal_approved'::text, 'admitted'::text, 'rejected'::text])))
);


--
-- Name: admission_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admission_inquiries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    inquiry_number text,
    student_name text NOT NULL,
    date_of_birth date,
    gender text,
    parent_name text NOT NULL,
    parent_phone text NOT NULL,
    parent_email text,
    applying_for_class_id uuid,
    academic_year_id uuid,
    stream text,
    previous_school text,
    previous_class text,
    previous_percentage numeric,
    source_id uuid,
    counselor_id uuid,
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    budget_range text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admission_inquiries_status_check CHECK ((status = ANY (ARRAY['new'::text, 'follow_up'::text, 'interested'::text, 'documents_submitted'::text, 'entrance_exam'::text, 'approved'::text, 'fee_pending'::text, 'admitted'::text, 'rejected'::text, 'lost'::text])))
);


--
-- Name: application_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    document_type text NOT NULL,
    document_name text NOT NULL,
    file_url text NOT NULL,
    is_verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: application_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_status_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    status text NOT NULL,
    notes text,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    class_id uuid,
    section_id uuid,
    date date NOT NULL,
    status text NOT NULL,
    remarks text,
    marked_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'holiday'::text, 'leave'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid,
    user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: certificate_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    certificate_type text NOT NULL,
    content text NOT NULL,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT certificate_templates_certificate_type_check CHECK ((certificate_type = ANY (ARRAY['character'::text, 'bonafide'::text, 'migration'::text, 'achievement'::text, 'participation'::text, 'sports'::text, 'custom'::text])))
);


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    numeric_level integer,
    stream text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: complaint_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_comments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    complaint_id uuid NOT NULL,
    user_id uuid,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid,
    raised_by uuid,
    category text NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'open'::text,
    assigned_to uuid,
    resolution text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT complaints_category_check CHECK ((category = ANY (ARRAY['academic'::text, 'behavioral'::text, 'facility'::text, 'staff'::text, 'fee'::text, 'transport'::text, 'bullying'::text, 'other'::text]))),
    CONSTRAINT complaints_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT complaints_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: exam_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_subjects (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    class_id uuid NOT NULL,
    subject_name text NOT NULL,
    exam_date date,
    start_time time without time zone,
    end_time time without time zone,
    max_marks numeric DEFAULT 100 NOT NULL,
    pass_marks numeric DEFAULT 33,
    exam_hall text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exams (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    academic_year_id uuid,
    name text NOT NULL,
    exam_type text NOT NULL,
    start_date date,
    end_date date,
    status text DEFAULT 'draft'::text,
    grading_system text DEFAULT 'marks'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT exams_exam_type_check CHECK ((exam_type = ANY (ARRAY['unit_test'::text, 'monthly'::text, 'half_yearly'::text, 'annual'::text, 'pre_board'::text, 'practical'::text, 'other'::text]))),
    CONSTRAINT exams_grading_system_check CHECK ((grading_system = ANY (ARRAY['marks'::text, 'grades'::text, 'cgpa'::text]))),
    CONSTRAINT exams_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'ongoing'::text, 'completed'::text, 'result_declared'::text])))
);


--
-- Name: fee_arrears; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_arrears (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    from_academic_year_id uuid,
    to_academic_year_id uuid,
    original_invoice_id uuid,
    amount numeric(10,2) NOT NULL,
    amount_paid numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    carried_forward_at timestamp with time zone DEFAULT now() NOT NULL,
    carried_forward_by uuid,
    cleared_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fee_arrears_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'partial'::text, 'cleared'::text, 'waived'::text])))
);


--
-- Name: fee_discount_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_discount_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    role_id uuid NOT NULL,
    max_single_discount numeric(10,2) NOT NULL,
    max_monthly_total numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fee_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_discounts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    fee_head_id uuid,
    discount_type text,
    discount_value numeric NOT NULL,
    reason text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    is_active boolean DEFAULT true,
    valid_from date,
    valid_until date,
    created_at timestamp with time zone DEFAULT now(),
    approval_status text DEFAULT 'pending'::text NOT NULL,
    evaluated_against_role_id uuid,
    requested_by uuid,
    CONSTRAINT fee_discounts_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT fee_discounts_discount_type_check CHECK ((discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text])))
);


--
-- Name: fee_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_heads (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: fee_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    installment_number integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    due_date date,
    status text DEFAULT 'pending'::text NOT NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fee_installments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'overdue'::text])))
);


--
-- Name: fee_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    invoice_number text,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric NOT NULL,
    total_discount numeric DEFAULT 0,
    late_fine numeric DEFAULT 0,
    total_amount numeric NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fee_invoices_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text, 'cancelled'::text, 'waived'::text])))
);


--
-- Name: fee_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_payments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    student_id uuid NOT NULL,
    receipt_number text,
    payment_date timestamp with time zone DEFAULT now() NOT NULL,
    amount_paid numeric NOT NULL,
    payment_mode text NOT NULL,
    transaction_reference text,
    cheque_number text,
    cheque_date date,
    bank_name text,
    collected_by uuid,
    notes text,
    is_verified boolean DEFAULT false,
    verified_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    installment_id uuid,
    CONSTRAINT fee_payments_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['cash'::text, 'cheque'::text, 'neft'::text, 'card'::text, 'upi'::text, 'online'::text])))
);


--
-- Name: fee_structures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_structures (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    class_id uuid NOT NULL,
    fee_head_id uuid NOT NULL,
    amount numeric NOT NULL,
    frequency text NOT NULL,
    due_day integer,
    late_fine_per_day numeric DEFAULT 0,
    is_optional boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fee_structures_frequency_check CHECK ((frequency = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'half_yearly'::text, 'annually'::text, 'one_time'::text])))
);


--
-- Name: houses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.houses (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    color text,
    badge_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inquiry_follow_ups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inquiry_follow_ups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    inquiry_id uuid NOT NULL,
    counselor_id uuid,
    follow_up_date timestamp with time zone NOT NULL,
    channel text,
    notes text,
    outcome text,
    next_follow_up_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inquiry_follow_ups_channel_check CHECK ((channel = ANY (ARRAY['call'::text, 'whatsapp'::text, 'email'::text, 'visit'::text, 'sms'::text])))
);


--
-- Name: inquiry_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inquiry_sources (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: issued_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issued_certificates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    template_id uuid,
    certificate_type text NOT NULL,
    certificate_number text,
    issued_data jsonb DEFAULT '{}'::jsonb,
    issued_by uuid,
    qr_code_data text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: job_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_applications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    job_posting_id uuid,
    candidate_name text NOT NULL,
    email text,
    phone text NOT NULL,
    resume_url text,
    cover_letter text,
    experience_years numeric,
    current_designation text,
    expected_salary numeric,
    notice_period text,
    source text,
    status text DEFAULT 'applied'::text,
    interview_date timestamp with time zone,
    interview_notes text,
    rating numeric,
    notes text,
    assigned_to uuid,
    application_number text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT job_applications_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'shortlisted'::text, 'interview_scheduled'::text, 'interviewed'::text, 'selected'::text, 'offer_sent'::text, 'joined'::text, 'rejected'::text, 'withdrawn'::text])))
);


--
-- Name: job_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_postings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    title text NOT NULL,
    department text,
    designation text,
    employment_type text DEFAULT 'full_time'::text,
    description text,
    requirements text,
    experience_required text,
    salary_range text,
    vacancies integer DEFAULT 1,
    status text DEFAULT 'open'::text,
    posted_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT job_postings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'on_hold'::text])))
);


--
-- Name: leave_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_balances (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    year integer NOT NULL,
    total_days numeric DEFAULT 0 NOT NULL,
    used_days numeric DEFAULT 0 NOT NULL
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    total_days numeric NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    applied_at timestamp with time zone DEFAULT now(),
    CONSTRAINT leave_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: leave_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_types (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    default_days_per_year numeric DEFAULT 0,
    is_paid boolean DEFAULT true,
    carry_forward boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: parents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    father_name text,
    father_phone text,
    father_email text,
    father_occupation text,
    father_aadhaar text,
    mother_name text,
    mother_phone text,
    mother_email text,
    mother_occupation text,
    mother_aadhaar text,
    guardian_name text,
    guardian_phone text,
    guardian_relation text,
    annual_income numeric,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: payslips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payslips (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    basic_salary numeric DEFAULT 0 NOT NULL,
    hra numeric DEFAULT 0,
    da numeric DEFAULT 0,
    conveyance_allowance numeric DEFAULT 0,
    medical_allowance numeric DEFAULT 0,
    other_allowances numeric DEFAULT 0,
    gross_salary numeric DEFAULT 0 NOT NULL,
    pf_deduction numeric DEFAULT 0,
    professional_tax numeric DEFAULT 0,
    other_deductions numeric DEFAULT 0,
    lop_days numeric DEFAULT 0,
    lop_amount numeric DEFAULT 0,
    total_deductions numeric DEFAULT 0 NOT NULL,
    net_salary numeric DEFAULT 0 NOT NULL,
    payment_status text DEFAULT 'pending'::text,
    payment_date date,
    payment_mode text,
    remarks text,
    generated_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    approved_by uuid,
    approved_at timestamp with time zone,
    CONSTRAINT payslips_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT payslips_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'approved'::text, 'paid'::text, 'failed'::text])))
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    module text NOT NULL,
    action text NOT NULL,
    permission_code text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: report_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_cards (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    student_id uuid NOT NULL,
    total_marks numeric,
    obtained_marks numeric,
    percentage numeric,
    grade text,
    rank integer,
    is_pass boolean,
    remarks text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resources (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    class_id uuid,
    subject_name text,
    title text NOT NULL,
    description text,
    resource_type text NOT NULL,
    file_url text,
    external_url text,
    file_size text,
    mime_type text,
    is_published boolean DEFAULT true,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT resources_resource_type_check CHECK ((resource_type = ANY (ARRAY['notes'::text, 'assignment'::text, 'syllabus'::text, 'question_paper'::text, 'video_link'::text, 'reference'::text, 'other'::text])))
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    role text NOT NULL,
    module text NOT NULL,
    can_view boolean DEFAULT false,
    can_create boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_delete boolean DEFAULT false
);


--
-- Name: role_permissions_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions_v2 (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_system_role boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: salary_structures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salary_structures (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    basic_salary numeric DEFAULT 0 NOT NULL,
    hra numeric DEFAULT 0,
    da numeric DEFAULT 0,
    conveyance_allowance numeric DEFAULT 0,
    medical_allowance numeric DEFAULT 0,
    other_allowances numeric DEFAULT 0,
    pf_deduction numeric DEFAULT 0,
    professional_tax numeric DEFAULT 0,
    other_deductions numeric DEFAULT 0,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    state text,
    pincode text,
    phone text,
    email text,
    website text,
    logo_url text,
    affiliation_board text,
    affiliation_no text,
    established_year integer,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    name text NOT NULL,
    class_teacher_id uuid,
    max_strength integer DEFAULT 40,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_attendance (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    date date NOT NULL,
    status text NOT NULL,
    check_in time without time zone,
    check_out time without time zone,
    remarks text,
    marked_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT staff_attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'half_day'::text, 'on_leave'::text, 'holiday'::text])))
);


--
-- Name: staff_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_profiles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    employee_id text,
    designation text,
    department text,
    date_of_joining date,
    date_of_birth date,
    gender text,
    blood_group text,
    qualification text,
    experience_years numeric,
    phone text,
    alternate_phone text,
    personal_email text,
    address text,
    city text,
    state text,
    pincode text,
    emergency_contact_name text,
    emergency_contact_phone text,
    bank_name text,
    bank_account_number text,
    bank_ifsc text,
    pan_number text,
    photo_url text,
    employment_type text DEFAULT 'full_time'::text,
    employment_status text DEFAULT 'active'::text,
    reporting_to uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT staff_profiles_employment_status_check CHECK ((employment_status = ANY (ARRAY['active'::text, 'on_leave'::text, 'suspended'::text, 'resigned'::text, 'terminated'::text]))),
    CONSTRAINT staff_profiles_employment_type_check CHECK ((employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'contract'::text, 'probation'::text])))
);


--
-- Name: student_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    document_type text NOT NULL,
    document_name text NOT NULL,
    file_url text NOT NULL,
    file_size text,
    mime_type text,
    notes text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT student_documents_document_type_check CHECK ((document_type = ANY (ARRAY['aadhaar'::text, 'birth_certificate'::text, 'transfer_certificate'::text, 'marksheet'::text, 'medical'::text, 'address_proof'::text, 'photo_id'::text, 'other'::text])))
);


--
-- Name: student_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_marks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    exam_subject_id uuid NOT NULL,
    student_id uuid NOT NULL,
    marks_obtained numeric,
    is_absent boolean DEFAULT false,
    grade text,
    remarks text,
    entered_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: student_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_promotions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    from_academic_year_id uuid,
    to_academic_year_id uuid,
    from_class_id uuid,
    from_section_id uuid,
    to_class_id uuid,
    to_section_id uuid,
    promotion_type text,
    promoted_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT student_promotions_promotion_type_check CHECK ((promotion_type = ANY (ARRAY['promoted'::text, 'detained'::text, 'transferred'::text, 'withdrawn'::text])))
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    admission_number text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date,
    gender text,
    blood_group text,
    aadhaar_number text,
    religion text,
    caste_category text,
    permanent_address text,
    city text,
    state text,
    pincode text,
    phone text,
    email text,
    academic_year_id uuid,
    class_id uuid,
    section_id uuid,
    roll_number text,
    stream text,
    house_id uuid,
    is_house_captain boolean DEFAULT false,
    is_house_vice_captain boolean DEFAULT false,
    is_school_captain boolean DEFAULT false,
    is_school_vice_captain boolean DEFAULT false,
    status text DEFAULT 'active'::text NOT NULL,
    photo_url text,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT students_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text]))),
    CONSTRAINT students_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'transferred'::text, 'passed_out'::text, 'suspended'::text])))
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    code text,
    class_id uuid,
    is_elective boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: timetable_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_periods (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    section_id uuid,
    academic_year_id uuid,
    day_of_week integer NOT NULL,
    period_number integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    subject_name text NOT NULL,
    teacher_id uuid,
    room text,
    is_break boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT timetable_periods_day_of_week_check CHECK (((day_of_week >= 1) AND (day_of_week <= 6)))
);


--
-- Name: transfer_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfer_certificates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    tc_number text,
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    reason text,
    last_attendance_date date,
    conduct text DEFAULT 'Good'::text,
    dues_cleared boolean DEFAULT false,
    issued_by uuid,
    qr_code_data text,
    is_revoked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT transfer_certificates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    school_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    school_id uuid,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text,
    role text NOT NULL,
    avatar_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'school_admin'::text, 'principal'::text, 'teacher'::text, 'accountant'::text, 'counselor'::text, 'parent'::text, 'student'::text])))
);


--
-- Name: workflow_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_approvals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workflow_instance_id uuid NOT NULL,
    workflow_step_id uuid NOT NULL,
    approved_by uuid,
    status text NOT NULL,
    notes text,
    acted_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT workflow_approvals_status_check CHECK ((status = ANY (ARRAY['approved'::text, 'rejected'::text, 'escalated'::text, 'commented'::text])))
);


--
-- Name: workflow_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_definitions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    module text NOT NULL,
    entity_type text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: workflow_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_instances (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    school_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    current_step_id uuid,
    initiated_by uuid,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT workflow_instances_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: workflow_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_steps (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workflow_id uuid NOT NULL,
    step_order integer NOT NULL,
    role_id uuid NOT NULL,
    action_name text NOT NULL,
    is_required boolean DEFAULT true,
    auto_approve_condition jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: academic_years academic_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_pkey PRIMARY KEY (id);


--
-- Name: adhoc_fees adhoc_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adhoc_fees
    ADD CONSTRAINT adhoc_fees_pkey PRIMARY KEY (id);


--
-- Name: admission_applications admission_applications_application_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_application_number_key UNIQUE (application_number);


--
-- Name: admission_applications admission_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_pkey PRIMARY KEY (id);


--
-- Name: admission_inquiries admission_inquiries_inquiry_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_inquiry_number_key UNIQUE (inquiry_number);


--
-- Name: admission_inquiries admission_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_pkey PRIMARY KEY (id);


--
-- Name: application_documents application_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT application_documents_pkey PRIMARY KEY (id);


--
-- Name: application_status_history application_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_status_history
    ADD CONSTRAINT application_status_history_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_student_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_date_key UNIQUE (student_id, date);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: certificate_templates certificate_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_templates
    ADD CONSTRAINT certificate_templates_pkey PRIMARY KEY (id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: complaint_comments complaint_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_comments
    ADD CONSTRAINT complaint_comments_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- Name: exam_subjects exam_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_subjects
    ADD CONSTRAINT exam_subjects_pkey PRIMARY KEY (id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);


--
-- Name: fee_arrears fee_arrears_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_pkey PRIMARY KEY (id);


--
-- Name: fee_discount_limits fee_discount_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discount_limits
    ADD CONSTRAINT fee_discount_limits_pkey PRIMARY KEY (id);


--
-- Name: fee_discount_limits fee_discount_limits_school_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discount_limits
    ADD CONSTRAINT fee_discount_limits_school_id_role_id_key UNIQUE (school_id, role_id);


--
-- Name: fee_discounts fee_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_pkey PRIMARY KEY (id);


--
-- Name: fee_heads fee_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_heads
    ADD CONSTRAINT fee_heads_pkey PRIMARY KEY (id);


--
-- Name: fee_installments fee_installments_invoice_id_installment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_installments
    ADD CONSTRAINT fee_installments_invoice_id_installment_number_key UNIQUE (invoice_id, installment_number);


--
-- Name: fee_installments fee_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_installments
    ADD CONSTRAINT fee_installments_pkey PRIMARY KEY (id);


--
-- Name: fee_invoices fee_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_invoices
    ADD CONSTRAINT fee_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: fee_invoices fee_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_invoices
    ADD CONSTRAINT fee_invoices_pkey PRIMARY KEY (id);


--
-- Name: fee_payments fee_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_pkey PRIMARY KEY (id);


--
-- Name: fee_payments fee_payments_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_receipt_number_key UNIQUE (receipt_number);


--
-- Name: fee_structures fee_structures_academic_year_id_class_id_fee_head_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_academic_year_id_class_id_fee_head_id_key UNIQUE (academic_year_id, class_id, fee_head_id);


--
-- Name: fee_structures fee_structures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_pkey PRIMARY KEY (id);


--
-- Name: houses houses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.houses
    ADD CONSTRAINT houses_pkey PRIMARY KEY (id);


--
-- Name: inquiry_follow_ups inquiry_follow_ups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiry_follow_ups
    ADD CONSTRAINT inquiry_follow_ups_pkey PRIMARY KEY (id);


--
-- Name: inquiry_sources inquiry_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiry_sources
    ADD CONSTRAINT inquiry_sources_pkey PRIMARY KEY (id);


--
-- Name: issued_certificates issued_certificates_certificate_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_certificates
    ADD CONSTRAINT issued_certificates_certificate_number_key UNIQUE (certificate_number);


--
-- Name: issued_certificates issued_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_certificates
    ADD CONSTRAINT issued_certificates_pkey PRIMARY KEY (id);


--
-- Name: job_applications job_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_pkey PRIMARY KEY (id);


--
-- Name: job_postings job_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_postings
    ADD CONSTRAINT job_postings_pkey PRIMARY KEY (id);


--
-- Name: leave_balances leave_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_pkey PRIMARY KEY (id);


--
-- Name: leave_balances leave_balances_user_id_leave_type_id_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_user_id_leave_type_id_year_key UNIQUE (user_id, leave_type_id, year);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: leave_types leave_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_pkey PRIMARY KEY (id);


--
-- Name: leave_types leave_types_school_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_school_id_code_key UNIQUE (school_id, code);


--
-- Name: parents parents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_pkey PRIMARY KEY (id);


--
-- Name: payslips payslips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_pkey PRIMARY KEY (id);


--
-- Name: payslips payslips_user_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_user_id_month_year_key UNIQUE (user_id, month, year);


--
-- Name: permissions permissions_permission_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_permission_code_key UNIQUE (permission_code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: report_cards report_cards_exam_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_exam_id_student_id_key UNIQUE (exam_id, student_id);


--
-- Name: report_cards report_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_pkey PRIMARY KEY (id);


--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_school_id_role_module_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_school_id_role_module_key UNIQUE (school_id, role, module);


--
-- Name: role_permissions_v2 role_permissions_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions_v2
    ADD CONSTRAINT role_permissions_v2_pkey PRIMARY KEY (id);


--
-- Name: role_permissions_v2 role_permissions_v2_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions_v2
    ADD CONSTRAINT role_permissions_v2_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_school_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_school_id_name_key UNIQUE (school_id, name);


--
-- Name: salary_structures salary_structures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures
    ADD CONSTRAINT salary_structures_pkey PRIMARY KEY (id);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (id);


--
-- Name: staff_attendance staff_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_pkey PRIMARY KEY (id);


--
-- Name: staff_attendance staff_attendance_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_user_id_date_key UNIQUE (user_id, date);


--
-- Name: staff_profiles staff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (id);


--
-- Name: staff_profiles staff_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_user_id_key UNIQUE (user_id);


--
-- Name: student_documents student_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_documents
    ADD CONSTRAINT student_documents_pkey PRIMARY KEY (id);


--
-- Name: student_marks student_marks_exam_subject_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_exam_subject_id_student_id_key UNIQUE (exam_subject_id, student_id);


--
-- Name: student_marks student_marks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_pkey PRIMARY KEY (id);


--
-- Name: student_promotions student_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_pkey PRIMARY KEY (id);


--
-- Name: students students_admission_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_admission_number_key UNIQUE (admission_number);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: timetable_periods timetable_periods_class_id_section_id_day_of_week_period_nu_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_class_id_section_id_day_of_week_period_nu_key UNIQUE (class_id, section_id, day_of_week, period_number);


--
-- Name: timetable_periods timetable_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_pkey PRIMARY KEY (id);


--
-- Name: transfer_certificates transfer_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_certificates
    ADD CONSTRAINT transfer_certificates_pkey PRIMARY KEY (id);


--
-- Name: transfer_certificates transfer_certificates_tc_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_certificates
    ADD CONSTRAINT transfer_certificates_tc_number_key UNIQUE (tc_number);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workflow_approvals workflow_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_pkey PRIMARY KEY (id);


--
-- Name: workflow_definitions workflow_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_definitions
    ADD CONSTRAINT workflow_definitions_pkey PRIMARY KEY (id);


--
-- Name: workflow_definitions workflow_definitions_school_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_definitions
    ADD CONSTRAINT workflow_definitions_school_id_name_key UNIQUE (school_id, name);


--
-- Name: workflow_instances workflow_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_pkey PRIMARY KEY (id);


--
-- Name: workflow_steps workflow_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT workflow_steps_pkey PRIMARY KEY (id);


--
-- Name: workflow_steps workflow_steps_workflow_id_step_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT workflow_steps_workflow_id_step_order_key UNIQUE (workflow_id, step_order);


--
-- Name: idx_adhoc_fees_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adhoc_fees_school ON public.adhoc_fees USING btree (school_id);


--
-- Name: idx_adhoc_fees_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adhoc_fees_student ON public.adhoc_fees USING btree (student_id);


--
-- Name: idx_applications_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_school ON public.admission_applications USING btree (school_id);


--
-- Name: idx_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_status ON public.admission_applications USING btree (status);


--
-- Name: idx_attendance_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_class ON public.attendance USING btree (class_id);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_date ON public.attendance USING btree (date);


--
-- Name: idx_attendance_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_student ON public.attendance USING btree (student_id);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_school ON public.audit_logs USING btree (school_id);


--
-- Name: idx_fee_arrears_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_arrears_school ON public.fee_arrears USING btree (school_id);


--
-- Name: idx_fee_arrears_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_arrears_student ON public.fee_arrears USING btree (student_id);


--
-- Name: idx_fee_installments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_installments_invoice ON public.fee_installments USING btree (invoice_id);


--
-- Name: idx_fee_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_invoices_status ON public.fee_invoices USING btree (status);


--
-- Name: idx_fee_invoices_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_invoices_student ON public.fee_invoices USING btree (student_id);


--
-- Name: idx_fee_payments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_payments_invoice ON public.fee_payments USING btree (invoice_id);


--
-- Name: idx_inquiries_counselor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inquiries_counselor ON public.admission_inquiries USING btree (counselor_id);


--
-- Name: idx_inquiries_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inquiries_school ON public.admission_inquiries USING btree (school_id);


--
-- Name: idx_inquiries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inquiries_status ON public.admission_inquiries USING btree (status);


--
-- Name: idx_role_permissions_v2_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_v2_role_id ON public.role_permissions_v2 USING btree (role_id);


--
-- Name: idx_roles_school_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_school_id ON public.roles USING btree (school_id);


--
-- Name: idx_students_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_class ON public.students USING btree (class_id);


--
-- Name: idx_students_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_school ON public.students USING btree (school_id);


--
-- Name: idx_students_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_section ON public.students USING btree (section_id);


--
-- Name: idx_students_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_status ON public.students USING btree (status);


--
-- Name: idx_user_roles_school_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_school_id ON public.user_roles USING btree (school_id);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: idx_workflow_approvals_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_approvals_instance ON public.workflow_approvals USING btree (workflow_instance_id);


--
-- Name: idx_workflow_instances_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_instances_entity ON public.workflow_instances USING btree (entity_type, entity_id);


--
-- Name: idx_workflow_instances_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_instances_school ON public.workflow_instances USING btree (school_id);


--
-- Name: idx_workflow_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_instances_status ON public.workflow_instances USING btree (status);


--
-- Name: idx_workflow_steps_workflow_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steps_workflow_id ON public.workflow_steps USING btree (workflow_id);


--
-- Name: admission_applications trg_applications_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_applications_updated BEFORE UPDATE ON public.admission_applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: fee_invoices trg_fee_invoices_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fee_invoices_updated BEFORE UPDATE ON public.fee_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: admission_inquiries trg_inquiries_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_inquiries_updated BEFORE UPDATE ON public.admission_inquiries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: parents trg_parents_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_parents_updated BEFORE UPDATE ON public.parents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: students trg_students_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_students_updated BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: academic_years academic_years_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: adhoc_fees adhoc_fees_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adhoc_fees
    ADD CONSTRAINT adhoc_fees_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: adhoc_fees adhoc_fees_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adhoc_fees
    ADD CONSTRAINT adhoc_fees_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: adhoc_fees adhoc_fees_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adhoc_fees
    ADD CONSTRAINT adhoc_fees_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: adhoc_fees adhoc_fees_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adhoc_fees
    ADD CONSTRAINT adhoc_fees_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: admission_applications admission_applications_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: admission_applications admission_applications_accountant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_accountant_id_fkey FOREIGN KEY (accountant_id) REFERENCES public.users(id);


--
-- Name: admission_applications admission_applications_applying_for_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_applying_for_class_id_fkey FOREIGN KEY (applying_for_class_id) REFERENCES public.classes(id);


--
-- Name: admission_applications admission_applications_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: admission_applications admission_applications_inquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES public.admission_inquiries(id);


--
-- Name: admission_applications admission_applications_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.users(id);


--
-- Name: admission_applications admission_applications_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: admission_applications admission_applications_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_applications
    ADD CONSTRAINT admission_applications_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: admission_inquiries admission_inquiries_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: admission_inquiries admission_inquiries_applying_for_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_applying_for_class_id_fkey FOREIGN KEY (applying_for_class_id) REFERENCES public.classes(id);


--
-- Name: admission_inquiries admission_inquiries_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: admission_inquiries admission_inquiries_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: admission_inquiries admission_inquiries_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_inquiries
    ADD CONSTRAINT admission_inquiries_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.inquiry_sources(id);


--
-- Name: application_documents application_documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT application_documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.admission_applications(id) ON DELETE CASCADE;


--
-- Name: application_documents application_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT application_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: application_status_history application_status_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_status_history
    ADD CONSTRAINT application_status_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.job_applications(id) ON DELETE CASCADE;


--
-- Name: application_status_history application_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_status_history
    ADD CONSTRAINT application_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: attendance attendance_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: attendance attendance_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id);


--
-- Name: attendance attendance_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id);


--
-- Name: attendance attendance_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: certificate_templates certificate_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_templates
    ADD CONSTRAINT certificate_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: certificate_templates certificate_templates_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_templates
    ADD CONSTRAINT certificate_templates_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: classes classes_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: complaint_comments complaint_comments_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_comments
    ADD CONSTRAINT complaint_comments_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- Name: complaint_comments complaint_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_comments
    ADD CONSTRAINT complaint_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: complaints complaints_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: complaints complaints_raised_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.users(id);


--
-- Name: complaints complaints_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: complaints complaints_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: exam_subjects exam_subjects_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_subjects
    ADD CONSTRAINT exam_subjects_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: exam_subjects exam_subjects_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_subjects
    ADD CONSTRAINT exam_subjects_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: exam_subjects exam_subjects_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_subjects
    ADD CONSTRAINT exam_subjects_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: exams exams_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: exams exams_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: exams exams_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: fee_arrears fee_arrears_carried_forward_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_carried_forward_by_fkey FOREIGN KEY (carried_forward_by) REFERENCES public.users(id);


--
-- Name: fee_arrears fee_arrears_from_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_from_academic_year_id_fkey FOREIGN KEY (from_academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: fee_arrears fee_arrears_original_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_original_invoice_id_fkey FOREIGN KEY (original_invoice_id) REFERENCES public.fee_invoices(id);


--
-- Name: fee_arrears fee_arrears_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: fee_arrears fee_arrears_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: fee_arrears fee_arrears_to_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_arrears
    ADD CONSTRAINT fee_arrears_to_academic_year_id_fkey FOREIGN KEY (to_academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: fee_discount_limits fee_discount_limits_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discount_limits
    ADD CONSTRAINT fee_discount_limits_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: fee_discount_limits fee_discount_limits_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discount_limits
    ADD CONSTRAINT fee_discount_limits_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: fee_discounts fee_discounts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: fee_discounts fee_discounts_evaluated_against_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_evaluated_against_role_id_fkey FOREIGN KEY (evaluated_against_role_id) REFERENCES public.roles(id);


--
-- Name: fee_discounts fee_discounts_fee_head_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_fee_head_id_fkey FOREIGN KEY (fee_head_id) REFERENCES public.fee_heads(id);


--
-- Name: fee_discounts fee_discounts_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: fee_discounts fee_discounts_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: fee_discounts fee_discounts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_discounts
    ADD CONSTRAINT fee_discounts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: fee_heads fee_heads_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_heads
    ADD CONSTRAINT fee_heads_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: fee_installments fee_installments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_installments
    ADD CONSTRAINT fee_installments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.fee_invoices(id) ON DELETE CASCADE;


--
-- Name: fee_installments fee_installments_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_installments
    ADD CONSTRAINT fee_installments_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: fee_invoices fee_invoices_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_invoices
    ADD CONSTRAINT fee_invoices_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: fee_invoices fee_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_invoices
    ADD CONSTRAINT fee_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: fee_invoices fee_invoices_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_invoices
    ADD CONSTRAINT fee_invoices_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: fee_invoices fee_invoices_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_invoices
    ADD CONSTRAINT fee_invoices_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: fee_payments fee_payments_collected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES public.users(id);


--
-- Name: fee_payments fee_payments_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.fee_installments(id);


--
-- Name: fee_payments fee_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.fee_invoices(id) ON DELETE CASCADE;


--
-- Name: fee_payments fee_payments_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: fee_payments fee_payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: fee_payments fee_payments_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: fee_structures fee_structures_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: fee_structures fee_structures_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: fee_structures fee_structures_fee_head_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_fee_head_id_fkey FOREIGN KEY (fee_head_id) REFERENCES public.fee_heads(id);


--
-- Name: fee_structures fee_structures_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: houses houses_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.houses
    ADD CONSTRAINT houses_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: inquiry_follow_ups inquiry_follow_ups_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiry_follow_ups
    ADD CONSTRAINT inquiry_follow_ups_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: inquiry_follow_ups inquiry_follow_ups_inquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiry_follow_ups
    ADD CONSTRAINT inquiry_follow_ups_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES public.admission_inquiries(id) ON DELETE CASCADE;


--
-- Name: inquiry_sources inquiry_sources_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiry_sources
    ADD CONSTRAINT inquiry_sources_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: issued_certificates issued_certificates_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_certificates
    ADD CONSTRAINT issued_certificates_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);


--
-- Name: issued_certificates issued_certificates_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_certificates
    ADD CONSTRAINT issued_certificates_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: issued_certificates issued_certificates_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_certificates
    ADD CONSTRAINT issued_certificates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: issued_certificates issued_certificates_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_certificates
    ADD CONSTRAINT issued_certificates_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.certificate_templates(id);


--
-- Name: job_applications job_applications_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: job_applications job_applications_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_postings(id) ON DELETE SET NULL;


--
-- Name: job_applications job_applications_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: job_postings job_postings_posted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_postings
    ADD CONSTRAINT job_postings_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id);


--
-- Name: job_postings job_postings_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_postings
    ADD CONSTRAINT job_postings_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: leave_balances leave_balances_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id) ON DELETE CASCADE;


--
-- Name: leave_balances leave_balances_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: leave_balances leave_balances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: leave_requests leave_requests_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id);


--
-- Name: leave_requests leave_requests_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: leave_types leave_types_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: parents parents_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: parents parents_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: parents parents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payslips payslips_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: payslips payslips_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(id);


--
-- Name: payslips payslips_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: payslips payslips_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: report_cards report_cards_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: resources resources_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: resources resources_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: resources resources_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: role_permissions role_permissions_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: role_permissions_v2 role_permissions_v2_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions_v2
    ADD CONSTRAINT role_permissions_v2_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions_v2 role_permissions_v2_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions_v2
    ADD CONSTRAINT role_permissions_v2_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: salary_structures salary_structures_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures
    ADD CONSTRAINT salary_structures_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: salary_structures salary_structures_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures
    ADD CONSTRAINT salary_structures_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: salary_structures salary_structures_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures
    ADD CONSTRAINT salary_structures_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sections sections_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: sections sections_class_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_class_teacher_id_fkey FOREIGN KEY (class_teacher_id) REFERENCES public.users(id);


--
-- Name: sections sections_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: staff_attendance staff_attendance_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id);


--
-- Name: staff_attendance staff_attendance_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: staff_attendance staff_attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: staff_profiles staff_profiles_reporting_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_reporting_to_fkey FOREIGN KEY (reporting_to) REFERENCES public.users(id);


--
-- Name: staff_profiles staff_profiles_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: staff_profiles staff_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: student_documents student_documents_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_documents
    ADD CONSTRAINT student_documents_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: student_documents student_documents_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_documents
    ADD CONSTRAINT student_documents_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_documents student_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_documents
    ADD CONSTRAINT student_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: student_marks student_marks_entered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES public.users(id);


--
-- Name: student_marks student_marks_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: student_marks student_marks_exam_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_exam_subject_id_fkey FOREIGN KEY (exam_subject_id) REFERENCES public.exam_subjects(id) ON DELETE CASCADE;


--
-- Name: student_marks student_marks_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: student_marks student_marks_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_marks
    ADD CONSTRAINT student_marks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_promotions student_promotions_from_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_from_academic_year_id_fkey FOREIGN KEY (from_academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: student_promotions student_promotions_from_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_from_class_id_fkey FOREIGN KEY (from_class_id) REFERENCES public.classes(id);


--
-- Name: student_promotions student_promotions_from_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_from_section_id_fkey FOREIGN KEY (from_section_id) REFERENCES public.sections(id);


--
-- Name: student_promotions student_promotions_promoted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES public.users(id);


--
-- Name: student_promotions student_promotions_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: student_promotions student_promotions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_promotions student_promotions_to_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_to_academic_year_id_fkey FOREIGN KEY (to_academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: student_promotions student_promotions_to_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_to_class_id_fkey FOREIGN KEY (to_class_id) REFERENCES public.classes(id);


--
-- Name: student_promotions student_promotions_to_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_promotions
    ADD CONSTRAINT student_promotions_to_section_id_fkey FOREIGN KEY (to_section_id) REFERENCES public.sections(id);


--
-- Name: students students_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: students students_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: students students_house_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_house_id_fkey FOREIGN KEY (house_id) REFERENCES public.houses(id);


--
-- Name: students students_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: students students_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id);


--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: subjects subjects_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: subjects subjects_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: timetable_periods timetable_periods_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: timetable_periods timetable_periods_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: timetable_periods timetable_periods_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: timetable_periods timetable_periods_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id);


--
-- Name: timetable_periods timetable_periods_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id);


--
-- Name: transfer_certificates transfer_certificates_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_certificates
    ADD CONSTRAINT transfer_certificates_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);


--
-- Name: transfer_certificates transfer_certificates_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_certificates
    ADD CONSTRAINT transfer_certificates_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: transfer_certificates transfer_certificates_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_certificates
    ADD CONSTRAINT transfer_certificates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: workflow_approvals workflow_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: workflow_approvals workflow_approvals_workflow_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES public.workflow_instances(id) ON DELETE CASCADE;


--
-- Name: workflow_approvals workflow_approvals_workflow_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_workflow_step_id_fkey FOREIGN KEY (workflow_step_id) REFERENCES public.workflow_steps(id) ON DELETE CASCADE;


--
-- Name: workflow_definitions workflow_definitions_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_definitions
    ADD CONSTRAINT workflow_definitions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: workflow_instances workflow_instances_current_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_current_step_id_fkey FOREIGN KEY (current_step_id) REFERENCES public.workflow_steps(id);


--
-- Name: workflow_instances workflow_instances_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: workflow_instances workflow_instances_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: workflow_instances workflow_instances_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflow_definitions(id) ON DELETE CASCADE;


--
-- Name: workflow_steps workflow_steps_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT workflow_steps_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: workflow_steps workflow_steps_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT workflow_steps_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflow_definitions(id) ON DELETE CASCADE;


--
-- Name: academic_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

--
-- Name: admission_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admission_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: admission_inquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admission_inquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: application_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_heads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_heads ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_structures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;

--
-- Name: houses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.houses ENABLE ROW LEVEL SECURITY;

--
-- Name: inquiry_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inquiry_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: parents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;

--
-- Name: academic_years school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.academic_years USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: admission_applications school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.admission_applications USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: admission_inquiries school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.admission_inquiries USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: classes school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.classes USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: fee_heads school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.fee_heads USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: fee_invoices school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.fee_invoices USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: fee_payments school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.fee_payments USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: fee_structures school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.fee_structures USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: houses school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.houses USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: sections school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.sections USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: students school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_isolation ON public.students USING ((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

--
-- Name: sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

--
-- Name: student_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


