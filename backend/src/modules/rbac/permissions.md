# AIRTEC — Permissions Matrix

Deliverable for `admission/remaining-work-plan.md` Section A1 (RBAC
Finalization), but scoped to the whole ERP, not just admission — this is a
cross-cutting concern and belongs with the module that actually owns it.

`admission/decisions.md`'s most consequential correction was recognizing that
role/permission checking in this codebase is **not one system** — it's four,
layered, and every route uses exactly one (occasionally two). This document is
the map: which mechanism gates which route, and — for the RBAC v2 mechanism —
the full role → permission-code matrix.

---

## The four gating mechanisms

### 1. `requireRole(...)` — coarse gate on `users.role`

Checks the fixed, 8-value `CHECK`-constrained `users.role` column directly:
`super_admin`, `school_admin`, `principal`, `teacher`, `accountant`,
`counselor`, `parent`, `student`. Cannot see RBAC v2 at all — a user granted
"Exam Coordinator" as an additional RBAC role gets zero benefit from it on a
route gated this way, because this mechanism never looks at `user_roles`.

**Every call site, as of 2026-08-25** (28 across the backend; a handful more
matches in `rbac/seed.ts` are comments referencing the pattern, not real gates):

| File : line | Allowed base roles |
|---|---|
| `admission/routes.ts:1408` | `school_admin`, `principal` |
| `admission/routes.ts:1455` | `school_admin`, `principal` |
| `admission/routes.ts:1466` | `school_admin`, `principal` |
| `admission/routes.ts:1541` | `school_admin`, `principal` |
| `admission/routes.ts:1604` | `school_admin` |
| `admission/routes.ts:1657` | `school_admin` |
| `admission/routes.ts:1716` | `school_admin`, `principal` |
| `admission/routes.ts:1776` | `school_admin` |
| `admission/routes.ts:1792` | `school_admin` |
| `admission/routes.ts:2454` | `school_admin` |
| `exam/routes.ts:478` | `school_admin`, `principal`, `teacher` |
| `fee/lib/guards.ts:10` | `school_admin`, `accountant` |
| `notifications/routes.ts:63` | `school_admin`, `principal` |
| `notifications/routes.ts:182` | `school_admin`, `principal` |
| `principal/routes.ts:25` | `principal` |
| `principal/routes.ts:371` | `principal` |
| `principal/routes.ts:418` | `principal` |
| `principal/routes.ts:505` | `principal` |
| `rbac/seed.ts:89` | `school_admin`, `principal`, `accountant` (comment only — documents a route elsewhere this seed's `tc.generate` grant needs to match, not a gate in this file) |
| `sis/routes.ts:1070` | `school_admin`, `principal` |
| `sis/routes.ts:1611` | `school_admin`, `principal`, `teacher` |
| `teacher/routes.ts:19` | `teacher` |
| `teacher/routes.ts:435` | `teacher` |
| `teacher/routes.ts:492` | `teacher` |
| `teacher/routes.ts:554` | `teacher` |

**What this means in practice:** none of the five titles added this pass
(Director, Admission Officer, Exam Coordinator, Examiner, IT Admin) unlock
anything on these routes — they only affect `requirePermissionV2()`-gated
routes and workflow-step eligibility (mechanism 4 below). A school wanting a
"Director" to reach a `principal`-only route in this table needs that person's
actual base `users.role` set to `principal` (or `school_admin`), same as
today — the RBAC v2 role is additive visibility/reporting, not a bypass.

### 2. `requirePermissionV2(code)` — fine-grained RBAC v2 gate

The dominant mechanism — 240 call sites across the backend. Resolves the
caller's granted permission codes from `role_permissions_v2` via every RBAC v2
role assigned to them in `user_roles` (their primary role from
`LEGACY_ROLE_TO_RBAC_ROLE`, plus any additional roles granted through
Settings → Team → "Manage Roles"). This is what the five new titles actually
affect: grant someone "Exam Coordinator" and every route gated on
`admission.edit`/`admission.view`/`student.view` opens to them, regardless of
their base role.

### 3. `NON_STAFF_ROLES` exclusion — own-record scoping for parent/student

Not `requireRole()` — an inline `if (NON_STAFF_ROLES.includes(req.user!.role))`
check (`NON_STAFF_ROLES = ['parent', 'student']`, `shared/utils/helpers.ts`),
used across SIS, Exam, Admission, Documents, HRMS, and `feeScope.ts` to force
the query scope down to the caller's own (or own child's) record, no matter
what else the request asks for. Same base-`users.role` read as mechanism 1,
different purpose (a narrowing filter, not a pass/fail gate).

### 4. Workflow-engine `workflow_steps.role_id` membership

The odd one out: `startWorkflow`/`actOnWorkflow`
(`shared/middleware/workflow-engine.ts`) resolve who can act on a specific
step by checking `user_roles` membership against that step's `role_id` — an
RBAC v2 role, but checked independently of `requirePermissionV2()`. A route
like `POST /admission-slot-bookings/:id/workflow-action` carries **no**
`requirePermissionV2()` gate at all (confirmed by reading it) — eligibility is
entirely which workflow step the caller's RBAC roles put them on. This is
exactly why seeding real Examiner/Exam Coordinator roles mattered for Phase
6c's result-publishing workflow: before this pass, nobody could ever be
assigned to a step named "Examiner" because the role didn't exist to assign.

---

## RBAC v2 role → permission matrix

Generated from `DEFAULT_ROLE_PERMISSIONS` in `rbac/seed.ts` — **the source of
truth is that file, not this table.** If the two ever disagree, `seed.ts` is
right and this needs regenerating, not the other way around. 22 roles as of
2026-08-25 (17 pre-existing + 5 added this pass, marked **NEW** below).

Exact counts, generated 2026-08-25 (deduped — a code repeated across two
spread-in groups, e.g. `arrangement.view`, counts once):

| Role | Permission count | Notes |
|---|---|---|
| School Admin | 91 | Full operational + `role.manage`/`role.assign`/`team.*`/`website.*` |
| Principal | 89 | Same ceiling as School Admin minus `team.invite`/`team.deactivate` |
| **Director** *(NEW)* | 89 | Identical set to Principal — see rationale below |
| Vice Principal | 84 | Principal's set minus `staff.payroll_manage`/`staff.payroll_view`/`timetable.publish`/`arrangement.override_booking` |
| Class Teacher | 24 | Teacher's set plus `student.edit`/`exam.result_publish`/`complaint.resolve` |
| Teacher | 21 | Own-class scoped in the frontend, not this table |
| Accountant | 14 | Fee + payroll + TC-initiation |
| Exam Controller | 13 | Main Examinations module — separate from admission's entrance-test flow |
| Timetable Manager | 13 | Owns the grid and arrangement queue only |
| Counselor | 10 | `admission.*` plus legacy carryovers (`fee.discount`, `staff.recruitment_manage`) kept so converting old hardcoded gates didn't remove access a real Counselor already had |
| HR | 10 | Staff lifecycle |
| **IT Admin** *(NEW)* | 9 | `team.*` + `role.*` + `settings.manage` — zero student/admission/fee/exam data access by design |
| Librarian | 8 | Resources + own-record timetable |
| **Admission Officer** *(NEW)* | 6 | The clean version of Counselor's admission scope, no legacy carryovers |
| Receptionist | 6 | Front-desk admission intake, read-mostly |
| Parent | 6 | Read-only, further narrowed to own-child records by `NON_STAFF_ROLES` (mechanism 3) at the route level |
| Student | 6 | Read-only, further narrowed to own records by `NON_STAFF_ROLES` (mechanism 3) at the route level |
| Coordinator | 5 | `student.view` + timetable own-record set |
| **Exam Coordinator** *(NEW)* | 3 | `student.view`, `admission.view`, `admission.edit` — scoped to admission's entrance-test flow, not the main Exam module |
| **Examiner** *(NEW)* | 3 | Same set as Exam Coordinator — narrowest role, marks entry only |
| Transport Manager | 1 | `student.view` only — placeholder for a module not yet built out |
| Hostel Warden | 1 | `student.view` only — placeholder for a module not yet built out |

**Director, in full:** deliberately identical to Principal, not a hand-copied
approximation that could drift. `decisions.md`'s adopted answer for "how do
new job titles map onto the fixed base-role enum" was: map onto the closest
existing base role, don't invent a new authority tier. A school whose top
authority is titled "Director" rather than "Principal" gets the same
capabilities under the name they actually use — see `rbac/seed.ts`'s comment
on the `'Director'` entry for the literal spread that keeps the two in sync.

---

## Legacy base role → RBAC v2 primary role (unchanged by this pass)

Every user still gets exactly one of these on creation
(`assignDefaultUserRole`/`setPrimaryUserRole`), from their `users.role` value —
this mapping was not touched; the five new titles are additional roles granted
on top, never a primary-role target:

| `users.role` | RBAC v2 primary role |
|---|---|
| `super_admin` | School Admin |
| `school_admin` | School Admin |
| `principal` | Principal |
| `teacher` | Teacher |
| `accountant` | Accountant |
| `counselor` | Counselor |
| `parent` | Parent |
| `student` | Student |

None of the five new titles appear on the left — **by design**. Granting
"Director"/"Admission Officer"/"Exam Coordinator"/"Examiner"/"IT Admin" always
happens through Settings → Team → click a user → "Manage Roles" → Assign,
exactly the same flow already used for "Exam Controller" or "Class Teacher"
today. That UI already existed before this pass (`RoleManagerModal`,
`frontend/app/(app)/settings/team/page.tsx`) and already lists every RBAC v2
role generically — no frontend change was needed to surface the five new
titles, only seeding them so they exist to select.

---

## How to keep this current

- Adding a permission code: update the registry migration, then whichever
  role(s) in `DEFAULT_ROLE_PERMISSIONS` should carry it, then this file's
  matrix section.
- Adding a new RBAC v2 role: add it to `DEFAULT_ROLE_PERMISSIONS`
  (`rbac/seed.ts`) with a comment explaining the scoping decision, the same way
  every existing entry does — then re-run `seedDefaultRoles(schoolId)` against
  each real school to backfill it (it's idempotent — safe to call any time),
  then update this file.
- Adding a `requireRole()` call site: prefer `requirePermissionV2()` unless
  there's a specific reason the check must be base-role-only (e.g. it predates
  RBAC v2 and converting it would silently change who has access — see the
  comments throughout `rbac/seed.ts` for real examples of that reasoning). If
  `requireRole()` is genuinely the right call, add the row to the table above.
