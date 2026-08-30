-- Result Settings (Phase 0 of the results-engine build): registers the one
-- new permission code the whole feature needs, and backfills it onto every
-- existing school's School Admin/Principal/Vice Principal/Exam Controller
-- roles. Same two-step pattern as 20260808000000_rbac_phase2_permissions.sql
-- — seedDefaultRoles() only fills mappings for a role that has zero of them,
-- so every live school's already-seeded roles need this granted explicitly
-- or nobody can reach the new settings screens once the routes start
-- checking it.

insert into public.permissions (module, action, permission_code, description) values
  ('exam', 'result_settings_manage', 'exam.result_settings_manage', 'Configure per-class/exam-type pass criteria, grading mode and grade scales')
on conflict (permission_code) do nothing;

with new_grants (role_name, permission_code) as (
  values
    ('School Admin',    'exam.result_settings_manage'),
    ('Principal',        'exam.result_settings_manage'),
    ('Vice Principal',   'exam.result_settings_manage'),
    ('Exam Controller',  'exam.result_settings_manage')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
