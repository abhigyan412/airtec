-- ============================================================
-- AIRTEC Phase 1 Core Schema
-- Multi-tenant: every table has school_id for isolation
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- SCHOOLS (one row per tenant)
-- ============================================================
create table schools (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  city text,
  state text,
  pincode text,
  phone text,
  email text,
  website text,
  logo_url text,
  affiliation_board text, -- CBSE / ICSE / State
  affiliation_no text,
  established_year int,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- USERS (auth layer - linked to Supabase Auth)
-- ============================================================
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references schools(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  role text not null check (role in ('super_admin','school_admin','principal','teacher','accountant','counselor','parent','student')),
  avatar_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- ACADEMIC YEARS
-- ============================================================
create table academic_years (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null, -- e.g. "2024-25"
  start_date date not null,
  end_date date not null,
  is_current boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- CLASSES & SECTIONS
-- ============================================================
create table classes (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null, -- "Class 1", "Class 10", "Class 12"
  numeric_level int, -- for ordering: 1-12
  stream text, -- Science / Commerce / Arts (for 11-12)
  created_at timestamptz default now()
);

create table sections (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  name text not null, -- "A", "B", "C"
  class_teacher_id uuid references users(id),
  max_strength int default 40,
  created_at timestamptz default now()
);

-- ============================================================
-- SUBJECTS
-- ============================================================
create table subjects (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  code text,
  class_id uuid references classes(id),
  is_elective boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- HOUSES (red/blue/green/yellow groups)
-- ============================================================
create table houses (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null, -- "Red House", "Shivaji House"
  color text,
  badge_url text,
  created_at timestamptz default now()
);

-- ============================================================
-- STUDENTS
-- ============================================================
create table students (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  admission_number text unique,
  
  -- Personal
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  gender text check (gender in ('male','female','other')),
  blood_group text,
  aadhaar_number text,
  religion text,
  caste_category text,
  
  -- Contact
  permanent_address text,
  city text,
  state text,
  pincode text,
  phone text,
  email text,
  
  -- Academic placement
  academic_year_id uuid references academic_years(id),
  class_id uuid references classes(id),
  section_id uuid references sections(id),
  roll_number text,
  stream text,
  house_id uuid references houses(id),
  
  -- House roles
  is_house_captain boolean default false,
  is_house_vice_captain boolean default false,
  is_school_captain boolean default false,
  is_school_vice_captain boolean default false,
  
  -- Status
  status text not null default 'active' check (status in ('active','inactive','transferred','passed_out','suspended')),
  
  -- Documents
  photo_url text,
  
  -- Auth link (for student portal login)
  user_id uuid references users(id),
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PARENTS / GUARDIANS
-- ============================================================
create table parents (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  
  -- Father
  father_name text,
  father_phone text,
  father_email text,
  father_occupation text,
  father_aadhaar text,
  
  -- Mother
  mother_name text,
  mother_phone text,
  mother_email text,
  mother_occupation text,
  mother_aadhaar text,
  
  -- Guardian (if different)
  guardian_name text,
  guardian_phone text,
  guardian_relation text,
  
  -- Annual income
  annual_income numeric,
  
  -- Auth link
  user_id uuid references users(id),
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- ADMISSION INQUIRY CRM
-- ============================================================
create table inquiry_sources (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null -- "Walk-in", "Website", "Facebook", "Referral", "Event"
);

create table admission_inquiries (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  
  -- Inquiry details
  inquiry_number text unique,
  student_name text not null,
  date_of_birth date,
  gender text,
  
  -- Parent contact
  parent_name text not null,
  parent_phone text not null,
  parent_email text,
  
  -- Admission details
  applying_for_class_id uuid references classes(id),
  academic_year_id uuid references academic_years(id),
  stream text,
  previous_school text,
  previous_class text,
  previous_percentage numeric,
  
  -- CRM fields
  source_id uuid references inquiry_sources(id),
  counselor_id uuid references users(id),
  
  -- Pipeline stage
  status text not null default 'new' check (status in (
    'new','follow_up','interested','documents_submitted',
    'entrance_exam','approved','fee_pending','admitted','rejected','lost'
  )),
  
  -- Notes
  notes text,
  budget_range text,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table inquiry_follow_ups (
  id uuid primary key default uuid_generate_v4(),
  inquiry_id uuid not null references admission_inquiries(id) on delete cascade,
  counselor_id uuid references users(id),
  follow_up_date timestamptz not null,
  channel text check (channel in ('call','whatsapp','email','visit','sms')),
  notes text,
  outcome text,
  next_follow_up_date timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- ADMISSION APPLICATIONS (formal stage after inquiry)
-- ============================================================
create table admission_applications (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  inquiry_id uuid references admission_inquiries(id),
  application_number text unique,
  
  -- Student info (copied from inquiry, editable)
  student_first_name text not null,
  student_last_name text not null,
  date_of_birth date,
  gender text,
  
  -- Parent info
  father_name text,
  father_phone text not null,
  mother_name text,
  mother_phone text,
  
  -- Academic
  applying_for_class_id uuid references classes(id),
  academic_year_id uuid references academic_years(id),
  stream text,
  previous_school text,
  
  -- Approval workflow
  status text not null default 'pending' check (status in (
    'pending','counselor_approved','documents_verified',
    'fee_paid','principal_approved','admitted','rejected'
  )),
  
  counselor_id uuid references users(id),
  counselor_approved_at timestamptz,
  counselor_notes text,
  
  accountant_id uuid references users(id),
  accountant_approved_at timestamptz,
  
  principal_id uuid references users(id),
  principal_approved_at timestamptz,
  principal_notes text,
  
  -- On final admission, link to student record
  student_id uuid references students(id),
  
  application_fee_paid boolean default false,
  application_fee_amount numeric,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table application_documents (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references admission_applications(id) on delete cascade,
  document_type text not null, -- "birth_certificate", "transfer_certificate", "marksheet", "aadhaar"
  document_name text not null,
  file_url text not null,
  is_verified boolean default false,
  verified_by uuid references users(id),
  verified_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- FEE MODULE
-- ============================================================
create table fee_heads (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null, -- "Tuition Fee", "Exam Fee", "Transport Fee"
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table fee_structures (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id),
  class_id uuid not null references classes(id),
  fee_head_id uuid not null references fee_heads(id),
  
  amount numeric not null,
  frequency text not null check (frequency in ('monthly','quarterly','half_yearly','annually','one_time')),
  due_day int, -- day of month when fee is due
  late_fine_per_day numeric default 0,
  is_optional boolean default false,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(academic_year_id, class_id, fee_head_id)
);

create table fee_discounts (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  fee_head_id uuid references fee_heads(id),
  
  discount_type text check (discount_type in ('percentage','fixed')),
  discount_value numeric not null,
  reason text not null,
  
  approved_by uuid references users(id),
  approved_at timestamptz,
  is_active boolean default true,
  
  valid_from date,
  valid_until date,
  
  created_at timestamptz default now()
);

create table fee_invoices (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id),
  
  invoice_number text unique,
  invoice_date date not null default current_date,
  due_date date,
  
  -- Line items stored as JSONB for flexibility
  line_items jsonb not null default '[]', -- [{fee_head_id, name, amount, discount, net_amount}]
  
  subtotal numeric not null,
  total_discount numeric default 0,
  late_fine numeric default 0,
  total_amount numeric not null,
  
  status text not null default 'unpaid' check (status in ('unpaid','partial','paid','cancelled','waived')),
  
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table fee_payments (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  invoice_id uuid not null references fee_invoices(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  
  receipt_number text unique,
  payment_date timestamptz not null default now(),
  amount_paid numeric not null,
  
  payment_mode text not null check (payment_mode in ('cash','cheque','neft','card','upi','online')),
  
  -- Mode-specific details
  transaction_reference text,
  cheque_number text,
  cheque_date date,
  bank_name text,
  
  collected_by uuid references users(id), -- accountant
  
  notes text,
  is_verified boolean default false,
  verified_by uuid references users(id),
  
  created_at timestamptz default now()
);

-- ============================================================
-- STUDENT PROMOTIONS & TRANSFERS
-- ============================================================
create table student_promotions (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  
  from_academic_year_id uuid references academic_years(id),
  to_academic_year_id uuid references academic_years(id),
  from_class_id uuid references classes(id),
  from_section_id uuid references sections(id),
  to_class_id uuid references classes(id),
  to_section_id uuid references sections(id),
  
  promotion_type text check (promotion_type in ('promoted','detained','transferred','withdrawn')),
  promoted_by uuid references users(id),
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- TRANSFER CERTIFICATES
-- ============================================================
create table transfer_certificates (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  
  tc_number text unique,
  issue_date date not null default current_date,
  
  reason text,
  last_attendance_date date,
  conduct text default 'Good',
  dues_cleared boolean default false,
  
  issued_by uuid references users(id),
  
  -- Verification
  qr_code_data text, -- encoded verification URL
  is_revoked boolean default false,
  
  created_at timestamptz default now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid references schools(id),
  user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_students_school on students(school_id);
create index idx_students_class on students(class_id);
create index idx_students_section on students(section_id);
create index idx_students_status on students(status);
create index idx_inquiries_school on admission_inquiries(school_id);
create index idx_inquiries_status on admission_inquiries(status);
create index idx_inquiries_counselor on admission_inquiries(counselor_id);
create index idx_applications_school on admission_applications(school_id);
create index idx_applications_status on admission_applications(status);
create index idx_fee_invoices_student on fee_invoices(student_id);
create index idx_fee_invoices_status on fee_invoices(status);
create index idx_fee_payments_invoice on fee_payments(invoice_id);
create index idx_audit_logs_school on audit_logs(school_id);
create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);

-- ============================================================
-- UPDATED_AT trigger function
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_students_updated before update on students
  for each row execute function update_updated_at();
create trigger trg_parents_updated before update on parents
  for each row execute function update_updated_at();
create trigger trg_inquiries_updated before update on admission_inquiries
  for each row execute function update_updated_at();
create trigger trg_applications_updated before update on admission_applications
  for each row execute function update_updated_at();
create trigger trg_fee_invoices_updated before update on fee_invoices
  for each row execute function update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table schools enable row level security;
alter table users enable row level security;
alter table academic_years enable row level security;
alter table classes enable row level security;
alter table sections enable row level security;
alter table subjects enable row level security;
alter table houses enable row level security;
alter table students enable row level security;
alter table parents enable row level security;
alter table admission_inquiries enable row level security;
alter table inquiry_follow_ups enable row level security;
alter table admission_applications enable row level security;
alter table application_documents enable row level security;
alter table fee_heads enable row level security;
alter table fee_structures enable row level security;
alter table fee_discounts enable row level security;
alter table fee_invoices enable row level security;
alter table fee_payments enable row level security;
alter table student_promotions enable row level security;
alter table transfer_certificates enable row level security;
alter table audit_logs enable row level security;

-- RLS: users can only access their own school's data
create policy "school_isolation" on students
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on admission_inquiries
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on admission_applications
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on fee_invoices
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on fee_payments
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on classes
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on sections
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on academic_years
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on houses
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on fee_heads
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "school_isolation" on fee_structures
  using (school_id = (select school_id from users where id = auth.uid()));

create policy "users_own_school" on users
  using (school_id = (select school_id from users where id = auth.uid()) or id = auth.uid());
