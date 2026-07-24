-- Seeds the `permissions` registry — the master list of fine-grained
-- permission_codes the app gates on.
--
-- The baseline dump (20260720000000) is schema-only, so it creates this
-- table empty. The rows had only ever existed in the live DB, put there
-- by the hand-run "rbac-phase1" SQL scripts that were never committed.
-- Any DB built from migrations alone therefore came up with an empty
-- registry, which silently breaks RBAC: seedDefaultRoles() looks each
-- code up here and skips the ones it can't find, so every role for a new
-- school ends up with zero role_permissions_v2 rows and the sidebar
-- renders almost nothing (see modules/rbac/seed.ts).
--
-- The 65 codes below are the exact union of DEFAULT_ROLE_PERMISSIONS in
-- modules/rbac/seed.ts, which also matches every code referenced across
-- the backend and frontend. `module` and `action` are the two halves of
-- permission_code — the HR → Permissions screen groups by module and
-- labels each toggle by action, so both must stay in sync with the code.

insert into public.permissions (module, action, permission_code, description) values
  -- Students (SIS)
  ('student', 'view',        'student.view',        'View student profiles and lists'),
  ('student', 'create',      'student.create',      'Add a new student'),
  ('student', 'edit',        'student.edit',        'Edit student details'),
  ('student', 'delete',      'student.delete',      'Delete a student record'),
  ('student', 'promote',     'student.promote',     'Promote students to the next class'),
  ('student', 'transfer',    'student.transfer',    'Transfer students between classes or sections'),
  ('student', 'bulk_upload', 'student.bulk_upload', 'Bulk-import students from a spreadsheet'),
  ('student', 'generate_id', 'student.generate_id', 'Generate student ID cards'),

  -- Admission CRM
  ('admission', 'view',      'admission.view',      'View inquiries and applications'),
  ('admission', 'create',    'admission.create',    'Create an inquiry or application'),
  ('admission', 'edit',      'admission.edit',      'Edit an inquiry or application'),
  ('admission', 'delete',    'admission.delete',    'Delete an inquiry or application'),
  ('admission', 'follow_up', 'admission.follow_up', 'Log follow-ups against an inquiry'),
  ('admission', 'approve',   'admission.approve',   'Approve or reject an admission application'),

  -- Fees
  ('fee', 'view',             'fee.view',             'View fee structures, invoices and dues'),
  ('fee', 'collect',          'fee.collect',          'Record a fee payment'),
  ('fee', 'discount',         'fee.discount',         'Grant a fee discount or concession'),
  ('fee', 'refund',           'fee.refund',           'Issue a fee refund'),
  ('fee', 'export',           'fee.export',           'Export fee and collection reports'),
  ('fee', 'structure_manage', 'fee.structure_manage', 'Create and edit fee heads and structures'),

  -- Exams
  ('exam', 'view',           'exam.view',           'View exams, schedules and results'),
  ('exam', 'create',         'exam.create',         'Create an exam'),
  ('exam', 'publish',        'exam.publish',        'Publish an exam to students and parents'),
  ('exam', 'schedule',       'exam.schedule',       'Set the exam date sheet'),
  ('exam', 'marks_entry',    'exam.marks_entry',    'Enter or edit subject marks'),
  ('exam', 'result_publish', 'exam.result_publish', 'Publish results and report cards'),
  ('exam', 'freeze',         'exam.freeze',         'Freeze marks so they can no longer be edited'),

  -- Attendance
  ('attendance', 'view', 'attendance.view', 'View student attendance records'),
  ('attendance', 'mark', 'attendance.mark', 'Mark daily student attendance'),
  ('attendance', 'edit', 'attendance.edit', 'Edit previously marked attendance'),

  -- Complaints
  ('complaint', 'view',    'complaint.view',    'View complaints and their comment threads'),
  ('complaint', 'create',  'complaint.create',  'Raise a complaint'),
  ('complaint', 'resolve', 'complaint.resolve', 'Resolve or close a complaint'),
  ('complaint', 'assign',  'complaint.assign',  'Assign a complaint to a staff member'),

  -- Certificates
  ('certificate', 'view',     'certificate.view',     'View issued certificates'),
  ('certificate', 'generate', 'certificate.generate', 'Generate a certificate from a template'),
  ('certificate', 'verify',   'certificate.verify',   'Verify a certificate via its QR code'),

  -- Transfer certificates
  ('tc', 'generate', 'tc.generate', 'Issue a transfer certificate'),
  ('tc', 'revoke',   'tc.revoke',   'Revoke an issued transfer certificate'),

  -- Timetable
  ('timetable', 'view',   'timetable.view',   'View class and teacher timetables'),
  ('timetable', 'manage', 'timetable.manage', 'Create and edit timetable periods'),

  -- Resources
  ('resource', 'view',   'resource.view',   'View shared study resources'),
  ('resource', 'upload', 'resource.upload', 'Upload a study resource'),
  ('resource', 'delete', 'resource.delete', 'Delete a study resource'),

  -- Staff / HRMS
  ('staff', 'view',               'staff.view',               'View staff profiles'),
  ('staff', 'edit',               'staff.edit',               'Edit staff profiles'),
  ('staff', 'attendance_mark',    'staff.attendance_mark',    'Mark staff attendance'),
  ('staff', 'leave_approve',      'staff.leave_approve',      'Approve or reject staff leave requests'),
  ('staff', 'payroll_manage',     'staff.payroll_manage',     'Manage salary structures and payslips'),
  ('staff', 'recruitment_manage', 'staff.recruitment_manage', 'Manage job postings and applications'),

  -- Homework / classwork
  ('homework', 'view',   'homework.view',   'View homework and classwork assignments'),
  ('homework', 'create', 'homework.create', 'Assign homework or classwork (bulk or individual)'),
  ('homework', 'delete', 'homework.delete', 'Delete/cancel a homework or classwork assignment'),

  -- Syllabus
  ('syllabus', 'view',         'syllabus.view',         'View syllabus chapter plans and completion progress'),
  ('syllabus', 'plan',         'syllabus.plan',         'Define chapters and planned completion dates for a subject'),
  ('syllabus', 'log_progress', 'syllabus.log_progress', 'Mark chapters complete and log daily progress notes'),

  -- Roles & team
  ('role', 'manage',     'role.manage',     'Create and edit roles and their permissions'),
  ('role', 'assign',     'role.assign',     'Assign roles to users'),
  ('team', 'view',       'team.view',       'View the staff/team directory'),
  ('team', 'invite',     'team.invite',     'Invite a new staff user'),
  ('team', 'deactivate', 'team.deactivate', 'Deactivate a staff user'),

  -- Website CMS
  ('website', 'edit',    'website.edit',    'Edit website pages and content'),
  ('website', 'publish', 'website.publish', 'Publish website changes live'),
  ('gallery', 'manage',  'gallery.manage',  'Manage website gallery albums and images'),
  ('popup',   'manage',  'popup.manage',    'Manage website announcement popups')
on conflict (permission_code) do nothing;
