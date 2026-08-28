-- Homework module plan.md Phase 3: a real PATCH /academics/homework/:id
-- exists now (title/description/due_date/attachment_url) but nothing could
-- call it — no homework.edit permission code existed at all. Same two-step
-- pattern as 20260808000000_rbac_phase2_permissions.sql: new code, then a
-- backfill, since seedDefaultRoles() only fills mappings for a role that
-- has zero of them — every live school's already-seeded roles need this
-- granted explicitly or every Teacher/Admin/Principal gets 403'd on edit.

insert into public.permissions (module, action, permission_code, description) values
  ('homework', 'edit', 'homework.edit', 'Edit an existing homework/classwork assignment (title, description, due date, attachment)')
on conflict (permission_code) do nothing;

with new_grants (role_name, permission_code) as (
  values
    -- Same role set that already holds homework.create — editing is part
    -- of the same authority as creating, not a separate tier.
    ('School Admin',   'homework.edit'),
    ('Principal',       'homework.edit'),
    ('Vice Principal',  'homework.edit'),
    ('Director',         'homework.edit'),
    ('Teacher',           'homework.edit'),
    ('Class Teacher',     'homework.edit')
)
insert into public.role_permissions_v2 (role_id, permission_id)
select r.id, p.id
from new_grants ng
join public.roles r on r.name = ng.role_name
join public.permissions p on p.permission_code = ng.permission_code
on conflict (role_id, permission_id) do nothing;
