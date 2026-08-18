-- ═══════════════════════════════════════════════════════════════
-- Timetable module — permissions, the Timetable Manager role,
-- and the notification types the workflow emits.
-- ═══════════════════════════════════════════════════════════════
--
-- The module previously had exactly two codes: timetable.view and
-- timetable.manage. That collapses "can look at the grid", "can rebuild
-- the school's week", "can take a teacher's protected free period away"
-- and "can publish a new version" into one switch. A school rolling out
-- ONLY the timetable feature needs those to be separable, because the
-- person who runs the daily arrangements is usually not the person
-- allowed to republish the master timetable.

-- ═══════════════════════════════════════════════════════════════
-- STEP 1: new permission codes
-- ═══════════════════════════════════════════════════════════════

insert into public.permissions (module, action, permission_code, description) values
  ('timetable', 'setup_manage',   'timetable.setup_manage',   'Configure day templates, teacher capabilities, workload limits, rooms and the class-subject plan'),
  ('timetable', 'generate',       'timetable.generate',       'Run feasibility checks and auto-generate draft timetables'),
  ('timetable', 'publish',        'timetable.publish',        'Activate a draft timetable or roll back to a previous version'),
  ('timetable', 'import',         'timetable.import',         'Import a timetable from a spreadsheet'),
  ('timetable', 'export',         'timetable.export',         'Export and bulk-print timetables'),
  ('timetable', 'workload_view',  'timetable.workload_view',  'View teacher workload distribution and breach alerts'),
  ('arrangement', 'view',         'arrangement.view',         'View the daily arrangement queue and the arrangement register'),
  ('arrangement', 'manage',       'arrangement.manage',       'Mark teachers absent and assign substitute cover'),
  ('arrangement', 'override_booking', 'arrangement.override_booking', 'Assign cover over a teacher''s protected free-period booking'),
  ('arrangement', 'acknowledge',  'arrangement.acknowledge',  'Acknowledge or decline cover assigned to you'),
  ('booking', 'manage_own',       'booking.manage_own',       'Reserve and release your own free periods')
on conflict (permission_code) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: backfill onto existing roles in every existing school
-- ═══════════════════════════════════════════════════════════════
-- seedDefaultRoles() only inserts rows for roles that do not exist yet,
-- so without this every live school's Principal would be 403'd the
-- moment the new routes start checking these codes.
--
-- Note what Timetable Manager does NOT get, below in step 3:
-- timetable.publish and arrangement.override_booking. Republishing the
-- master timetable and overriding a teacher's protected time are both
-- escalations, and requiring a second person is the correct amount of
-- friction for each.

with new_grants (role_name, permission_code) as (
  values
    ('School Admin',  'timetable.setup_manage'),
    ('Principal',     'timetable.setup_manage'),
    ('Vice Principal','timetable.setup_manage'),

    ('School Admin',  'timetable.generate'),
    ('Principal',     'timetable.generate'),
    ('Vice Principal','timetable.generate'),

    ('School Admin',  'timetable.publish'),
    ('Principal',     'timetable.publish'),

    ('School Admin',  'timetable.import'),
    ('Principal',     'timetable.import'),

    ('School Admin',  'timetable.export'),
    ('Principal',     'timetable.export'),
    ('Vice Principal','timetable.export'),

    ('School Admin',  'timetable.workload_view'),
    ('Principal',     'timetable.workload_view'),
    ('Vice Principal','timetable.workload_view'),

    ('School Admin',  'arrangement.view'),
    ('Principal',     'arrangement.view'),
    ('Vice Principal','arrangement.view'),
    ('Teacher',       'arrangement.view'),
    ('Class Teacher', 'arrangement.view'),

    ('School Admin',  'arrangement.manage'),
    ('Principal',     'arrangement.manage'),
    ('Vice Principal','arrangement.manage'),

    ('School Admin',  'arrangement.override_booking'),
    ('Principal',     'arrangement.override_booking'),

    -- Every teaching role acknowledges its own cover and books its own
    -- free periods. These are own-record capabilities: the handler
    -- resolves the actor from the token and ignores any teacher id in
    -- the request, so granting them broadly widens nothing.
    ('Teacher',       'arrangement.acknowledge'),
    ('Class Teacher', 'arrangement.acknowledge'),
    ('Principal',     'arrangement.acknowledge'),
    ('Vice Principal','arrangement.acknowledge'),
    ('Coordinator',   'arrangement.acknowledge'),
    ('Librarian',     'arrangement.acknowledge'),

    ('Teacher',       'booking.manage_own'),
    ('Class Teacher', 'booking.manage_own'),
    ('Principal',     'booking.manage_own'),
    ('Vice Principal','booking.manage_own'),
    ('Coordinator',   'booking.manage_own'),
    ('Librarian',     'booking.manage_own')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- STEP 3: the Timetable Manager role
-- ═══════════════════════════════════════════════════════════════
-- The person who actually runs this module day to day. Deliberately
-- narrow: they own the grid and the arrangement queue, and nothing
-- else in the ERP. A school rolling out only the timetable feature
-- hands this role to one or two people and gives nobody else access.

-- roles has no (school_id, name) unique constraint, so idempotency has
-- to be an explicit NOT EXISTS rather than ON CONFLICT.
insert into public.roles (school_id, name, description, is_system_role)
select s.id, 'Timetable Manager',
       'Builds and maintains the timetable, runs the daily arrangement queue, and monitors teacher workload.',
       true
from public.schools s
where not exists (
  select 1 from public.roles r where r.school_id = s.id and r.name = 'Timetable Manager'
);

with tm_perms (permission_code) as (
  values
    ('timetable.view'), ('timetable.manage'), ('timetable.setup_manage'),
    ('timetable.generate'), ('timetable.import'), ('timetable.export'),
    ('timetable.workload_view'),
    ('arrangement.view'), ('arrangement.manage'), ('arrangement.acknowledge'),
    ('booking.manage_own'),
    -- Needs to see who the staff are in order to assign cover at all,
    -- and the class/section list to navigate the grid. Read-only.
    ('staff.view'), ('student.view')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from public.roles r
join tm_perms tp on true
join public.permissions p on p.permission_code = tp.permission_code
where r.name = 'Timetable Manager'
on conflict (role_id, permission_id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- STEP 4: notification types
-- ═══════════════════════════════════════════════════════════════
-- notifications.type is a closed union (see 20260808070000). Every new
-- trigger site needs its type added here or the insert is silently
-- rejected and the teacher is simply never told.

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
        'absence_detected','workload_breach','booking_overridden'
    ]::text[]));

-- ═══════════════════════════════════════════════════════════════
-- STEP 5: default settings row for every existing school
-- ═══════════════════════════════════════════════════════════════

insert into public.timetable_settings (school_id)
select id from public.schools
on conflict (school_id) do nothing;
