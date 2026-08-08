-- Phase 2 of the RBAC rollout: the /hr/permissions page and
-- role_permissions_v2 were, until now, only actually enforced by
-- academics/routes.ts (homework/syllabus). Every other module gated
-- access with hardcoded requireRole(...) role-string checks that never
-- consulted this table. This migration adds the permission codes that
-- backend/src/modules/*/routes.ts is being converted to check, for
-- actions that had no existing code to map onto.
--
-- IMPORTANT: seedDefaultRoles() (backend/src/modules/rbac/seed.ts) only
-- inserts role_permissions_v2 rows for roles that don't exist yet for a
-- school — it deliberately does NOT backfill new codes onto a school's
-- already-existing roles (to avoid clobbering manual edits). Every live
-- school already has its default roles seeded, so without an explicit
-- backfill here, every Principal/Accountant/Teacher/etc. on every
-- existing school would get 403'd the moment routes start checking
-- these new codes. Step 2 below is that backfill.

-- ═══════════════════════════════════════════════════════════════
-- STEP 1: new permission codes
-- ═══════════════════════════════════════════════════════════════

insert into public.permissions (module, action, permission_code, description) values
  ('settings', 'manage',            'settings.manage',            'Manage classes, sections, subjects, holidays, weekly-off and attendance-threshold settings'),
  ('fee', 'invoice_generate',       'fee.invoice_generate',       'Generate a fee invoice or installment plan'),
  ('fee', 'adhoc_manage',           'fee.adhoc_manage',           'Create or update an ad-hoc (miscellaneous) fee charge'),
  ('fee', 'arrear_manage',         'fee.arrear_manage',          'Carry forward or waive fee arrears'),
  ('exam', 'result_generate',       'exam.result_generate',       'Compute report cards from entered marks'),
  ('staff', 'payroll_view',         'staff.payroll_view',         'View payroll summaries and reports'),
  ('certificate', 'template_manage','certificate.template_manage','Create or edit certificate templates'),
  ('exam', 'admit_card_generate',   'exam.admit_card_generate',   'Generate student admit cards'),
  ('tc', 'view',                    'tc.view',                    'View/print an issued transfer certificate'),
  ('team', 'credentials_manage',    'team.credentials_manage',    'Reset a staff member''s login credentials'),
  ('team', 'edit',                  'team.edit',                  'Edit a staff member''s profile fields'),
  ('role', 'view',                  'role.view',                  'View role-to-user assignments'),
  ('staff', 'homeroom_manage',      'staff.homeroom_manage',      'Assign or end class-teacher/homeroom assignments')
on conflict (permission_code) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: backfill role_permissions_v2 for existing roles, across
-- every existing school. Mostly the 13 new codes above, plus one
-- pre-existing code (fee.discount -> Counselor) that a hardcoded
-- requireRole() list granted but role_permissions_v2 never did —
-- caught while converting that route, see comment on that row below.
-- ═══════════════════════════════════════════════════════════════

with new_grants (role_name, permission_code) as (
  values
    -- Existing codes, new grants: Counselor already had both
    -- capabilities via old hardcoded requireRole(...) gates (POST
    -- /fees/discounts and POST /sis respectively) but was never granted
    -- either in role_permissions_v2. Converting those routes to
    -- requirePermissionV2 without these two rows would silently take
    -- both away from every live Counselor.
    ('Counselor', 'fee.discount'),
    ('Counselor', 'student.create'),
    ('Counselor', 'staff.recruitment_manage'),
    ('Accountant', 'tc.generate'),
    -- Principal already had this via the old requireRole('school_admin',
    -- 'principal') gate on PUT /rbac/roles/:id/permissions — without this
    -- row, converting that route would lock every live Principal out of
    -- the Permissions page itself.
    ('Principal', 'role.manage'),

    ('School Admin', 'settings.manage'),
    ('Principal',     'settings.manage'),
    ('Vice Principal','settings.manage'),

    ('School Admin', 'fee.invoice_generate'),
    ('Principal',     'fee.invoice_generate'),
    ('Vice Principal','fee.invoice_generate'),
    ('Accountant',    'fee.invoice_generate'),

    ('School Admin', 'fee.adhoc_manage'),
    ('Principal',     'fee.adhoc_manage'),
    ('Vice Principal','fee.adhoc_manage'),
    ('Accountant',    'fee.adhoc_manage'),

    ('School Admin', 'fee.arrear_manage'),
    ('Principal',     'fee.arrear_manage'),
    ('Vice Principal','fee.arrear_manage'),
    ('Accountant',    'fee.arrear_manage'),

    ('School Admin', 'exam.result_generate'),
    ('Principal',     'exam.result_generate'),
    ('Vice Principal','exam.result_generate'),

    -- Vice Principal deliberately excluded, matching their existing
    -- exclusion from staff.payroll_manage in DEFAULT_ROLE_PERMISSIONS.
    ('School Admin', 'staff.payroll_view'),
    ('Principal',     'staff.payroll_view'),
    ('Accountant',    'staff.payroll_view'),

    ('School Admin', 'certificate.template_manage'),
    ('Principal',     'certificate.template_manage'),
    ('Vice Principal','certificate.template_manage'),

    ('School Admin', 'exam.admit_card_generate'),
    ('Principal',     'exam.admit_card_generate'),
    ('Vice Principal','exam.admit_card_generate'),
    ('Teacher',       'exam.admit_card_generate'),
    ('Class Teacher', 'exam.admit_card_generate'),
    ('Exam Controller','exam.admit_card_generate'),

    ('School Admin', 'tc.view'),
    ('Principal',     'tc.view'),
    ('Vice Principal','tc.view'),
    ('Accountant',    'tc.view'),

    ('School Admin', 'team.credentials_manage'),
    ('Principal',     'team.credentials_manage'),
    ('Vice Principal','team.credentials_manage'),

    ('School Admin', 'team.edit'),
    ('Principal',     'team.edit'),
    ('Vice Principal','team.edit'),

    ('School Admin', 'role.view'),
    ('Principal',     'role.view'),
    ('Vice Principal','role.view'),

    ('School Admin', 'staff.homeroom_manage'),
    ('Principal',     'staff.homeroom_manage'),
    ('Vice Principal','staff.homeroom_manage')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
