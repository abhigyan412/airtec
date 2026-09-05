-- users.primary_role_id: precisely which RBAC role (roles.id) is this
-- user's real, primary identity — replaces reverse-guessing it from the
-- 5-value legacy users.role column (school_admin/principal/teacher/
-- accountant/counselor), which cannot represent any of the other 17
-- seeded RBAC roles (Exam Controller, HR, Vice Principal, Librarian,
-- ...). Found live: the Invite Team Member form's Role picker only ever
-- offered those 5 buckets while the actual RBAC role catalog
-- (rbac/seed.ts's DEFAULT_ROLE_PERMISSIONS) has 22 — a school could never
-- invite someone directly as their real role, only as a generic bucket,
-- then separately grant the real one as an "extra" role afterward.
--
-- users.role stays exactly as it is — the ~50 requireRole() gates across
-- the backend still read it directly — but from here on it is an
-- internal, DERIVED value only (see deriveLegacyRoleFromRbacRoleName in
-- rbac/seed.ts), never shown to anyone as a label again. primary_role_id
-- is the single source of truth for "what is this person's real role."
alter table public.users
  add column primary_role_id uuid references public.roles(id) on delete set null;

-- Backfill every existing user from their current legacy bucket, via the
-- exact reverse of the mapping the backend already used to seed their
-- RBAC role in the first place (LEGACY_ROLE_TO_RBAC_ROLE) — so every
-- account's displayed role stays identical the moment this ships;
-- nothing changes for anyone already invited under the old 5-bucket
-- system. A school where the matching roles row doesn't exist yet (e.g.
-- seedDefaultRoles never ran) is simply left null — harmless, and it
-- becomes the login/edit flow's job to fill it in from here on.
update public.users u
set primary_role_id = r.id
from public.roles r
where r.school_id = u.school_id
  and r.name = case u.role
    when 'super_admin' then 'School Admin'
    when 'school_admin' then 'School Admin'
    when 'principal' then 'Principal'
    when 'teacher' then 'Teacher'
    when 'accountant' then 'Accountant'
    when 'counselor' then 'Counselor'
    when 'parent' then 'Parent'
    when 'student' then 'Student'
    else null
  end
  and u.primary_role_id is null;
