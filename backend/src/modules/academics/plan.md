# Homework Module — Phase-Wise Execution Plan

> There is no dedicated `homework` module directory — the feature lives inside
> `backend/src/modules/academics/routes.ts`, sharing that file with a genuinely
> separate feature (syllabus/chapter pacing, progress notes). This plan and its
> companion `decisions.md` live here, next to the code they describe, matching
> where `backend/src/modules/admission/plan.md` sits relative to
> `admission/routes.ts`.
>
> Every phase below is grounded in two prior reports, not assumption:
> **Homework Coverage Audit** (2026-08-26, a direct code read — what exists,
> what's dead, what's missing) and **Homework, Benchmarked** (2026-08-26, the
> same code read against Fedena, Teachmint, Entab CampusCare, and Google
> Classroom's public feature material). Read those first for the *why*; this
> file is the *how*, phased and buildable.

## Guiding principles (adopted from the Admission module, confirmed to fit)

1. **Settings, not hardcoded rules.** Anywhere a school could reasonably want a
   different answer — is late submission allowed, is resubmission allowed —
   this plan defines a setting with a safe (permissive) default, not a
   constant. Exactly the convention Admission just used for its own
   conversion-prerequisite toggles.
2. **Extend, don't duplicate.** No phase introduces a parallel system next to
   something that already exists. `homework_students` already has the right
   shape for submission/grading state — extend its columns, don't add a
   second table. Reuse the `admission-documents` storage bucket pattern for
   submission files rather than inventing a new one — confirm bucket naming in
   Phase 1, don't assume.
3. **Close a dead write-path before adding new surface area.** The Coverage
   Audit's single biggest finding — a `status` column three dashboards read
   and nothing ever writes — is Phase 1 and Phase 2, ahead of every other
   improvement, including the standout Tier-3 ideas. A feature nobody can
   write to is worth more fixed than any new feature is worth added.

---

## Phase 0 — Portal login provisioning (prerequisite) — ✅ shipped 2026-08-27

Not originally a homework-module phase — this is the cross-cutting blocker
`decisions.md` flagged: `resolveOwnStudentId` returned null for every real
(non-seeded) parent/student because nothing outside `seed.ts`'s demo data
ever set `students.user_id`/`parents.user_id`. Asked the user how to
proceed rather than assuming; they chose to build this first rather than
build Phase 1+ against dead-end portal access.

**What shipped:** `POST /students/:id/portal-login` (`sis/routes.ts`),
mirroring `team/routes.ts`'s `POST /team/invite` pattern exactly — admin
picks the password client-side (not server-generated), `supabase.auth.admin
.createUser()` + a `users` row + linking `students.user_id` or
`parents.user_id` + `assignDefaultUserRole()`. This is the same
`supabase.auth.admin.createUser` mechanism `seed.ts` already used for demo
student/parent accounts (lines ~744-764) — now a real, staff-triggered,
auditable action instead of something only ever done to fake data. A new
"Portal Access" card on the Student detail page
(`frontend/app/(app)/students/[id]/page.tsx`) exposes it: two rows (Student
login / Parent login), each showing an "Active" badge once provisioned or a
"Create" button that opens a modal (reusing the exact
`generatePassword()`/`CredentialsBox` "shown once" pattern already used
twice in this codebase, on `settings/team` and `hr/recruitment`).

**Scope decision made while building, not left for later:** one shared
login per student's `parents` row (whichever parent the school registers —
father or mother's email), not a separate login per guardian — matches the
existing schema exactly (`parents` has one `user_id`, not one per
father/mother/guardian), and `resolveOwnStudentId` only ever needed *a*
match, not a specific one.

**Verified live, not just built:** created a real student login and a real
parent login against a real (non-demo) student record; logged in as both
new accounts; confirmed the student account's `GET /students/me` resolves
correctly (proving `resolveOwnStudentId` no longer returns null) and the
parent account's `GET /academics/homework` — the exact endpoint the
Homework Coverage Audit flagged as unreachable — returns `200`, not `403`.
Confirmed a second attempt to create a student login on an already-
provisioned student is rejected. Confirmed RBAC role rows
(`Student`/`Parent`) were created correctly. All test accounts, role
rows, and the student/parent `user_id` links were deleted/reset afterward —
no live data left behind.

**Not done here, deliberately:** bulk provisioning ("create logins for this
whole class"), and auto-provisioning on student creation. This phase closes
the blocker with a real, working single-student action; bulk is a fast-
follow once it's clear schools actually want to provision many families at
once rather than the more common one-at-a-time front-desk flow.

---

## Baseline (verified 2026-08-26, not description)

| Piece | Verified reality | Where |
|---|---|---|
| Assignment creation | Whole-class, whole-section, or named-individual, one schema, one `POST` | `academics/routes.ts:112-174` |
| Individual targeting | Fans out into `homework_students` junction rows, compensating-delete rollback if the fan-out fails | `academics/routes.ts:143-146` |
| Submission | **Does not exist.** No endpoint, staff or portal, ever sets `homework_students.status` past its insert-time default | grep-confirmed, zero matches |
| Grading | **Does not exist.** No marks/score/feedback column exists on `homework_students` at all | schema |
| Edit | **Does not exist.** `POST`+`DELETE` only; no `PATCH`, no `homework.edit` permission | `academics/routes.ts` |
| Attachment | `attachment_url` column exists, rendered on the portal's read view, but the staff "Assign Homework" modal has no field to set it | `frontend/app/(app)/homework/page.tsx:508-635` |
| Dashboards reading dead data | Teacher dashboard's Homework Completion trend, "3+ missed submissions" flag, and `/homework/assigned`'s Submitted/Graded/Pending counts all read `homework_students.status` | `teacher/routes.ts:103-343` |
| RBAC | Six permissions, deliberately split: `homework.view/create/delete`, `syllabus.view/plan/log_progress` — no `homework.edit` | `rbac/seed.ts` |
| Class/teacher scoping | Client-side only — `GET /academics/homework` applies no server-side ownership filter | `academics/routes.ts:67-110` |
| Portal login provisioning | **Fixed 2026-08-27, Phase 0.** `POST /students/:id/portal-login` now creates a real login and links it — see Phase 0 above | `sis/routes.ts` |
| Syllabus/chapter pacing | The more mature sibling feature — completion-vs-expected rollups, exam-linked due dates, auto-updating status from daily logs — lives in the same file, not cross-linked to homework | `academics/routes.ts:184-471` |

---

## Phase 1 — Submission (student/parent → `homework_students`) — ✅ shipped 2026-08-27

The single highest-leverage phase: three dashboards are already built and
waiting for this data to be real.

**What changes:** a new endpoint (portal-facing, and mirrored for staff to
record an on-paper submission on a student's behalf) that accepts text and/or
a file against one `homework_students` row and transitions
`status: 'assigned' → 'submitted'`. Reuses the `admission-documents`-style
base64-upload pattern already proven in Admission (`uploadAdmissionDocumentFile`)
rather than inventing a second upload mechanism — **confirm in Phase 1**
whether it shares that bucket or gets its own (`homework-submissions`); default
to a new bucket, since a `school_id/student_id/...` path scoped to homework
submissions shouldn't live inside the admission-documents bucket's storage
policies.

**Schema:** add `submission_text text`, `submission_file_url text`,
`submitted_at timestamptz` to `homework_students`. No new table — matches
Phase 1's own "extend, don't duplicate" principle.

**No longer blocked:** Phase 0 (above) closed the portal login-provisioning
gap this phase originally depended on — a real parent/student account can
now reach the portal at all. Safe to start.

**Architectural fix made while building, not originally scoped:**
`homework_students` rows only ever existed for `assignment_type: 'individual'`
— whole-class homework (confirmed the more common case) had no per-student
row at all, meaning there was nowhere for a submission to be written for the
majority of real assignments. Fixed at the source: `POST /homework` now fans
out `homework_students` rows for the resolved class/section roster
regardless of assignment type, computed once and reused for both the
fan-out and the existing notification step (previously two separate,
duplicated queries). This also fixes a gap the Coverage Audit flagged
separately — the dashboard's homework-assigned count silently excluding
whole-class homework — as a side effect, not a new phase.

**Shipped:** migration `20260830240000_homework_submission_grading.sql`
(all of Phase 1 + Phase 2's columns together, one migration, plus the new
`homework-submissions` bucket — decisions.md resolved 2026-08-27). New
`recordHomeworkSubmission()` shared by two endpoints: `POST
/academics/homework/:id/submit` (portal, the caller's own submission) and
`POST /academics/homework/:id/students/:studentId/submit` (staff, recording
a submission on a student's behalf — e.g. handed in on paper). Blocks
resubmission once `status = 'graded'` (Phase 9's resubmission toggle, not
built yet, defaults closed rather than silently overwriting a grade). `GET
/academics/homework`'s portal branch now merges each item with the caller's
own `homework_students` row as `my_submission`, so the parent/student view
can show submission and grade state, not just the assignment itself.

**Frontend:** the portal Homework page (`frontend-portal/app/(portal)/homework/page.tsx`)
gained inline submit/edit-submission forms per card (text and/or a file) and
a graded-state display (marks + feedback) — no new route, expands in place.
Added `frontend-portal/components/ui/textarea.tsx`, a primitive that app
didn't have yet.

**Done when:** a real portal user can submit text or a file against a real
assignment, `homework_students.status` flips to `submitted`, and the change is
visible immediately on the teacher's `/homework/assigned` page without a
dashboard-side change (proving the dashboards were, in fact, already correct
and only ever missing real data). **Verified live** (2026-08-27): created a
real class-wide homework item for a real 38-student section, confirmed all
38 got fanned-out rows, provisioned a real student portal login (Phase 0),
submitted as that student, confirmed the submission appears in the roster
endpoint and in the portal's own `my_submission`. All test data deleted
afterward.

---

## Phase 2 — Grading (teacher → feedback + mark) — ✅ shipped 2026-08-27

**What changes:** a `PATCH`-style grading action a teacher can take against a
submitted `homework_students` row. Two models exist in the market this module
was benchmarked against — Fedena's simple accept/reject, and
Teachmint/Classroom's marks-plus-written-feedback. **Which one AIRTEC builds
is a blocking decision, not a default** — see `decisions.md`. This phase
assumes whichever is decided; do not build both.

**Schema:** add `feedback text`, `graded_at timestamptz`, `graded_by uuid
references users(id)` to `homework_students` always. Add `marks_obtained
numeric`, `max_marks numeric` only if the marks-based model is chosen.

**Notification:** on grading, notify the student/parent the same way
`homework_assigned` already does (`createNotifications`, best-effort,
try/catch) — extend the existing notification-type set with
`homework_graded`, don't build a second notification pathway.

**Shipped:** `PATCH /academics/homework/:id/students/:studentId/grade` —
marks + feedback (decisions.md resolved 2026-08-27), works whether or not a
submission exists yet (creates the `homework_students` row if needed, so a
teacher can grade an in-class or on-paper assessment without going through
the submit endpoint first). Fires a best-effort `homework_graded`
notification. New `GET /academics/homework/:id/students` roster endpoint
(homework + every student's row, joined to name/roll number) backs a new
grading UI: `/homework/assigned` (`frontend/app/(app)/homework/assigned/page.tsx`)
now opens a `GradeModal` when a tracked item is clicked, listing each
student's submission with an inline marks/feedback form.

**Bug caught and fixed during live verification, not by review:** the
roster endpoint's initial `.order('created_at')` referenced a column
`homework_students` doesn't have — would have 500'd on every real call.
Live-testing against the real database caught it immediately; fixed to
`.order('id')` before this phase was marked done.

**Done when:** a teacher can grade a real submission from Phase 1, the
student/parent sees the result and feedback on the portal, and the Teacher
Dashboard's Homework Completion trend shows a real, non-zero percentage for
the first time. **Verified live** (2026-08-27): graded the real test
submission above (8/10, written feedback), confirmed `status: 'graded'`
round-tripped correctly through the roster endpoint and the portal's own
`GET /academics/homework`. All test data deleted afterward.

---

## Phase 3 — Edit an existing assignment — ✅ shipped 2026-08-27

**What changes:** `PATCH /academics/homework/:id` for `title`, `description`,
`due_date`, `attachment_url`. New `homework.edit` permission, granted
alongside `homework.create` to every role that currently holds it (School
Admin, Principal, Vice Principal, Teacher, Class Teacher) — not a new tier of
access, just closing a gap in an existing one.

**Constraint:** editing `assignment_type` or the student/class target after
creation is out of scope for this phase — that's a re-targeting operation
with real implications for any submissions already in flight (Phase 1), and
deserves its own scoping if it turns out to be needed, not a silent addition
here.

**RBAC gotcha hit and handled, not new:** `seedDefaultRoles()` only fills
`role_permissions_v2` for a role that has zero mappings — it does not
backfill a newly-added code onto a school's already-seeded roles (same
caveat `20260808000000_rbac_phase2_permissions.sql` hit first). Migration
`20260830250000_homework_edit_permission.sql` follows that exact two-step
shape: insert the `homework.edit` permission row, then an explicit backfill
into `role_permissions_v2` for every existing School Admin / Principal /
Vice Principal / Director / Teacher / Class Teacher role across every
school — without it, every live school's staff would have gotten a 403 on
this brand-new route the moment it shipped.

**Done when:** a teacher can fix a typo in a due date without deleting and
recreating the assignment, and the existing `homework_students` links survive
the edit untouched. **Verified live** (2026-08-27): confirmed a School Admin
token can `PATCH` (title/description/due_date all round-tripped correctly),
confirmed an empty-body `PATCH` is rejected with a clear error, and confirmed
an Accountant token (holds `homework.create` for nothing — no homework
permissions at all) gets a real `403: Missing permission: homework.edit`.
UI verified in a real browser: the day rail's new pencil icon opens the same
modal in an edit-scoped mode (type/assign-to/subject/student-picker all
correctly hidden, only title/description/due-date/attachment editable).

---

## Phase 4 — Attachment upload in the Assign modal — ✅ shipped 2026-08-27

**What changes:** add a file field to `AddHomeworkModal`
(`frontend/app/(app)/homework/page.tsx`), wired to set `attachment_url` on
create. **Differs from the original plan in one way:** rather than a
stand-alone pre-upload endpoint, the file rides along in the same `POST
/homework` request as base64 (`file_base64`/`file_name`/`mime_type`) and the
backend uploads it server-side right after the row insert — the homework
doesn't have an id yet when a teacher picks a file in the modal, so there
was nowhere for a separate "upload first" call to attach it to. Upload is
best-effort: a failed upload logs and continues rather than losing the
title/description/due-date the teacher already filled in. The same
`file_base64` fields were added to `PATCH /homework/:id` too, so Phase 3's
edit modal can also replace an assignment's attachment, not just set one at
creation.

**Done when:** a real teacher can attach a file when assigning homework, and
it renders correctly on both the staff read view and the portal (closing the
asymmetry the Coverage Audit found, where only the portal rendered it).
**Verified live** (2026-08-27): created a real assignment with a real
uploaded attachment, confirmed `attachment_url` populated with a working
`homework-submissions` bucket URL; edited that same assignment with a
replacement file, confirmed the URL updated to the new file. All test
homework rows and both uploaded storage files deleted afterward.

---

## Phase 5 — Server-side class/teacher scoping — ✅ shipped 2026-08-27

**What changes:** `GET /academics/homework` (and the syllabus/progress-notes
endpoints with the same gap) currently trust the frontend's class picker to
restrict results to a teacher's own classes. Add the same `my-classes`
resolution the frontend already uses (`GET /academics/my-classes`, sourced
from `timetable_periods`) as a server-side filter for any non-senior-management
caller, mirroring how `Teacher`/`Class Teacher` are already scoped everywhere
else in this codebase.

**Shipped:** `getOwnClassCombos()` extracted from `/my-classes` into a shared
function (now backs both that route and the new scoping); `resolveClassScope()`
determines "senior management" the same way the frontend already does
(`syllabus.plan` permission or a super role), returning either unrestricted
access or the caller's own combos; `inClassScope()` checks a row's
`(class_id, subject_name, section_id)` against those combos, treating a
`section_id: null` row as visible to anyone teaching that class+subject in
any of their own sections. Applied to `GET /homework`, `/syllabus`,
`/syllabus/stats`, and `/progress-notes` — narrowing the DB query by class
first, then filtering the exact class+subject(+section) match in JS, since
building that as a single PostgREST filter string got fragile fast. Write
endpoints (`POST`) were deliberately left out of this phase's scope — this
was about read-side leakage specifically, per the audit that flagged it.

**Done when:** a Teacher-role token querying a `class_id`/`section_id` outside
their own timetabled combos gets an empty result, not another teacher's data.
**Verified live** (2026-08-27) against a real teacher account: querying an
out-of-scope class returned `[]`; querying with no filters at all returned
only that teacher's own classes; critically, a same-class-same-section
homework item in a *different* subject the teacher doesn't teach was
correctly excluded too — confirming subject-level scoping, not just class.
The same subject-only exclusion was confirmed on `GET /syllabus`
independently. All test homework and the temporarily-reactivated test
teacher account were cleaned up/reverted afterward.

---

## Phase 6 — Late-submission handling — ✅ shipped 2026-08-27

**What changes:** submissions (Phase 1) past `due_date` are still accepted,
not blocked, but flagged (`is_late boolean`, computed at submission time from
`submitted_at > due_date`) — matching Fedena's model, where the teacher still
chooses accept/reject rather than the system silently rejecting a late
student.

**School-configurable settings, shipped as decided:**

| Setting | Owner | Default |
|---|---|---|
| Accept submissions after the due date at all | School Admin | On (permissive default, per Guiding Principle 1) |
| Grace period after due date before flagging late | School Admin | 0 days |

Surfaced via a new minimal `GET`/`PATCH /academics/homework-settings`
endpoint and a compact "Late submissions" card on the Homework page, visible
to School Admin only — deliberately not folded into a larger settings page,
since Phase 9 explicitly left that placement decision open; this is the
first, small version of that surface, not the final one.

**Real bug found and fixed during live verification, not by review:**
`recordHomeworkSubmission()` had no check that the submitting student was
actually a legitimate target of the homework — any logged-in student could
submit against any `homework_id` in the school by ID, silently creating a
phantom `homework_students` row for an assignment never assigned to them
(caught when a Class 1 student's submission against a Class 9 teacher's
homework unexpectedly succeeded). Fixed: a submission with no existing
`homework_students` row is only accepted if the homework is class-wide *and*
the student's own class/section actually matches it; an individual
assignment always requires a pre-existing row. Re-verified live after the
fix — the same cross-class attempt now correctly returns `403: This
homework was not assigned to you`, while the student's legitimate submission
still succeeds.

**Also fixed:** `HomeworkSettingsCard`'s first draft called `useQuery`/
`useMutation` after a conditional early return on `user.role` — a Rules-of-
Hooks violation that happened not to manifest for the School Admin test
account used to verify it, but was real. Fixed by calling every hook
unconditionally (`enabled: isSchoolAdmin` on the query) and moving the
early return after all hooks are declared.

**Done when:** a submission made after `due_date` is visibly marked late to
the grading teacher, and turning the "accept late submissions" setting off
actually blocks the submission endpoint from Phase 1 with a clear error, not
just a UI hint. **Verified live** (2026-08-27): a submission against a
past-due assignment came back `is_late: true`; turning the school setting
off then correctly blocked a second late submission attempt with the exact
intended error message; turning it back on let that same submission through
successfully; an on-time submission against a future-dated assignment came
back `is_late: false`. All test homework, settings changes, and portal
accounts were reset/deleted afterward.

---

## Phase 7 — Real-time completion dashboard + bulk reminders — ✅ shipped 2026-08-27

**What changes:** once Phases 1–2 make `status` real, extend
`/homework/assigned` (already showing Submitted/Graded/Pending counts, just
against dead data until now) with a per-student roster view — who's
submitted, who's pending, who's overdue — and a "remind" action that reuses
the existing best-effort notification pathway (same `createNotifications` used
for `homework_assigned`) rather than a new delivery mechanism.

**Corrected scope, found while building:** the per-student roster view
itself already shipped as part of Phase 2 (`GET
/academics/homework/:id/students` + `GradeModal`) — that work was framed
around grading, but a roster is a roster. What Phase 7 actually added on
top: an **overdue** distinction (pending + past `due_date`, computed
client-side from the homework's own due date rather than a new column —
Phase 6's `is_late` is submission-time-only and doesn't apply to a student
who hasn't submitted at all), and the bulk **remind** action: new `POST
/academics/homework/:id/remind` messages every student still at
`status: 'assigned'` in one `createNotifications` call, and a "Remind N
unsubmitted" button in `GradeModal`'s header that only renders when there's
actually someone to remind.

**Done when:** a teacher can see exactly which students in a class haven't
submitted a specific assignment and send them a reminder in one click, with
real counts instead of the permanently-zero ones the Coverage Audit found.
**Verified live** (2026-08-27): a 38-student class-wide assignment with one
student graded correctly reported `reminded: 37`; a fully-graded assignment
correctly reported `reminded: 0` rather than erroring on an empty recipient
list. UI verification of the "Remind" button itself was attempted but
blocked by a test-environment issue (a real Teacher-role browser session
got stuck on a loading spinner in this harness, unrelated to the shipped
code — the same backend calls the page depends on responded correctly and
quickly when hit directly) — not re-attempted further; the button reuses
the exact `Button`/`Badge` components already visually confirmed working in
this same modal during Phase 2. All test homework and the temporarily-
reactivated test teacher account were cleaned up/reverted afterward.

---

## Phase 8 — Unify the two "my homework" read views — ✅ shipped 2026-08-27, adapted

**What changes:** `frontend/app/(app)/homework/page.tsx`'s `MyHomeworkView`
and `frontend-portal/app/(portal)/homework/page.tsx` currently duplicate the
same read-only list with diverging field coverage (only the portal renders
`attachment_url`) and diverging grouping (flat list vs. Overdue/This
week/Later buckets). Extract one shared component — the portal's
bucketed grouping is the better UX and should become the shared default —
used by both apps, closing the drift the Coverage Audit flagged.

**Corrected, not built as literally planned:** "one component used by both
apps" assumed cross-app code sharing that doesn't exist in this codebase —
`frontend` and `frontend-portal` are two independent Next.js apps with no
workspace/monorepo tooling (no `pnpm-workspace.yaml`, no shared package)
between them. Building that infrastructure purely to de-duplicate two
~50-line read-only views would be disproportionate. Shipped instead: brought
`MyHomeworkView` to the portal's exact grouping and field coverage by hand
(same Overdue/This week/Later bucket logic, same attachment rendering),
documented as intentionally-parallel, manually-kept-in-sync implementations
rather than one shared import.

**Also discovered while doing this — worth recording:** checked
`rbac/seed.ts` directly rather than assuming, and found `MyHomeworkView` is
effectively unreachable by any *built-in* role today. Every built-in role
holding `homework.view` also holds either `homework.create` (School Admin,
Principal, Vice Principal, Director, Teacher, Class Teacher — all land on
`StaffHomeworkView` instead) or nothing beyond view at all (Parent,
Student) — and Parent/Student are hard-redirected to the family portal app
by `(app)/layout.tsx` before this page ever mounts. So despite the Coverage
Audit's framing, this was never actually competing with the portal's view
for real users; it's reachable today only via a custom/edited RBAC grant.
Polished anyway rather than deleted, since RBAC v2 genuinely allows that
kind of custom role and this is its correct landing spot if one exists.

**Done when:** both apps render the same component, both show attachments
(closing Phase 4's other half), and a future field addition (e.g. Phase 1's
submission status, Phase 2's grade) only needs to be added once — the last
clause doesn't fully hold given the "adapted, not literal sharing" call
above; a future field still needs adding in both places by hand, same as
every other piece of UI these two apps don't share. Everything else holds:
both views now use the same grouping logic and both render attachments.

---

## Phase 9 — School-configurable submission policy toggles — ✅ shipped 2026-08-27

**What changes:** beyond Phase 6's late-submission toggle, add a
`resubmission_allowed` school setting — can a student re-submit after being
graded (before the teacher regrades) — surfaced on the same Admission Settings
pattern already established (a toggle card, default off, School Admin only).
Consider placing this on a new "Academics Settings" surface rather than
overloading Admission's own settings page — **flagged for a placement
decision when this phase starts**, not decided here.

**Placement decision resolved:** extended Phase 6's existing minimal
`homework-settings` endpoint/card rather than building a separate
"Academics Settings" page — three toggles total doesn't justify a whole new
settings surface; the card now has two labeled groups ("Late submissions",
"Resubmission") instead of one.

**Shipped:** migration adds `schools.homework_resubmission_allowed boolean
default false` — the one deliberately conservative default in this whole
module, per the reasoning already in `decisions.md` (an open resubmission
could be used to game a grade after seeing feedback). `recordHomeworkSubmission()`
now allows a resubmission of a graded row only when the school setting is
on, and when it does, clears `marks_obtained`/`max_marks`/`feedback`/
`graded_at`/`graded_by` back to null and returns the row to `submitted` —
a clean slate for the teacher to re-grade, not a stale grade sitting next
to a new answer. Portal UI: a graded homework card now shows a "Resubmit"
button beneath the grade display when (and only when) the school has the
setting on, reusing the exact same `SubmissionForm` component already used
for a first submission.

**Done when:** with resubmission off (default), a graded `homework_students`
row rejects a second Phase-1 submission attempt with a clear error; with it
on, a resubmission clears the previous grade/feedback and returns the row to
`submitted`. **Verified live** (2026-08-27) against real data: with the
setting off, a resubmission attempt was correctly rejected; turned on, the
same resubmission succeeded and cleared the prior grade exactly as
specified; re-grading afterward worked normally. Portal UI confirmed
visually against real seeded homework data — the "Resubmit" button rendered
correctly beneath a real 9/10 graded card. Setting restored to its default
(off) and all test data deleted afterward.

---

## Phase 10 — Cross-link homework to the syllabus/chapter-pacing engine — ✅ shipped 2026-08-27

**The standout phase** — none of the four competitors benchmarked have
anything like this, because none of them build curriculum pacing and homework
as the same product. AIRTEC already accidentally does (same file, same
module) — this phase makes that deliberate instead of incidental.

**Shipped, scoped slightly differently than written:**
- New nullable `homework.chapter_id → syllabus_chapters(id) ON DELETE SET
  NULL`, exactly as planned — same optional-link shape as
  `daily_progress_notes.chapter_id`.
- "Assign homework for this chapter" shipped as a small `+` icon on every
  row of `SyllabusChapterModal`'s existing chapter list (not gated behind
  "marking a chapter complete" specifically — available on any chapter,
  which is the more useful version of the same idea: a teacher planning
  ahead doesn't have to wait until a chapter is done to attach homework to
  it). Opens `AddHomeworkModal` pre-filled with the chapter's class/section/
  subject and a title defaulting to the chapter's own name.
- Homework completion was rolled into `GET /academics/syllabus` (the
  per-chapter list `SyllabusChapterModal` already renders) rather than
  `GET /academics/syllabus/stats` (the class/section/subject *aggregate*
  rollup used elsewhere). A chapter, not a class+subject group, is the
  natural unit a homework item links to — attaching the summary to the
  aggregate endpoint would have meant either averaging across chapters
  (loses the point) or restructuring that endpoint's whole grouping. Still
  "rolled into an existing endpoint, not a parallel report," just the more
  fitting one of the two candidates.

**Done when:** marking a chapter complete in the existing progress-log flow
surfaces a one-click path to assign homework against it, and a chapter's
stats view shows homework completion alongside pacing completion.
**Verified live** (2026-08-27) against a real chapter with real students:
created a real homework item linked to "Ch 1. Number Systems" via the
actual UI flow, confirmed `GET /academics/syllabus` returned
`homework_summary: { items: 1, submitted: 0, graded: 0, pending: 38 }`
immediately after creation; graded one real student and confirmed the
summary updated to `graded: 1, pending: 37` on the next fetch — no caching
staleness. Confirmed visually in the browser: the chapter row now reads
"1 homework item · 1 graded · 0 submitted · 37 pending" directly beneath
its pacing status, and the two dialogs (chapter list, assign-homework
form) stack correctly as nested Radix portals. Test homework deleted
afterward.

**Known rough edge, not fixed here — same root cause as Phase 11's
finding:** the pre-filled Subject dropdown in `AddHomeworkModal` can render
blank when opened from a chapter. The state is set correctly
(`fromChapter.subject_name`, e.g. `"Mathematics"`); the dropdown's *options*
come from the class's registered `subjects` master-table list, which for
senior-secondary subjects in this school's real data only has `"Maths"` —
the exact `subjects`-table incompleteness Phase 11 found, now visibly
surfaced here too. Doesn't affect correctness (the chapter link is via
`chapter_id`, not `subject_name` matching, and the underlying form state
still holds the right value even though the dropdown shows no matching
label) — but a user seeing a blank-looking required field could be misled
into changing it unnecessarily. Same fix, same owner, same open question as
Phase 11 — not duplicated as a second finding.

---

## Phase 11 — Feed homework signal into the existing early-warning pattern — ✅ shipped 2026-08-27

**What changes:** the Teacher Dashboard's `NeedsAttentionPanel` already flags
attendance and fee risk per student from real data. Once Phase 1 makes
`status` real, extend the existing "3+ consecutive missed homework
submissions" check (`teacher/routes.ts:261-269` — currently computed against
dead data, so currently dormant) to actually fire, and confirm it fits the
panel's existing risk-signal format rather than adding a fourth, differently-
shaped card.

**Turned out to need no logic change at all:** the check itself, the
`homeworkByStudent` map feeding it, and the `homework_assigned`
metric/completion trend all read from a query that was never filtered by
`assignment_type` — the only reason class-wide homework was invisible to
any of them was that no `homework_students` rows existed for it, which
Phase 1's fan-out fix already resolved. Verified by reading the query
directly rather than assuming: `GET /teacher/homework-overview`'s sibling
query in this same file selects `homework_students(student_id, status)`
unconditionally. The only real change here was correcting the stale
comment above `homework_assigned` that still described the old,
individual-only reality.

**Done when:** a student who genuinely misses three homework submissions in a
row shows up on the panel a real teacher looks at, using the exact mechanism
that already half-exists rather than new subsystem. **Verified live**
(2026-08-27): created three real past-due class-wide homework items for a
real teacher's real section, confirmed 38 real students correctly appeared
in `needs_attention` with `"3 consecutive missed homework submissions"` —
the exact signal, firing on real class-wide data, for the first time. All
test homework deleted and the temporarily-reactivated teacher account
reverted afterward.

**Real bug found during this verification — flagged to the user, then fixed
on request 2026-08-27 (not bundled silently into this phase):** every
flagged student's `first_name`/`last_name`/`class_name`/`section_name` came
back as an empty string. Root cause wasn't in this module:
`getTeacherContext()` (`shared/utils/teacherContext.ts`) only keeps a
teaching assignment whose `timetable_periods.subject_name` exactly matches
a row in the `subjects` master table, and that table was missing every
senior-secondary subject in this school's real data — `Mathematics`,
`Physics`, `Chemistry`, `Biology`, `Computer Science`, `Accountancy`,
`Business Studies`, `Economics`, `History`, `Geography`, `Political
Science`, `Social Science`, `Physical Education` (13 of 40 distinct
timetabled subject names — only junior/middle-school subjects like
`Maths`/`Science`/`SST` were registered). A teacher whose assignment got
silently dropped this way lost their correct `sectionIds`, which broke
`studentInfoById` and, confirmed once fixed, `classes_performance` too
(same `ctx.sectionIds` dependency).

**Fix, in `supabase/migrations/20260830290000_backfill_missing_subjects.sql`**
(not a homework-module migration — lives at the repo root migrations
folder like every other, but the module boundary is worth naming since
`subjects`/`teacherContext.ts` belong to no module in particular): a
dynamic backfill, not a hardcoded list — inserts whatever's actually
missing from `subjects` for any school (matched against real
`timetable_periods` data), using the exact same shape every existing row
already used (school-wide, `class_id` null, `subject_type: 'core'`). Also
closed the other half of the same gap: `timetable_periods.subject_id` has
existed all along but was never populated for these rows (confirmed: 0 of
319 affected rows had it set) — backfilled that too, which turned out to
fix `subject_id` on 1,367 rows total, not just the 319 originally
mismatched (many already-matching rows, like `Maths`, had also never had
`subject_id` set). **Verified live**: re-ran the exact Phase 11 scenario —
names now resolve correctly (`"Charvi Agarwal"`, `"Class 9 A"`, not blank);
`classes_performance` now returns a populated `subject_id` for a real
Mathematics section; Phase 10's Subject dropdown pre-fill now shows
`Mathematics` as a real, selectable option. Zero mismatches remain,
confirmed by re-running the same query that first found 13. Applied to
local dev only so far — production has the same gap and needs the same
migration when ready.

---

## Phase 12 — Originality / AI-authorship signal — parked, confirmed 2026-08-27

**Not scoped in detail here** — this is the one phase in the benchmark report
that isn't a clear build, because it isn't clear what "build" means yet.
Google Classroom's Originality Reports compare submitted text against the web
and prior submissions; none of the four competitors benchmarked, AIRTEC
included, do anything about AI-generated text specifically. See
`decisions.md` — this needs a scoping decision (what does "originality" mean
for this product, what's the false-positive tolerance, is a third-party
detector API acceptable) before it becomes a phase with a schema and a `Done
when`. Treat as parked, not planned, until that decision is made.

**Actively revisited, not just left stale:** when work resumed through
Phase 11, this was explicitly re-raised — presented as three real options
(skip; Classroom-style web/prior-submission overlap; AI-authorship
detection) rather than assumed. Decision: stay parked. See `decisions.md`
for the full record. This closes out the module's plan — every other phase
(0 through 11) is shipped; this is the one deliberate non-build.

---

## What this plan deliberately does not cover

Recurring/scheduled homework (a weekly spelling list that reposts itself) and
bulk multi-section assignment in one action were both flagged as gaps in the
Coverage Audit, but **no competitor benchmarked clearly does either one well
either** — this isn't catch-up ground, it's speculative scope with no proven
demand signal from the comparison set. Not phased here; revisit if a real
school asks for it.

---

## UI restructure — sub-navigation, matching Admission/Fees (2026-08-27)

Not part of the original 12-phase plan — direct user feedback after Phases
0–12 landed: "the homework UI seems messy, there are still many things
hidden under UI." By that point `frontend/app/(app)/homework/page.tsx` had
grown to 1,303 lines carrying, all on one page: a School-Admin-only settings
card, a school-wide syllabus progress grid with its own chapter-drilldown
modal, a homework/syllabus tab switch, and four other modals — while the
actual grading page (`/homework/assigned`) was reachable only via a
dashboard stat-card link, in neither the sidebar nor any tab bar.

**What changed:** split into the module's real distinct jobs — the same
move already made for Fees (see that module's own `layout.tsx` comment: "four
pages that did not know about each other"). Mirrors the exact pattern
Admission and Fees already use: a `Sidebar.tsx` group with real routes as
children, plus a `layout.tsx` in the `/homework` segment rendering the same
tabs, permission-filtered, both explicitly kept in sync (same drift risk
both of those modules' own comments already warn about).

| Tab | Route | Gate | Content |
|---|---|---|---|
| Assign | `/homework` | `homework.view` | Class/section picker + the homework/classwork calendar (`HomeworkTab`) — what used to be the "Homework & Classwork" half of the old tab switch |
| Grading | `/homework/assigned` | `homework.create` | Unchanged page, now in real nav instead of only a dashboard link |
| Syllabus | `/homework/syllabus` | `syllabus.view` | The school-wide progress grid + chapter drilldown + the due-dates/progress-log calendar — what used to be the "Syllabus Progress" tab, now with the grid that used to sit above BOTH tabs moved here specifically |
| Settings | `/homework/settings` | `homework.create` (page itself further restricts editing to School Admin, with a clear message for anyone else who lands here) | The Phase 6/9 settings, moved off the Assign page onto their own route |

**Extracted along the way, not left duplicated:** `AddHomeworkModal` — used
by both the Assign page (its own day-rail "+"/edit actions) and the
Syllabus page's "Assign homework for this chapter" — moved to
`frontend/components/academics/AddHomeworkModal.tsx`, a genuine second
same-app consumer, unlike the staff-app/portal-app duplication elsewhere in
this module (see Phase 8) where no shared-package tooling exists to extract
into. Likewise `useClassPicker` (`frontend/lib/useClassPicker.ts`) — the
class/section-picker data logic (senior-management-vs-my-classes scoping)
both the Assign and Syllabus pages need — pulled into a shared hook rather
than copied twice.

**Verified live**, real browser, real data: all four tabs load correctly
from both the sidebar and the tab bar and stay in sync with each other;
Assign shows only its own picker+calendar with no more settings card or
syllabus grid bleeding onto it; Syllabus shows the full grid+drilldown
independently; Settings shows its own two-card page; the chapter→
"Assign homework" flow was re-tested end to end through the newly-extracted
shared modal and confirmed to still pre-fill correctly (including a
correctly-populated Subject dropdown, now that the `subjects` backfill
migration from earlier the same day has landed).

---

## Syllabus promoted to its own top-level module (2026-08-27, same day)

One more request right after the restructure above landed: pull Syllabus out
of Homework entirely, as its own item in the sidebar — not a tab under
Homework at all. Correct call, not just a preference — curriculum pacing
was never really a homework concern, it only shared a page (and, further
back, a single file) with homework because that's how the original build
happened to group them. Confirms something that was already true one layer
down: `frontend/app/(app)/hr/permissions/page.tsx`'s own `MODULE_LABELS`
map has listed `syllabus` as a distinct module from `homework` since before
this restructure — the permission system already treated them as separate;
the navigation just hadn't caught up.

**What changed:** moved `frontend/app/(app)/homework/syllabus/page.tsx` →
`frontend/app/(app)/syllabus/page.tsx` (content unchanged — no relative
imports, so a pure file move). `homework/layout.tsx`'s tab bar drops back
to 3 tabs (Assign/Grading/Settings). `Sidebar.tsx`'s `Homework` group loses
its `Syllabus` child; a new flat top-level `Syllabus` entry sits beside it
(single page, no children, same pattern as Complaints/Certificates —
doesn't need its own `layout.tsx` for just one route). `AddHomeworkModal`
and `useClassPicker`, both already living in shared locations from the
restructure above, needed zero changes — they were never homework-specific
in the first place, just consumed by pages that happened to be under
`/homework` at the time.

**Verified live**, real browser: `/syllabus` renders standalone in the
sidebar between Homework and Complaints, with the full progress grid intact;
`/homework` now shows exactly 3 tabs, no Syllabus among them, in both the
sidebar and the tab bar. No stray `/homework/syllabus` references left in
source (confirmed by grep — only historical comments describing the move,
plus stale `.next/` build-cache entries that regenerate on the next
compile).

## Syllabus split into Progress / Log Progress / Due Dates (2026-08-28)

The single-page Syllabus module (flat since the promotion above) had grown
to combine three different jobs on one screen: a school-wide overview grid,
a class+section picker with a free-text subject filter, a due-dates
calendar, and two modals ("Set Chapter Due Dates", "Log Today's Progress")
both launched from buttons above that calendar. Explicit ask: split into
three sub-sections — viewing progress (filtered by class → section →
subject), logging progress, and setting due dates — matching the tab-bar
pattern already used for Admission/Fees/Homework, and make sure class,
section and subject everywhere in the module come from the school's actual
Class & Section settings / master subjects list, not free text or anything
derived ad hoc.

**What changed:**
- `frontend/app/(app)/syllabus/layout.tsx` (new) — the same tab-bar-above-
  `{children}` pattern as `homework/layout.tsx`, gated per tab (`syllabus.view`
  / `syllabus.log_progress` / `syllabus.plan`).
- `Sidebar.tsx`'s flat `Syllabus` entry became an expandable group with
  three children (Progress, Log Progress, Due Dates) — same shape as the
  Homework group, kept in step with the layout's tabs for the same reason
  every other nav pair here warns about.
- `frontend/app/(app)/syllabus/page.tsx` (rewritten, "Progress") — kept the
  school-wide/your-classes overview grid (shown when no class is picked)
  and its click-to-drill chapter dialog, but added a proper Class → Section
  → Subject filter chain above it; picking a class swaps the grid for a
  filtered, read-only chapter list. Subject is now a dropdown sourced from
  `classesApi.subjects.list(classId)` (`GET /admission/subjects`, the same
  master list `AddChaptersModal` already pulled from) intersected with the
  teacher's timetabled subjects when not senior management — not the old
  free-text `<Input>` filter. The chapter-row rendering (status icon, due/
  completed date, overdue badge, homework summary, "assign homework"
  action) was factored into one `ChapterRow` component reused by both the
  drill-down dialog and the new filtered list, instead of the dialog having
  its own inline copy.
- `frontend/app/(app)/syllabus/log/page.tsx` (new, "Log Progress") — the old
  `LogProgressModal`'s form, now a real page: Class → Section → Subject
  filter (same master-subjects source), a log-entry form beside a "Recent
  entries" list for that class+subject with delete, instead of a modal
  behind a button with no way to see what was already logged without
  scrolling a calendar day by day.
- `frontend/app/(app)/syllabus/due-dates/page.tsx` (new, "Due Dates") — the
  old `AddChaptersModal`'s form, now a real page: Class → Section (with an
  "only this section" toggle, same as before) → Subject filter, an
  "existing chapters" list with delete next to the add-chapter-rows form,
  so planning and reviewing what's already planned are the same screen
  instead of an add-only modal.
- The due-dates calendar (`MonthCalendar`, "due this day" / "logged this
  day" day-rail) was dropped entirely — it mixed both due dates and log
  entries into one browse-by-day view, which is exactly the combined UX
  being split apart. Nothing it showed is lost: due dates now live in the
  Due Dates list, log entries in Log Progress's "Recent entries" list.

**Verified live**, real browser, `admin@dpslucknow.com`: all three tabs
render with correct sidebar/tab-bar highlighting and no console errors;
Progress's Class filter correctly narrows the overview grid into a chapter
list once a class is picked, and the Subject dropdown lists real school
subjects (Accountancy, Art, Biology, ...) instead of a text box; Log
Progress and Due Dates both resolve real data once Class 1 → Mathematics is
picked — Log Progress shows real prior entries (teacher "Kabir Gupta",
real chapter names, real dates) beside the log form, Due Dates shows the
existing chapter list (Number Systems, Polynomials, Linear Equations, ...)
beside the add-chapters form.

**Follow-up same day:** the Progress tab's overview grid still showed every
class in the school at once whenever no class was picked yet — pointed out
directly off a screenshot. That's the exact "all at once" problem the rest
of the split was fixing, just missed on this one card. Fixed by scoping
`SyllabusOverview` to the selected class(+section) instead of an unscoped
`syllabusApi.stats()` call: with no class picked, the page now shows an
EmptyState ("Select a class to get started") instead of a grid; once a
class is picked it makes one `syllabusApi.stats({class_id, section_id})`
call and shows a card per subject for that class alone; picking a subject
too swaps straight to the existing filtered chapter list. This also
deleted the multi-query `useQueries`/`uniquePairs` aggregation logic that
existed only to build the old "all classes" view — no longer needed.
Verified live: `/syllabus` with nothing picked shows the empty-state
prompt; picking Class 12 shows exactly Class 12's 12 subjects, not the
other 20+ classes' subjects that were showing before.

**Second follow-up same day:** the Section dropdown on all three tabs still
had an "All sections" entry (senior management) — the same "aggregate
across everything" escape hatch the two fixes above were removing, just
one level down (class was fixed, section wasn't). Removed the `value="all"`
sentinel entirely from Progress, Log Progress and Due Dates — the Section
`Select` now only lists real sections, and each page's content is now
gated behind an actual section being picked (`sections.length > 0 &&
!selectedSection` shows an EmptyState prompting for one) wherever the class
has sections at all, same as it already required a class. Classes with no
sections defined (`sections.length === 0`) are unaffected — there was
never a dropdown to pick from, so nothing to require. Due Dates' separate
"This section only" checkbox (apply the batch being added to just the
picked section vs. the whole class) is a distinct, deliberate write-time
choice and was left alone — only the view-scoping dropdown changed.
Verified live: Section's option list shows real names only (PCM / PCB /
Commerce / Humanities for Class 12, no "All sections" row); Progress shows
"Select a section" until one is picked, then resolves that section's real
subject cards; Due Dates shows the same gated prompt with all three filters
required before content renders.

## Backend/UI parity audit: "mark as submitted" on a student's behalf (2026-08-28)

Asked directly whether anything in the Homework module existed in the
backend but not the UI. Went through every route in this file's HOMEWORK
section against every call site in `frontend/` and `frontend-portal/`.
Everything else was already wired end to end (type/classwork, individual-
student targeting, attachments, chapter linking, edit/delete, settings,
roster, remind, grade, the portal's own submit). One real gap: `POST
/homework/:id/students/:studentId/submit` — staff recording a submission
on a student's behalf, e.g. "handed in on paper" per its own code comment
— was fully implemented server-side and even had a client method
(`homeworkApi.submitForStudent` in `frontend/lib/api.ts`), but nothing
called it. The only way to move a "Pending" student off that status was to
grade them directly, which works but skips ever recording that anything
was actually handed in — no `submitted_at`, no `is_late`, no
`submission_text`/file on record, and no distinct "submitted, not yet
graded" state.

**What changed:** `frontend/app/(app)/homework/assigned/page.tsx`'s
`GradeRow` — for a row still at `status === 'assigned'`, a "Mark as
submitted" button now sits above the always-present grade form. Clicking
it reveals a small inline note field (placeholder "e.g. Handed in on
paper") plus an optional file attach, mirroring `AddHomeworkModal`'s own
base64-file-read pattern; Confirm calls `homeworkApi.submitForStudent`,
disabled until there's a note or a file (same "at least one of
submission_text/file_base64" requirement the backend route itself
enforces). Grading directly from "Pending" without this step is still
possible — this adds the missing path, it doesn't replace the existing
one.

**Verified live**, real browser, `kabir.gupta@dpslucknow.com` (temporarily
reactivated for the test, deactivated again after — he's the only real
teacher account with real timetabled periods, same as every other
teacher-role check this module): created a real homework item as him for
Class 10-A, opened the Grading roster, clicked "Mark as submitted" on a
Pending student, entered a note, confirmed — the row correctly flipped to
a "Submitted" badge with "Submitted 28 Aug 2026" and the note text shown,
and the "Remind N unsubmitted" count dropped from 40 to 39. Test homework
item and Kabir's `is_active` flag both cleaned up afterward.

## Homework Assign: blank-section teacher scoping (2026-08-28)

Asked directly whether Assign (Homework) and Log Progress (Syllabus) only
show a Teacher their own subjects. Syllabus's pickers already require a
real section (see the "no All sections" fix above), so they were fine.
Homework's Assign page still lets Section sit unpicked — and doing that
broke two things at once, found live rather than by inspection alone:

1. **`useClassPicker`'s `myAllowedSubjects`** (`frontend/lib/useClassPicker.ts`)
   required an *exact* match against `selectedSection`. A teacher's own
   timetable rows always carry a real `section_id` (never null), so with
   Section blank nothing ever matched — producing an empty (but truthy)
   array. That empty array then did two bad things downstream: the "Assign
   for this day" modal's Subject dropdown came up empty with a false
   "You're not timetabled for any subject in this class/section," and
   `HomeworkTab`'s own data filter (`homework/page.tsx:224`,
   `allowedSubjects ? filter : rawData`) filtered out every homework item
   on the calendar too — not just new ones, existing ones the teacher had
   already assigned.
2. **`GET /academics/homework`'s section filter** (`academics/routes.ts:171`)
   used a plain `.eq('section_id', section_id)`, with no fallback for
   whole-class items (`section_id: null`, meant to apply to every section).
   The moment a section *was* picked, every whole-class assignment for
   that class vanished from the results — inconsistent with `GET
   /syllabus` and `/syllabus/stats` in this same file, which both already
   use `.or('section_id.eq.X,section_id.is.null')` for exactly this reason.

**Fixes:** `useClassPicker` now unions subjects across every section the
teacher teaches in the class when `selectedSection` is empty, falling back
to an exact match only once a section is actually picked. `GET
/academics/homework`'s section filter now uses the same
`.or('section_id.eq.X,section_id.is.null')` pattern its sibling endpoints
already used.

**Verified live**, `kabir.gupta@dpslucknow.com` (Mathematics only,
temporarily reactivated, deactivated again after): before the fix, a real
whole-class Mathematics homework item due today was invisible on the
calendar with Section left blank, and invisible again via the API once
`section_id` for either 10-A or 10-B was passed explicitly. After the fix:
visible via the API in all three cases (no section filter, 10-A, 10-B),
and live in the browser — "Due this day" correctly shows the item with
Section blank, and the Assign modal's Subject dropdown correctly shows
"Mathematics" instead of the false not-timetabled warning. Test item
deleted, Kabir's account deactivated again afterward.

## Grading tab 403'd for anyone not literally role='teacher' (2026-08-28)

User assigned real homework as School Admin (visible on the Assign
calendar), then opened Grading and got "You haven't assigned any homework
yet" — asked directly why. Root cause: `GET /teacher/homework-overview`
(`backend/src/modules/teacher/routes.ts:439`, the Grading tab's only data
source) was gated `requireRole('teacher')` — a hard `users.role` check,
not the `homework.create` permission every other Homework endpoint uses.
School Admin's base role is `school_admin`, so the request 403'd.
`frontend/app/(app)/homework/assigned/page.tsx:48-52` never checked for a
query error (`const groups = data ?? []`), so the 403 silently rendered as
"0 groups" — the identical empty state to genuinely never having assigned
anything. Since Grading is the only UI surface with the roster/grade
controls, this meant a School Admin (or Principal/VP — anyone whose role
isn't literally 'teacher') who assigned homework had no way to grade it
at all, even though the grade endpoint itself is `homework.create`-gated
and would have worked.

**Fix:** `GET /teacher/homework-overview`'s gate changed from
`requireRole('teacher')` to `requirePermissionV2('homework.create')` — the
`created_by = req.user!.id` scoping already in the query is what keeps
this personal to the caller, not the role check, so this only adds access
for other `homework.create` holders and changes nothing for a real
teacher. Also added an explicit error branch to the Grading page
(distinct EmptyState, "Couldn't load your assigned homework") so a future
failed request can't masquerade as "nothing assigned" again the same way.

**Verified live**: `GET /teacher/homework-overview` with the School Admin
token went from `403 "Access denied. Required roles: teacher"` to `200`
with the real 2 groups / 3 items; in the browser, Grading now shows "3
items across 2 sections" — Class 3's Chemistry/Computer chapters and Class
5-A's Economics chapter, all real, with correct submitted/graded/pending
counts matching what was actually assigned on the Assign tab.

## Due Dates: import chapter names from Excel (2026-08-28)

Asked for a way to bulk-fill chapter names on the Due Dates page from an
.xlsx a school already has, instead of typing each one by hand.

**Backend:** `POST /academics/syllabus/import-chapters` (`syllabus.plan`-
gated) — decodes a base64 upload and reads it with the dependency-free
XLSX reader `backend/src/modules/timetable/import/xlsx.ts` already built
for the timetable importer (`readWorkbook`), rather than adding a parsing
library for a shape this much simpler. Row 1 is always treated as a
header and skipped; column A is the chapter name, everything else on the
row is ignored — due dates stay a manual per-row choice, this endpoint
only ever returns names. Nothing is written; the response just fills in
the same "Add chapters" rows a teacher would otherwise type into.

**Frontend:** `syllabusApi.importChapters` (`frontend/lib/api.ts`) +
an "Import from Excel" button on `AddChaptersForm`
(`frontend/app/(app)/syllabus/due-dates/page.tsx`) — reads the file as
base64 client-side (same chunked pattern `timetable/import/page.tsx`
already uses), posts it, and either replaces the form's single pristine
empty row or appends to whatever's already there.

**Verified**: built two real `.xlsx` fixtures with the exact zip/XML
writer the timetable import test suite already uses for its own
fixtures (`backend/src/modules/timetable/import/import.test.ts`'s
`makeWorkbook`) — 10 real CBSE Class 10 English chapters and 10 Class 2
Computer chapters, each with a header row and a due-date column (ignored
by design). Parsed both in an isolated one-off script first (not the live
server) to confirm the reader handled them correctly before ever hitting
a live request — both read back exactly the 10 expected names, in order,
fast. Live in the browser: importing the Class 2 Computer file populated
all 10 rows on Due Dates correctly, confirmed by the user's own
screenshot after saving.

**Note on an incident during this work:** the backend dev server hung
completely partway through live-testing this feature — every request
through `authenticate` or touching Supabase stopped responding, while
bare unmatched routes (a 404) kept resolving instantly, meaning the event
loop itself wasn't frozen. Re-parsing the same test file afterward in
isolation came back clean and fast, clearing the new xlsx code of being
the direct cause — more likely cumulative connection exhaustion from this
session's unusually heavy request volume (dozens of logins, repeated
psql sessions) than a bug introduced here. Flagged to the user rather than
guessed at; they restarted the server and it hasn't recurred since.

## Due Dates: existing chapters had no way to edit a due date (2026-08-28)

Immediate follow-up, spotted directly off the Excel-import result: a
chapter imported by name alone shows "No due date" with no way to add one
afterward — "Existing chapters" only ever had a delete action. The write
path already existed and was unused for this: `PATCH
/academics/syllabus/:id` (`backend/src/modules/academics/routes.ts:884`)
already accepts `exam_id` or `planned_date`, gated on `syllabus.plan` for
exactly these plan fields (a separate `syllabus.log_progress` gate covers
`status`/`actual_completion_date` on the same route) — it just had no
frontend caller for the plan-field case, only for log fields.

**Fix:** `ExistingChapterRow` (`frontend/app/(app)/syllabus/due-dates/page.tsx`)
replaces each existing-chapter row's static display with an edit affordance
— a pencil icon reveals the identical exam-or-custom-date `Select` +
conditional date `Input` the "Add chapters" form already uses, Save calls
`syllabusApi.update(id, { exam_id | planned_date })`.

**Verified live**: edited "Parts of a Computer" (a chapter that came in via
the Excel import above, "No due date") to a custom date of 2026-09-10,
saved, then confirmed via a direct API read — `planned_date` and the
computed `due_date` both correctly show `2026-09-10`, `exam_id` stayed
`null`.

## Organizational Settings: Syllabus Setup — import, type, or upload, per class/section/subject (2026-08-28)

Every existing entry point into the syllabus (Due Dates, Progress, Log
Progress) assumes a chapter list already exists for the class/section/subject
being looked at. There was no dedicated place for a school to define that
list in the first place, class by class, at the start of a term — only the
Due Dates page's "Add chapters" panel, buried behind Syllabus's own
navigation rather than Organizational Settings where the rest of the
school's structural setup (Classes & Sections, Class Teachers, Academic
Calendar) lives.

**New page**: `frontend/app/(app)/settings/syllabus/page.tsx` ("Syllabus
Setup"), gated to School Admin/Principal, added to the sidebar's
Organizational Settings group (`frontend/components/layout/Sidebar.tsx`).
Same Class → Section → Subject sourcing as every other syllabus screen —
`useClassPicker(true)` for class/section (school's real Class & Section
settings), `classesApi.subjects.list(class_id)` for subject (school's master
subject list) — never free text.

All three requested input methods, two of them by extracting rather than
duplicating:

- **Extracted `AddChaptersForm`** out of `due-dates/page.tsx` into
  `frontend/components/academics/AddChaptersForm.tsx` — a genuine 2nd
  consumer (Due Dates' day-to-day planning vs. Settings' initial bulk setup),
  same reasoning as `AddHomeworkModal`/`useClassPicker` earlier this session.
  It already covers **import** (Excel, via the existing `POST
  /academics/syllabus/import-chapters`) and **type it in** (per-row manual
  entry) — no new backend needed for either.
- **New third method, upload**: a raw reference document (a CBSE-issued PDF,
  a scan of last year's plan) kept as-is against the class/section/subject,
  not parsed into chapters — distinct from the Excel import. New table
  `syllabus_documents` (migration `20260830300000_syllabus_documents.sql`,
  same shape as `student_documents`: school/class/section/subject, document
  name, file_url/file_size/mime_type, uploaded_by) plus a public
  `syllabus-documents` storage bucket. New routes in
  `backend/src/modules/academics/routes.ts`: `GET/POST
  /academics/syllabus/documents`, `DELETE /academics/syllabus/documents/:id`,
  using the same "section is null OR matches" scoping as `GET /syllabus`.
  New `SyllabusDocumentsPanel` component (inline in the new page) handles the
  upload UI and the list of already-uploaded documents with view/download/
  delete, mirroring `students/[id]/documents/page.tsx`'s upload pattern.
