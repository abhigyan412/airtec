-- Exam Controller can build, schedule and mark an exam, and is the role
-- ensureResultFreezePublishWorkflowDefinition (backend/src/modules/rbac/
-- seed.ts) assigns the Freeze step to on the default Result Freeze &
-- Publish Workflow — but was never granted exam.result_generate, the
-- permission gating "Generate Results", the one action between marks entry
-- and Freeze. Every controller had to hand off to School Admin/Principal
-- for that single step on every exam before they could do their own
-- designated job.
--
-- seedDefaultRoles() (backend/src/modules/rbac/seed.ts) only inserts
-- role_permissions_v2 rows for roles that don't exist yet for a school —
-- it deliberately never backfills a new code onto a school's already-
-- existing roles (same reasoning as
-- supabase/migrations/20260808000000_rbac_phase2_permissions.sql, which
-- this migration follows the same shape as). Every live school already has
-- Exam Controller seeded, so without this backfill only schools created
-- after this change would pick up the grant from DEFAULT_ROLE_PERMISSIONS.

with new_grants (role_name, permission_code) as (
  values
    ('Exam Controller', 'exam.result_generate')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
