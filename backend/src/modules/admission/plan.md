# Admission Engine — Phase-Wise Execution Plan (Revised, Code-Verified)

> This revises the plan you drafted from the chat summary alone. Every "⚠ Verify
> before building" note in that draft has now been checked directly against
> `backend/src/modules/admission/routes.ts`, the live schema in `supabase/migrations/`,
> `backend/src/modules/rbac/*`, and `frontend/components/admission/PipelineCharts.tsx`.
> Where the draft's assumption held, it's kept with a **Verified** tag and no further
> hedging. Where reality differs, the phase is corrected and the difference is called
> out explicitly, not silently smoothed over.
>
> This document does **not** cover ground already shipped. `admission-history.md`
> (same folder) is the record of Phase 0–2: inquiry pipeline, documents,
> admission-internal fee, offer letters, live seat calculation, admission cycles, and
> slot scheduling — all built and verified against the live database. This plan is the
> next layer on top of that baseline, not a restart.
>
> (That file used to be named `PLAN.md`. It was renamed after an earlier version of
> this document was accidentally written to `plan.md` in the same directory — on this
> Windows filesystem, `PLAN.md` and `plan.md` resolve to the same file, so the write
> silently overwrote it instead of creating a second file. Reconstructed from
> conversation history since it was never committed to git. Flagging this here so the
> case-collision risk stays visible to whoever edits either file next.)

## Guiding principles (unchanged, confirmed still correct)

1. **Settings, not hardcoded rules.** Anywhere a school could reasonably want a
   different answer — a hold duration, a checklist, who can override what — this plan
   defines a setting with a safe default, owned by the named role, not a hardcoded
   constant.
2. **Extend, don't duplicate.** No phase introduces a parallel system next to something
   that already exists. Every phase's job is to extend, wire up, or govern what's
   already there — confirmed achievable for every phase below except the two flagged
   as genuinely net-new (Notifications, Marks Entry/Auto-Evaluation).

---

## Baseline (now code-verified, not just described)

| Module | Verified reality | Where |
|---|---|---|
| Inquiry & pipeline | Source tracking, counselor assignment, conversion to application, status pipeline incl. `waitlisted` | `admission_inquiries` table, `POST /inquiries/:id/convert-to-application` |
| Documents | Upload/list/verify/delete per application | `POST /applications/:id/documents` et al. |
| Approval workflow | Generic, cross-module engine (`shared/middleware/workflow-engine.ts`) — **also used by TC approvals, HR exits, comp-off, and leave requests**, not admission-only | `startWorkflow`/`actOnWorkflow`/`getWorkflowStatus` |
| Admission-internal fee | 4 plain columns on `admission_applications` (`fee_paid_at`, `fee_payment_method`, `fee_payment_reference`, `fee_collected_by`) — **not a separate audit subsystem, just tracked columns** | `POST /applications/:id/collect-fee` |
| Offer letter | Numbered on issue, gated on `admitted` status, HTML+print (no PDF library exists anywhere in this codebase) | `documents/routes.ts` |
| Seats & capacity | **Pure live computation, no stored state**: `getClassSeatAvailability()` runs three queries every call — `sum(sections.max_strength)`, count of active students, count of `admission_applications` not in `('admitted','rejected')` | `admission/routes.ts` |
| Admission cycles | Per-school, per-`academic_year_id` open/close window, one row (or none = always open) | `admission_cycles` table |
| Slots | One table (`admission_slots`) with a fixed `slot_type` CHECK enum (`entrance_exam` \| `interview` \| `campus_tour`), plus `admission_slot_bookings` with a free-text `result` column | `admission_slots`, `admission_slot_bookings` |
| Roles | **Dual model** — see Phase 10, this matters for several other phases too | `users.role` (8-value CHECK enum) + RBAC v2 (`roles`/`role_permissions_v2`/`user_roles`, school-scoped, dynamically insertable) |
| Dead weight | Legacy `admission_applications.status` values confirmed dead, left alone | schema-level |

**Corrected root-gap framing:** the draft was right that seat capacity is a live
calculation, not a governed ledger — but it's not "in-flight" via some query over
statuses that merely needs repointing; there is **zero stored seat state today**.
Phase 1 is a real schema migration plus a read-path rewrite across three call sites,
not a light refactor.

---

## Phase 1 — Seat Ledger Engine (EXTEND the existing capacity calculation) — ✅ shipped 2026-08-20

Migration `20260830070000_admission_seat_ledger.sql` applied to the live database;
backfill matched the old live calculation exactly for all 24 existing classes
(verified by comparing `GET /admission-seats` output before and after — identical
capacity/enrolled/reserved numbers, just relabeled `confirmed`/`frozen` added at 0).
`getClassSeatAvailability()` now reads the ledger; a new `applyLedgerTransition()`
helper handles `reserve` (on `POST /applications`), `confirm` and `release` (both
workflow-completion sites). `PATCH /admission-seats/:classId` lets School Admin /
Principal adjust `capacity`/`frozen` with an optional reason — verified live: a freeze
correctly dropped `available`, a real application creation correctly incremented
`reserved`. Frontend Seats page updated to show Capacity/Confirmed/Reserved/Frozen and
a per-class adjust dialog.

**Scope narrowed from the original phrasing, deliberately:** keyed on
`(school_id, class_id)` only, not `(academic_year_id, class_id)` — verified that
`sections`/`classes` aren't year-scoped anywhere in this codebase today, so
introducing year-scoping to capacity would be a bigger change than "evolve the
existing calculation" implies. Matches current behavior exactly; revisit if sections
ever become year-scoped. See `decisions.md`.

**What changed:** `getClassSeatAvailability()` (admission/routes.ts) and its
three call sites — `GET /admission-seats`, the `POST /applications` capacity check, and
nothing else touches it yet — are replaced by reads against a new stored ledger table,
one row per `(academic_year_id, class_id[, section_id])`, with explicit states:
`available`, `reserved`, `confirmed`, `frozen`.

No "campus" layer here — **verified: this codebase has no campus/multi-campus concept
anywhere**, in schema or code. `school_id` is the only tenancy boundary. If the school
is genuinely multi-campus, that's a bigger, separate decision (see `decisions.md`) —
this phase does not assume it.

**Verified, not hypothesis:**
- The current calculation has no persisted counters — confirmed by reading the function
  directly. This is a genuine migration, not a read-path swap.
- `classes` and `sections` are core, shared entities (also used by SIS, Fee, Timetable,
  Exam) — the ledger keys off their existing IDs, it does not introduce admission-scoped
  duplicates of either.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Who may update/degrade seat count | School Admin config | School Admin + Principal, independently |
| Whether degrade requires a reason | School Admin config | On |
| Buffer/frozen seats per class | Principal | 0 |

**Concurrency rule (hard default):** last-write-wins, with a visible "last changed by X
at Y" indicator on the existing `/admission/seats` page.

**Done when:** `/admission/seats` and the `POST /applications` capacity check both read
from the ledger, and `getClassSeatAvailability()`'s live-computation body is deleted,
not left dead alongside it.

---

## Phase 2 — Academic Year & Locking Governance — ✅ shipped 2026-08-20

**Extension point corrected during implementation:** the plan as drafted said to
extend `admission_cycles`, but that table is one row per `(school, academic_year)` —
locking is per-*class*. The actual natural extension point was the seat ledger Phase 1
already built (already per-`(school, class)`), so lock state (`is_locked`, `locked_at`,
`locked_by`, `lock_reason`) was added there instead — "extend, don't duplicate"
applied a second time rather than building a new table or bolting class-awareness onto
`admission_cycles`. Migration: `20260830080000_admission_class_locking.sql`.

`checkClassLockOpen()` (mirrors `checkAdmissionCycleOpen()`'s shape exactly) gates
`POST /applications` alongside the existing cycle and seat-capacity checks. Locking is
independent of the cycle-wide open/close window — a school can be mid-cycle and still
lock one specific class without closing admission entirely.

**Role gating, per the adopted blocking decision:** lock/unlock is restricted to
`school_admin` specifically (not `principal`, who keeps capacity/frozen access) —
"Director-only unlock" mapped onto the closest existing base role, with lock and
unlock treated the same rather than split further. `PATCH /admission-seats/:classId`
(the same endpoint Phase 1 added) now also accepts `locked: boolean`, checked and
403'd server-side if the caller isn't School Admin, regardless of what the frontend
shows.

**Verified live:** locked Class 4, confirmed a new application against it was
rejected with the configured reason surfaced in the error message, unlocked it,
confirmed clean state restored — no lingering test data (the blocked attempt never
wrote a row).

**Deferred within this phase, matching its own "off by default" setting:**
section-plan pre-declaration before lock — no consumer of it exists yet, so no UI or
schema was built for a setting that defaults to off and nothing reads.

**Original phrasing, superseded:**

**Verified:** `classes` and `sections` already exist as first-class entities referenced
by `applying_for_class_id` / `class_id` throughout the admission tables — this phase
references them, it does not create admission-specific duplicates.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Lock granularity | School Admin | Per class, within cycle |
| Who can unlock a locked class (exception path) | Director-only | Director *(see Phase 10 — "Director" does not exist as a role yet, in either role model)* |
| Section-plan pre-declaration before lock | School Admin | Optional, off by default |

**Done when:** a class can be locked independently of others in the same cycle, using
`admission_cycles` as the parent — no parallel "academic year" concept introduced.

---

## Phase 3 — Fee Seat-Hold Clock — ✅ shipped 2026-08-20

Migration `20260830090000_admission_fee_hold.sql`: `admission_fee_hold_days` (default
7) and `admission_fee_hold_grace_days` (default 0) added to `schools`, matching the
established convention for per-school settings (typed columns, not a settings table).
`fee_hold_deadline`/`fee_hold_extended_at`/`fee_hold_extended_by`/
`fee_hold_extension_reason`/`auto_rejected_reason` added to `admission_applications`.

**Extension point discovered mid-build, and reused a second time:** this phase needed
a background sweep. Rather than building new scheduling infrastructure, found and
followed the existing convention exactly — this codebase already runs eleven `node-cron`
jobs in `index.ts`, each a thin wrapper around a `run*()` function in
`shared/utils/*.ts`, each with a matching admin-triggered manual endpoint for hosts
where a long-lived cron isn't guaranteed to fire. `releaseExpiredSeatHolds()` follows
that shape precisely, registered as a new hourly job alongside the others.

**Refactor performed to enable this:** `getClassSeatAvailability`,
`applyLedgerTransition`, and `checkClassLockOpen` (Phases 1-2) moved from
`admission/routes.ts` into a new `shared/utils/admissionSeatLedger.ts`, so the cron
sweep could reuse them without a routes-file-importing-a-routes-file dependency.
`admission/routes.ts` now imports them instead of defining them — no behavior change,
pure relocation.

New endpoints: `POST /applications/:id/extend-fee-hold` (School Admin/Principal —
"Admission Officer" isn't a real base role yet per the Phase 10 blocking decision, so
scoped to what exists today) and `POST /applications/expire-fee-holds` (manual trigger,
same school-scoped convention as `POST /notifications/run-fee-reminders`).

**One implementation decision made, not left open:** on expiry, the application is
auto-rejected (`status: 'rejected'`, `auto_rejected_reason` set) and its seat released
— not moved to waitlist. Reasoning: "seat released" inherently means someone else can
claim it, which is what rejection means everywhere else in this pipeline; waitlisting
an unresponsive applicant by default felt like inventing a policy stance the plan
never asked for. Recorded in `decisions.md` as adopted-but-reconsiderable, not silently
assumed.

**Verified live, full cycle:** created a real application (reserved 2→3), extended its
hold by 3 days (deadline moved correctly), backdated the deadline directly in the
database to simulate expiry, ran the manual sweep trigger — reserved dropped 3→2,
available rose 1→2, the application flipped to `rejected` with the reason recorded,
`fee_hold_deadline` cleared. No cron wait needed to prove the mechanism; the sweep
function itself was exercised for real, only its trigger was manual.

**Original phrasing:**

**Verified:** no existing timeout/expiry logic exists on `admission_applications` or
anywhere else in the module — confirmed by reading the full route file. No conflict.

**Correction on "reusing the audit trail pattern":** there is no separate audit-trail
*system* to reuse — `fee_paid_at`/`fee_payment_method`/`fee_payment_reference`/
`fee_collected_by` are just plain columns. "Reuse the pattern" here means: add
similarly-named plain columns for the hold's deadline/resolution, in the same
convention, not integrate with infrastructure that doesn't exist. See Phase 7 for the
same correction applied more broadly.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Hold duration (days) | School Admin | 7 days |
| Reminder cadence before expiry | School Admin | Day 3, Day 6 (depends on Phase 8) |
| Grace period after deadline | Principal | 0 |
| Manual override to extend a hold | Principal/Admission Officer | Allowed, logged |

**Done when:** an unpaid reserved seat auto-releases, tracked via plain columns
matching the existing convention, without a new fee system.

---

## Phase 4 — Waitlist Auto-Promotion — ✅ shipped 2026-08-20

Migration `20260830100000_admission_waitlist_promotion.sql`: `admission_waitlist_response_days`
(default 3) on `schools`, `waitlist_offer_made_at`/`waitlist_offer_deadline` on
`admission_inquiries`.

**Rank UI, the blocking gap the draft flagged, closed first:** the Status-Change modal
(`admission/[id]/page.tsx`) now shows an inline rank input when "Waitlisted" is
selected — clicking it reveals a numeric field before confirming, rather than
submitting immediately like every other stage. Existing rows stay unranked until
someone re-visits them; new ones can be ranked at the moment they're waitlisted.

**"Auto-notify" adapted to reality, not built as literally specified:** Phase 8
(real WhatsApp/SMS/email) is still blocked on a provider choice. "Notify" here means:
the next-ranked candidate is automatically selected and a response clock starts
(`waitlist_offer_made_at`/`deadline`), visible on the inquiry detail page as an amber
callout — staff follow up by phone/WhatsApp by hand, logged the same way any other
follow-up is, not an automated send. Nothing here auto-admits anyone, matching "not
auto-confirm" from the settings table.

**Trigger point, resolved by hooking one shared function instead of every call site:**
`tryPromoteWaitlist()` is called from inside `applyLedgerTransition()` itself whenever
`action === 'release'` — so it fires automatically whether the release came from
Phase 3's fee-hold expiry, a normal workflow rejection, or any future release path,
without needing to remember to wire it in separately each time.

**Two new cron sweeps**, following the same `node-cron` + manual-trigger convention
Phase 3 established: `processExpiredWaitlistOffers()` (hourly, offset 15 minutes from
the fee-hold sweep) clears unanswered offers past their deadline and re-offers the
freed slot to the next rank; `POST /inquiries/process-waitlist-offers` is the
school-scoped manual equivalent.

**Manual fallback:** deliberately did not build a separate "promote now" button — the
existing `PATCH /inquiries/:id` status change already lets staff move a waitlisted
inquiry forward manually at any time, which is the fallback `plan.md`'s "Done when"
asked for; building a second mechanism for the same thing would have duplicated it.

**Verified live, full cycle:** created a waitlisted inquiry with rank 1 for a class,
created and then released (via backdated fee-hold expiry) a reservation in that same
class, confirmed the waitlisted inquiry was automatically offered the seat
(`waitlist_offer_made_at` set, 3-day deadline). Backdated that offer's own deadline and
ran the offer-expiry sweep — confirmed it cleared and correctly re-offered to the next
rank (which, with only one candidate waitlisted, was the same person again, with a
fresh deadline — correct behavior, not a bug).

**Original phrasing:**

**Correction, important:** `waitlist_rank` exists on `admission_inquiries` and is
settable through `PATCH /inquiries/:id` — **but there is currently no UI control that
sets it.** It shipped as an API-level field with no corresponding input on the
Status-Change modal or anywhere else. Today, every inquiry's `waitlist_rank` is `null`.
This isn't "gaps in an otherwise-populated field" — it's **entirely unpopulated**, for
every row, always. Auto-promotion cannot go live against this field as-is.

**Added scope this phase must include, not optional:** a UI control (in the existing
Status-Change modal or the inquiry detail page) for a counselor to set/reorder rank
when moving an inquiry to `waitlisted`. Without this, Phase 4's "lookup against the
existing rank field" has nothing to look up.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Promotion mode | Principal | Auto-notify + response deadline, not auto-confirm |
| Response deadline for offer | School Admin | 3 days, then next rank |
| Tie-break rule | Principal | Enquiry date (earlier wins) — needed *especially* now, since rank will start out unset for existing waitlisted rows when this ships |

**Done when:** rank is actually settable in the UI, AND a freed seat automatically
notifies the next-ranked candidate off that (now real) data, with the manual promotion
action still available as fallback.

---

## Phase 5 — Document Completeness Gate — ✅ shipped 2026-08-20

Migration `20260830110000_admission_document_requirements.sql`: new
`admission_document_requirements` table (school_id, class_id, document_type), plus
override-trail columns on `admission_applications`. Keyed on `(school, class)`, not
literally `(board, class)` as drafted — verified `schools.affiliation_board` is one
value per school, so "per board" was redundant within a single school's own checklist.

**Built exactly where the correction said to, not where the original draft implied:**
`checkDocumentCompleteness()` and `enforceDocumentCompleteness()` (which layers the
Principal-only override on top) live in `admission/routes.ts`, called via `??` right
alongside the existing `checkAdmissionSection()` at both final-approval-step sites.
`shared/middleware/workflow-engine.ts` — used by TC approvals, HR exits, comp-off, and
leave requests — was not touched.

**New settings page** `/admission/document-requirements` (School Admin only, 6th tab
alongside Pipeline/Applications/Seats/Cycles/Slots) — per-class checklist as toggle
buttons over the same document-type vocabulary the upload modal already uses, so a
school can only ever require a type that's actually uploadable.

**Override control**, Principal-only per `decisions.md`: a checkbox + required-reason
textarea on `WorkflowPipeline`'s final-step approve action, sent as
`override_document_gap`/`override_reason`. Enforced server-side regardless of what the
UI shows — verified a School Admin's override attempt (with a valid section AND the
override flags set) was still correctly rejected with the missing-document error, not
silently accepted.

**Verified live, the full gate cycle:** configured `birth_certificate` as required for
a class, drove a real application through all three workflow steps as School Admin,
confirmed the final approval was blocked with the exact missing document named,
uploaded and verified that document, retried the identical approval call — it
succeeded, created the student record, assigned the correct section. Separately
confirmed School Admin cannot invoke the Principal-only override even with every other
field correct.

**Correction, architecturally important:** the draft assumed "the existing approval
engine's step-validation logic (the same mechanism that already enforces 'section
required at admit')" is one thing to extend. It is not. Verified in
`admission/routes.ts`:

- `checkAdmissionSection()` is an **admission-module-level function**, called
  explicitly from the approval routes *before* `actOnWorkflow()` runs.
- `shared/middleware/workflow-engine.ts` — the actual generic engine — **knows nothing
  about sections, documents, or any admission-specific concept.** It is shared
  verbatim by TC approvals, HR exits, comp-off requests, and leave requests.

**What this means for Phase 5:** document-completeness must be a new
`checkDocumentCompleteness()`-style pre-check living in `admission/routes.ts`,
called the same way `checkAdmissionSection()` is — **not** a change to
`workflow-engine.ts`. Modifying the shared engine to know about "document checklists"
would leak an admission-specific concept into TC/HR/leave workflows that have no
business knowing about it. The pattern is right; the location the draft implied it
lives in was wrong.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Mandatory document checklist | School Admin, per (board, class) | Empty until configured, no blocking on unconfigured classes |
| Who can verify a document | School Admin | Admission Officer + Principal (matches existing verify capability) |
| Override authority (admit despite gaps) | Principal-only | Requires reason, logged |

**Done when:** the final-admit step is blocked on an incomplete checklist via a new
admission-module pre-check mirroring `checkAdmissionSection()` exactly — confirmed by
diffing the two functions' shape, not just by both existing.

---

## Phase 6a — Entrance Mode per Class — ✅ shipped 2026-08-20

Migration `20260830120000_admission_class_settings.sql`: new `admission_class_settings`
table (school_id, class_id, entrance_mode — interview/written_mcq/written_subjective/
observation, default `interview`). Took the recommended option (b) below — a genuinely
new small table, not a column on `admission_slots` (fixed CHECK enum, no metadata
field to extend) and not bundled onto `admission_seat_ledger` (a semantic stretch —
that table is capacity/reservation state, not assessment config). Named generically
(`admission_class_settings`, not `admission_entrance_mode`) so future per-class
settings have a home to extend into rather than triggering a fourth new table each
time.

`GET/PATCH /class-settings` (School Admin/Principal to write, `admission.view` to
read). Frontend: a collapsible "Entrance Mode by Class" card on the Slots page, plus —
filling a gap left over from Phase 2's original Slots build, where the New Slot form
never actually let you pick a class even though the backend schema always supported
it — a class selector on New Slot that surfaces the chosen class's configured mode as
an informational hint when creating an entrance-exam slot.

**Verified live:** confirmed every class defaults to `interview` with no row present,
set Class 11 to `written_mcq` via the API, confirmed it persisted and reflected back
correctly on a fresh list call.

**Deferred, per the plan's own scope-narrowing:** 6b (marks entry + auto-evaluation)
and 6c (result publishing via the shared workflow engine) — see below, not started.

---

## Phase 6 — Entrance Class-Wise Categorization + Result Publishing (EXTEND the existing slot entity — partially)

**Correction on "mode":** `admission_slots.slot_type` is a fixed 3-value CHECK enum
with no free-form metadata column. There are two ways to add a per-class `mode`
(interview / written MCQ / written subjective / observation):
(a) a new column on `admission_slots` itself, or
(b) a per-class admission setting that slots simply reference.

**Recommendation:** (b). "Mode" is a property of *the class's admission process*, not
of an individual slot instance — it belongs alongside the other per-class settings this
plan already introduces in Phase 5 (mandatory documents) and the original plan's Phase
3 concept (is a test required, is a fee required). Bundling it there keeps one
"admission settings per class" surface instead of scattering class-level config across
tables. Either way this is an **additive** migration — the existing `slot_type` enum
and capacity-enforcement logic are untouched.

**Correction, scope-sizing:** "Marks entry and auto-evaluation" is **not** a light
extension. `admission_slot_bookings.result` is a single free-text column today — there
is no structured marks storage, no MCQ answer model, no scoring logic anywhere in this
codebase. This is a genuinely new subsystem nested inside Phase 6, sized closer to a
phase of its own than a bullet point. Recommend splitting it out as **Phase 6b** so it
can be sequenced (and estimated) independently of the class-mode/categorization work in
6a.

**Verified, holds as drafted:** result publishing (Examiner → Review → Principal
Approval → Publish) genuinely can reuse the shared workflow engine — confirmed the same
`startWorkflow({ workflowName, entityType, entityId, ... })` call this session used for
"Admission Approval Workflow" generalizes cleanly to a new `entityType:
'admission_slot_booking'` (or similar) workflow definition, following the exact
`ensureAdmissionApprovalWorkflowDefinition()` pattern already in `rbac/seed.ts`.

---

### Phase 6b, scoped 2026-08-20 — split into two pieces of very different size

Researched the existing **Examinations module** (`backend/src/modules/exam/routes.ts`)
before designing anything new — "extend, don't duplicate" applied one more time. What's
there, precisely:

- `student_marks` (school_id, exam_id, exam_subject_id, student_id, `marks_obtained
  numeric`, `is_absent`, `grade`, `remarks`, `entered_by`) — **entirely manual entry**.
  A teacher types a number per student in a grid; `computeGrade()` is a hardcoded
  percentage→letter-grade bucket, not evaluation of correctness.
- `MarksEntry` (`frontend/app/(app)/exams/[id]/page.tsx`, ~L600-752): Class → Subject
  select, then a table (Roll No / Student / Marks input / Absent checkbox), saved in
  bulk. This is exactly the UI pattern to model an admission equivalent after.
- **Confirmed, explicitly, not just assumed**: no `question`/`questions` table, no
  options/choices structure, no `correct_answer` column, no auto-grading logic
  *anywhere* in this codebase — not in the exam module, not anywhere else. "Auto-
  evaluation" as a concept is entirely unbuilt. `entrance_mode`'s `written_mcq` value
  (Phase 6a) is only ever a *label* on a slot's mode — it stores no question content
  and computes nothing.

**This means "marks entry" and "auto-evaluation" are not one feature at two settings —
they're two features of very different size, and `plan.md`'s own settings table
(below) already lists them as separate rows. Splitting accordingly:**

**Phase 6b-i — Marks entry — ✅ shipped 2026-08-20:**
Reuses `admission_slot_bookings` as the existing "candidate × entrance-event" join
row — exactly analogous to `student_marks` being "student × exam_subject" — rather
than a new table. Add `marks_obtained numeric`, `max_marks numeric`, `is_pass boolean`
alongside the existing free-text `result` column (kept for interview/observation
notes, which aren't numeric). Frontend: extend the existing `BookingsModal` on the
Slots page with marks inputs, shown only when the booking's class has
`entrance_mode` = `written_mcq` or `written_subjective` (Phase 6a) — same grid-row-per-
candidate shape as `MarksEntry`, scaled down to however many are in one slot's
bookings rather than a whole class.

Built exactly as scoped, migration `20260830130000_admission_marks_entry.sql`:
`marks_obtained`/`max_marks`/`is_pass` on `admission_slot_bookings`;
`pass_marks_percent` (default 40) added to `admission_class_settings` — reusing that
table a second time, exactly the "future per-class settings have a home to extend
into" case its own comment anticipated. `PATCH /admission-slot-bookings/:id` computes
`is_pass` server-side from whichever of `marks_obtained`/`max_marks` is being updated
merged against whatever's already stored, against the booking's class's configured
threshold — a plain percentage-vs-threshold comparison, same spirit as the exam
module's `computeGrade()` bucket, not evaluation of an answer, so it stays inside
"marks entry" rather than crossing into 6b-ii. Frontend: marks inputs + a Pass/Fail
badge added to the existing `BookingsModal` on the Slots page; the Entrance-Mode card
also gained an inline pass-percent editor next to each written-mode class.

**Verified live:** set Class 11 to a 50% pass threshold, entered 30/60 (exactly 50%) →
correctly marked Pass; updated to 20/60 (33%) → correctly flipped to Fail. Confirmed
the partial-update path too — sending only a new `marks_obtained` correctly recomputed
against the previously-stored `max_marks` rather than requiring both fields every time.

**Phase 6c — Result Publishing — ✅ shipped 2026-08-20:**

Migration `20260830140000_admission_result_publishing.sql`: `result_published`/
`result_published_at` on `admission_slot_bookings`, mirroring how
`admission_applications.status` flips to `admitted` on that workflow's completion —
a denormalized convenience flag, not a new source of truth.

**Deviated from the plan's literal role-name default, deliberately, and for a real
reason found while building:** `ensureMultiStepWorkflow` (`rbac/seed.ts`) **silently
no-ops** if any named step role isn't seeded for the school — confirmed by reading it,
and confirmed this is the exact class of bug the codebase's own comments say already
bit the Transfer Certificate workflow once. "Examiner" and "Exam Coordinator" aren't
seeded anywhere — creating them is real Phase 10 (RBAC Finalization) work, not 6c's.
Used `ensureEntranceResultWorkflowDefinition()` with **Counselor → Principal**
instead — both guaranteed-seeded roles, Counselor being this app's existing primary
admission-process actor. Once Phase 10 seeds real Examiner/Exam Coordinator roles,
`workflow_steps.role_id` can be repointed without touching this code or its schema.

**Auto-start trigger:** `PATCH /admission-slot-bookings/:id` starts the workflow the
moment both `marks_obtained` and `max_marks` are present (guarded against restarting
on every subsequent edit), the same "completing a stage auto-starts the next workflow"
pattern already used when an inquiry converts to a formal application.

**Frontend:** a compact status row in `BookingsModal` (not a full step-tracker like
`WorkflowPipeline` — that component is built around admission_application specifics
that don't apply here) showing "Awaiting `<Role>`" / "Result published" / "Result
rejected", with inline Approve/Reject when the logged-in user's role matches the
current step.

**Verified live, the full cycle:** re-saved marks on an existing scored booking,
confirmed the workflow auto-started at step 1 (Counselor); drove both steps to
completion; confirmed `result_published`/`result_published_at` were set correctly on
the booking row.

---

**Phase 6b-ii — Real auto-evaluation (genuinely blocked, not just unbuilt):**
Actual MCQ auto-grading needs a structured question bank (question text, options,
correct answer) and, critically, **a decided answer-capture method** — this codebase
has no candidate-facing portal at all (confirmed in the earlier competitive-audit
artifact), so "auto-evaluation" can't mean a candidate taking a test in-app today.
The realistic options are: (a) staff transcribes which option each candidate marked
on a paper answer sheet, then the system scores it — a data-entry-plus-scoring
feature; or (b) build a candidate-facing digital test-taking flow first — a materially
bigger initiative than this entrance-test feature, arguably closer to "build a testing
platform" than "add a field." **Not scoped further until that choice is made** — see
`decisions.md`. Recommend proceeding with 6b-i only for now; 6b-ii sized and estimated
once (a) or (b) is picked.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Entrance mode per class | School Admin/Principal | Interview |
| Marks entry required | School Admin | Off unless mode = written |
| Auto-evaluation | School Admin | Off unless mode = written MCQ |
| Result publish approval chain | Principal | Examiner → Review → Principal Approval → Publish |

**Done when (6a):** booking a slot for a class surfaces the class's configured mode,
read from the new per-class setting, not a new column on the slot itself.
**Done when (6b, separately sequenced):** marks/auto-evaluation exist as their own
minimal schema, and result publishing runs through a second workflow definition on the
existing shared engine.

---

## Phase 7 — Consistent Audit Columns — ✅ shipped 2026-08-20 (EXTEND the existing fee-column convention — renamed from "Unified Audit Layer")

Migration `20260830150000_admission_audit_columns.sql`. Audited all three named
targets before writing anything: **Seat Ledger** was already fully compliant
(`updated_by`/`updated_at`/`updated_reason` from Phase 1, `locked_at`/`locked_by`/
`lock_reason` from Phase 2) — confirmed by reading the schema, nothing to add.
**Documents** and **Pipeline** each had one real, concrete gap, and only those two
were touched:

- `application_documents.DELETE` was a genuine hard delete — a verified document's
  entire trail (who uploaded it, who verified it, when) could vanish with zero trace.
  Converted to soft delete (`deleted_at`/`deleted_by`), `GET .../documents` filters
  `deleted_at IS NULL`. This is still a plain-columns fix, not the "real audit-log
  infrastructure" `decisions.md` flagged as a separate, bigger decision — the row still
  physically exists, it's just excluded from normal reads.
- `admission_inquiries` had no `updated_by` at all — every other write path in this
  module already records an actor (fee columns, offer-letter columns, seat-ledger
  columns, fee-hold columns), but a direct `PATCH /inquiries/:id` could change any
  field, including status, with nobody recorded. Added `updated_by`, set on every
  update.

**Deliberately not touched**, staying inside Phase 7's named scope rather than
sprawling into every table this whole plan has added: `admission_cycles`,
`admission_slots`, `admission_class_settings`, `admission_document_requirements` each
have `updated_at` but no `created_by`/`updated_by`. Noted here as a real, small gap —
not fixed this pass because none of them were named in Phase 7's original settings
table, and folding them in without being asked would have quietly grown the phase's
scope past what was agreed.

**Verified live:** confirmed `updated_by` populates on a real inquiry PATCH; uploaded
and deleted a real document, confirmed it disappeared from the list endpoint but the
row itself still exists in the database with `deleted_at`/`deleted_by` correctly
stamped — not silently gone.

**Correction, framing:** there is no "audit layer" or "audit trail pattern" to extend —
verified there is no `audit_logs` table, no event log, no generic logging
infrastructure anywhere in this codebase. What exists is a **convention**: plain,
purpose-specific columns (`fee_paid_at`, `fee_collected_by`, etc.) added directly to the
relevant table. That convention is genuinely good and worth applying consistently to
the Seat Ledger, Documents, and Pipeline tables — but calling it a "layer" overstates
what's there and risks someone designing real audit-log infrastructure (immutable
event log, retention policy enforcement, tamper-evidence) that this codebase has no
precedent for and this phase doesn't actually need.

**If real audit-log infrastructure is wanted** (not just consistent tracking columns),
that's a materially bigger, separate decision — see `decisions.md`.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Audit log retention period | School Admin (within compliance floor) | Indefinite |
| Who can view audit logs | Director + Principal | Configurable to add Admin |

**Done when:** Seat Ledger, Documents, and Pipeline actions each carry the same
`*_at` / `*_by` / reason-column convention the fee module already uses — verified by
column-by-column comparison against `admission_applications`' fee columns, not a design
review.

---

## Phase 8 — Notification & Communication Layer (net new, event-driven)

**Unchanged — correctly deferred, and correctly identified as genuinely net-new.**
Blocked on a provider decision (Gupshup/Twilio/MSG91/etc.), same as recorded in
`admission-history.md`. Should consume the `seat.*` and pipeline-transition events Phases 1–6 emit,
so those phases aren't re-instrumented later.

**School-configurable settings (once unblocked):**
| Setting | Owner | Default |
|---|---|---|
| Provider | School Admin (contract-level) | — |
| Channel per event type | School Admin | Portal always on; others opt-in |
| Quiet hours | School Admin | No sends before 8am / after 9pm local |

---

## Phase 9 — Leadership Visibility Dashboard — ✅ shipped 2026-08-20 (EXTEND the existing pipeline stats + recharts)

**Verified:** the existing pipeline chart (`components/admission/PipelineCharts.tsx`)
already uses **recharts** (`BarChart`, `Cell`, `ResponsiveContainer`) — Phase 9 should
build on recharts, not introduce a second charting library.

**Minor pre-existing gap worth closing alongside this phase, not blocking it:** that
chart's `STAGE_ORDER` currently omits `entrance_exam`, `waitlisted`, and `fee_pending` —
three stages that exist in the schema and now have real UI elsewhere but never show up
on the pipeline chart. Free to fix while already touching this file for Phase 9;
not a prerequisite.

**School-configurable settings:**
| Setting | Owner | Default |
|---|---|---|
| Stage-aging alert threshold | Principal | 10 days at same stage |
| Occupancy warning threshold | Director | Below 70% at 60 days before cycle close |

**Done when:** the existing dashboard shows ledger-backed occupancy and aging alerts
via recharts, consistent with `PipelineCharts.tsx`'s existing visual language.

**Shipped, with one design correction found while scoping the aging alert:**
`admission_inquiries` only had `updated_at`, which is bumped by *any* field edit —
using it for "days stuck at this stage" would misfire every time someone fixed a typo
in a phone number. Migration `20260830160000_admission_dashboard_alerts.sql` adds a
purpose-built `status_changed_at`, set by a **database trigger** (not an
application-level write) specifically because `admission_inquiries.status` is written
from several call sites — `PATCH /inquiries/:id`, convert-to-application, both
workflow-completion sites, the fee-hold-expiry sweep — and a trigger covers all of
them, current and future, without depending on each one remembering to set it. Same
`schools`-column convention for the two thresholds (`admission_stage_aging_days`
default 10, `admission_occupancy_warning_percent` default 70,
`admission_occupancy_warning_days` default 60) — no edit UI shipped for these yet,
same "column exists, no settings screen yet" state as Phase 3's hold-duration setting.

Occupancy risk is checked against the **soonest upcoming cycle close date**, not
per-class — `admission_cycles` is per `(school, academic_year)`, not per class (Phase
1 deliberately kept the seat ledger un-year-scoped), so there's no clean class-to-cycle
link to check individually. Documented as a real, accepted simplification, not an
oversight.

`GET /admission-alerts` computes both; a new `AdmissionAlerts` component renders on
the main Pipeline page, **only when something actually needs attention** — a quiet
pipeline shows nothing, no empty "0 alerts" card taking up space. Also fixed, free,
while already touching `PipelineCharts.tsx` for this: its `STAGE_ORDER` was still
missing `entrance_exam`/`waitlisted`/`fee_pending` (the same gap noted but not fixed
back in Phase 6a's scoping) — an inquiry sitting at any of those three statuses simply
vanished from the chart with no indication it existed.

**Verified live:** backdated a real inquiry's `status_changed_at` and confirmed it
correctly surfaced in `stage_aging`; temporarily raised the occupancy threshold to 99%
and confirmed every class correctly appeared, sorted by occupancy ascending, against a
real test cycle's close date — then reverted both test-only changes. Left the one
backdated inquiry as real, visible demo data of the alert actually firing, rather than
quietly erasing the only evidence it works.

---

## Phase 10 — RBAC Finalization (EXTEND the existing dual role model — corrected)

**Correction, the most consequential one in this revision:** roles in this codebase are
**not one system** — they're two, layered:

1. **`users.role`** — a fixed, 8-value `CHECK` constraint on the `users` table:
   `super_admin`, `school_admin`, `principal`, `teacher`, `accountant`, `counselor`,
   `parent`, `student`. Used for coarse gating (`requireRole()`,
   `NON_STAFF_ROLES` checks). **Adding a 9th base value requires altering this
   constraint on the core `users` table** — a schema change that touches every login
   and every existing coarse role-check in the codebase, not just admission.
2. **RBAC v2** (`roles`, `role_permissions_v2`, `user_roles` — all school-scoped,
   real tables, confirmed dynamically insertable via plain `INSERT`, not an enum).
   This is what workflow steps actually check (`actOnWorkflow` resolves the step's
   `role_id` against `user_roles`) and what `requirePermissionV2()` checks everywhere
   else.

**What this means:** "Director", "Admission Officer", "Exam Coordinator", "Examiner",
and "IT Admin" can all be added **entirely through RBAC v2** — a data/config change,
zero schema risk — as long as every real person holding one of those titles still logs
in under one of the 8 existing `users.role` base values (most naturally `teacher` or
`accountant` depending on the position, with the *real* distinctiveness — permissions,
workflow-step eligibility, dashboard visibility — coming from their RBAC v2 role, not
their base value). This needs to be an explicit, visible choice in the invite/assign-
role UI ("base role" + "RBAC role"), not an implementation detail buried in a seed
script — otherwise whoever builds the invite flow for "Exam Coordinator" will hit the
`users_role_check` constraint and either alter it unnecessarily or get stuck.

**Deliverable:** `permissions.md` — full matrix, explicit about which of the two
systems each row lives in, cross-referenced against both `requireRole()` call sites
and `requirePermissionV2()` call sites, not a single flat list.

---

## Also flagged for this pass: legacy cleanup

Unchanged from the draft: the dead `admission_applications.status` enum values
(`counselor_approved`, `documents_verified`, `fee_paid`, `principal_approved`) stay
untouched. Recommend scheduling their removal after Phase 5 and Phase 6 ship, since
those are the phases most likely to tempt someone into reading the dead fields instead
of the real workflow-engine status.

---

## Execution sequencing summary (revised)

| Phase | Depends on | Extension point (verified) | Note |
|---|---|---|---|
| 1. Seat Ledger Engine | — | `getClassSeatAvailability()` — real migration, not a read-path swap | ✅ shipped 2026-08-20, keyed per-class not per-year |
| 2. Academic Year Locking | 1 | Seat ledger (not `admission_cycles`, see phase text) | ✅ shipped 2026-08-20 |
| 3. Fee Seat-Hold Clock | 1 | fee columns + existing `node-cron` pattern | ✅ shipped 2026-08-20 |
| 4. Waitlist Auto-Promotion | 1, 3 | `waitlist_rank` + `applyLedgerTransition`'s release hook | ✅ shipped 2026-08-20, rank UI shipped alongside |
| 5. Document Completeness Gate | existing docs feature | `checkAdmissionSection()`-style pre-check | ✅ shipped 2026-08-20 |
| 6a. Entrance Class-Wise Mode | existing slot entity | new per-class setting, not a slot column | ✅ shipped 2026-08-20 |
| 6b-i. Marks Entry | 6a | `admission_slot_bookings` + `MarksEntry` UI pattern | ✅ shipped 2026-08-20 |
| 6b-ii. Real Auto-Evaluation | 6b-i | none — no question/answer model anywhere in this app | **Blocked**: needs an answer-capture-method decision, see `decisions.md` |
| 6c. Result Publishing | 6b-i | shared workflow engine, new definition | ✅ shipped 2026-08-20, Counselor→Principal not Examiner→...→Publish |
| 7. Consistent Audit Columns | 1 | fee-column convention | ✅ shipped 2026-08-20 — Documents soft-delete, Pipeline updated_by |
| 8. Notifications | 1–6 (event sources) | net new | Blocked on provider decision |
| 9. Leadership Dashboard | 1, 2 | `PipelineCharts.tsx` (recharts) | ✅ shipped 2026-08-20 |
| 10. RBAC Finalization | 1–7 | RBAC v2 tables | New roles ≠ new `users.role` values |

**Recommended build order:** 1 → 2 → 3 → 4 → 5 → 6a → 6c → 6b → 7 → 9 → 10, with 8
slotted in whenever the provider decision unblocks it. 6b moved after 6c deliberately —
publishing a result someone entered manually is useful before auto-evaluation exists;
auto-evaluation without publishing isn't.

---

## What this plan still deliberately does not decide

Unchanged from the draft: hold durations, checklist contents, lock scope beyond "per
class," notification channels, occupancy thresholds. Each ships with the stated
default and a settings surface owned by the named role — see `decisions.md`.

## What this revision adds to "does not assume"

The original draft's blanket warning ("verify before executing") is now resolved
per-phase above. What remains genuinely undecided — not just unverified — is listed in
`decisions.md`, not here.

---

## Fee sequencing rework (2026-08-21) — approve → Fee Pending → pay → Admitted

User laid out the intended end-to-end flow and asked how ready the module was
against it. Answer at the time: steps 1, 3, 5 matched well; step 6-8 didn't — the
seat was reserved and the fee-hold clock started the moment an application was
*created*, and the Counselor → Principal → Admin chain completing flipped status
straight to `admitted` with zero fee check in between. Fee collection was a fully
independent, unordered action. User asked for a plan to fix 6-8 and to execute it.
This is that rework, ✅ shipped and verified live 2026-08-21.

**Schema** (`20260830190000_admission_fee_pending_stage.sql`): `fee_pending` added
as a legal `admission_applications.status` value (never was before — the CHECK
constraint didn't include it). New `admitted_section_id` column: the section is
still chosen at the final approval step (WorkflowPipeline's existing picker,
untouched), but student creation now happens later at fee-collection, so the choice
has to be persisted across that gap instead of asked twice.

**`POST /applications`**: no longer reserves a seat or starts the fee-hold clock —
only checks capacity for early feedback. Reserving at creation would hold a seat for
the entire vetting process (documents, entrance test, three-step approval) before
the school has actually decided to admit anyone.

**Workflow completion, both `/applications/:id/approve` and
`/applications/:id/workflow-action`** (factored into a shared
`completeAdmissionWorkflow()` — the duplicated logic here was already risky at its
old size, more so once it also had to gate seats and defer student creation): a
`checkSeatStillAvailable()` re-check joins `checkAdmissionSection` /
`enforceDocumentCompleteness` in the existing pre-action guard (before
`actOnWorkflow`, not after — since nothing was reserved at creation, a class that
filled up during the candidate's vetting has to be caught here). On approval
completing: seat reserved *for the first time*, fee-hold deadline set from the
school's `admission_fee_hold_days` setting, chosen section persisted, status →
`fee_pending`. No student created yet. On rejection at any step: status → `rejected`,
no ledger call at all — nothing was ever reserved, so there's nothing to release.

**`POST /applications/:id/collect-fee`**: now requires `status === 'fee_pending'`
(400 otherwise, with a status-specific message). Paying is what actually admits:
confirms the seat (reserved → confirmed), creates the student (using the persisted
`admitted_section_id`) + parent records, sets status → `admitted`, marks the linked
inquiry admitted. Response nests the created student under `data`, matching this
file's existing shape convention.

**`POST /applications/:id/extend-fee-hold`**: added a `status !== 'fee_pending'`
guard — previously this could stamp a `fee_hold_deadline` onto an application still
mid-approval (no seat reserved yet), which would have let the expiry sweep later try
to release a seat that was never held.

**Untouched, verified still correct as-is:** `releaseExpiredSeatHolds` (already
keys off `fee_hold_deadline`, which is now only ever set starting at `fee_pending` —
no logic change needed) and offer-letter issuance (already gated on
`status === 'admitted'`, which now only happens via fee collection — exactly right).

**Frontend**: `admissionApplicationStatusBadge()` (`lib/utils.ts`) reworked —
`workflow_status === 'approved'` used to mean "show Admitted"; it no longer does; a
completed workflow now means Fee Pending until the fee is actually paid. `status`
itself (fee_pending/admitted/rejected) is now the authoritative signal for those
three outcomes; the live workflow is only consulted for what's shown while the chain
is still in progress. The "Application Fee" card on the application detail page is
renamed "Admission Fee" and now shows one of four states matched to real `status`:
paid details, a Collect Fee button (only when `fee_pending`), "no fee due" (when
`rejected`), or "not yet payable" (still mid-approval). `WorkflowPipeline`'s success
toast and query invalidation updated to match (it previously only invalidated
`workflow-status`, not the application's own query — the Fee card wouldn't have
refreshed to show the new Fee Pending state without a manual reload).

**Verified live, full cycle:** created a real application (confirmed seat not
reserved, no fee-hold deadline), confirmed fee collection was rejected pre-approval,
walked it through all three real workflow steps as the School Admin bypass user,
confirmed it landed on `fee_pending` with the seat now reserved and the section
persisted, collected the fee, confirmed it flipped to `admitted` with the seat
confirmed and a real student + parent record created using the persisted section,
confirmed a second fee-collection attempt was blocked, confirmed the offer letter
could now be issued. All test data (student, parent, application, workflow rows) and
the one seat-ledger increment it caused were then removed directly via SQL — this
module has no DELETE endpoint for students or applications by design, so cleanup for
this test could not go through the API the way every other phase's test data did.

**Follow-up fix, same day:** the rework above only ever wrote `fee_pending` to
`admission_applications.status` — the source `admission_inquiries.status` (already a
legal value there, already offered as a filter option) never got the same update, so
a converted inquiry stayed stuck showing "Docs Submitted" on the Pipeline tab forever,
even once its application had genuinely moved to Fee Pending. `rejected` and
`admitted` were already correctly mirrored back to the inquiry; this was the one
missing transition. Fixed in `completeAdmissionWorkflow()`'s approved branch. Also
closed the matching gap in the other direction: `fee_pending` (like `admitted`) is
now blocked from being set on an inquiry by direct manual status change
(`PATCH /inquiries/:id`) — it was a selectable option in the Status-Change modal with
nothing stopping it from drifting out of sync with what the linked application was
actually doing. Removed it from that picker's option list; it stays a valid *filter*
option, since filtering by a real system-derived state is still useful. Added
`fee_pending` to the Pipeline tab's stage-count cards and to `STATUS_COLORS` (amber),
which had silently never been updated for it. ✅ shipped 2026-08-21, verified live:
converted a fresh inquiry, walked its application through all three approval steps,
confirmed the inquiry's own status read `fee_pending` immediately after, confirmed a
direct manual `PATCH .../status: fee_pending` on a different inquiry was rejected.
Test data removed via SQL afterward, seat ledger restored.

---

## Per-class admission fee, school-configurable (2026-08-21)

User asked for the admission fee to be set up per class in advance — same pattern as
the Fee module's structures let a school set fees per class for a session, and the
same self-service, no-typing-it-in-each-time pattern already used for entrance mode.
Researched the Fee module's actual `fee_structures`/`fee_structure_lines`/
`fee_structure_classes` model first (versioned, multi-head bundle plans, invoice/
payment-linked) — deliberately **not** copied here: an admission fee is a single
scalar per class, not a bundle, not billed on a schedule, and (per the existing
`collect-fee` comment) explicitly bypasses the Fee module's invoice system entirely.
`admission_class_settings`'s own migration comment already named it as the intended
home for exactly this kind of future per-class admission setting, so extended that
table instead, matching its existing inline-edit list pattern (`EntranceModeCard`)
rather than building Fee-module-style versioning machinery to solve a problem this
doesn't have.

**Schema** (`20260830200000_admission_class_fee_amount.sql`):
`admission_class_settings.admission_fee_amount numeric(12,2)`, nullable — null means
"not configured yet," not zero, same "absence has a sane default" convention as the
rest of this module.

**Backend**: `GET/PATCH /class-settings` extended to read/write it alongside
entrance_mode and pass_marks_percent. `POST /applications/:id/collect-fee`'s
`amount` is now optional — when omitted, falls back to the applying-for class's
configured `admission_fee_amount`; 400 with a clear message if neither exists.
Still fully overridable per-application (a scholarship, a sibling discount) by
sending an amount.

**Frontend**: the Slots page's `EntranceModeCard` renamed "Entrance Mode & Admission
Fee by Class," gained a third inline ₹ input per row (same defaultValue/onBlur
pattern as pass_marks_percent). `CollectFeeModal` (application detail page) now
fetches class-settings and pre-fills the amount field from the configured fee when
one exists, staying freely editable, with a note explaining where the number came
from.

**Verified live, full cycle:** confirmed `admission_fee_amount` defaults to null,
set Class 3's to ₹5,000 via the endpoint, ran a full application through all three
approval steps to Fee Pending, called collect-fee with no `amount` in the body at
all — confirmed it correctly charged ₹5,000 and admitted. Test application, student,
parent record, and the seat-ledger/class-setting changes it caused were all removed
afterward.

---

## Section-wise strength surfaced at allotment time (2026-08-21)

User asked for the Seats page to be expanded to show section-wise student strength,
specifically so it's visible at the moment a section is actually allotted (the final
approval step's "Enrol into section" picker, screenshotted showing a plain section
list with no strength shown). No new schema or endpoint needed — `GET
/classes/strength` already existed (built earlier for a principal-dashboard widget,
`ClassStrength.tsx`) and already computes exactly this: enrolled count and configured
capacity per section, from the real `students.section_id`, not from the admission
seat ledger (which tracks pipeline counters — reserved/confirmed against a
class-level capacity — and has no idea which section within a class anyone actually
landed in). Reused it in two places instead of building anything new:

- **Seats page**: each class card now has a "Section-wise strength" row of compact
  pills (e.g. "A: 39/40 · B: 38/40"), pulled from the same endpoint, sitting below
  the existing class-level capacity/confirmed/reserved/frozen stats — a second, real
  number next to the pipeline-counter one, not a replacement for it.
- **WorkflowPipeline's section picker** (the actual point of allotment): each
  `SelectItem` now shows live enrolled/capacity next to the section name (e.g. "A —
  39/40 students"), turned red with a "· full" suffix once a section is at capacity —
  so whoever approves the final step can see the real strength of every section
  before picking one, not choose blind.

✅ shipped 2026-08-21, verified live against real data (Class 3: Section A 39/40,
Section B 38/40, both endpoints confirmed returning the same figures).

---

## Section capacities editable alongside class capacity (2026-08-21)

Follow-up to the section-wise strength feature above: showing the numbers surfaced
that they don't actually reconcile — Class 1's admission capacity read 85, but its
two sections cap out at 40 each (80 total), a 5-seat gap no section can physically
hold. This was always true, just invisible before section strength was shown at
all. User asked for the capacity editor to also manage section numbers so the
totals can be made to match.

`AdjustSeatsModal` (Seats page) now also lists each of the class's sections with an
editable capacity input, live-computing a total and flagging a mismatch against the
class capacity field in red, with a one-click "Set capacity to `<sections total>`"
shortcut. Reuses the section-update endpoint that already existed for Settings →
Classes & Sections (`PATCH /admission/sections/:id`, `max_strength`) — no new
backend route. On Save: the class-capacity update and any changed section-capacity
updates run together, then both `admission-seats` and `classes-strength` are
invalidated so the Seats page and the WorkflowPipeline section picker both reflect
it immediately. Deliberately left the mismatch as a visible warning rather than a
hard block — a school might genuinely want ledger capacity ahead of physical section
capacity for a stretch (e.g. planning to add a section later), so this surfaces the
gap without forcing an immediate reconciliation.

✅ shipped 2026-08-21, verified live against the real Class 1 mismatch from the
screenshot (capacity 85, sections 40+40=80): confirmed the section-update endpoint
correctly changes a section's capacity and that `classes/strength` reflects it
immediately. Reverted every value back to its original after verifying — this
touched real records, not disposable test rows, so nothing was left changed.

---

## Admission Date on the student profile (2026-08-21)

User pointed out a just-admitted student's profile (SIS module, not admission) had
no record of when they were actually admitted — only `created_at`, a plain
timestamp meant for auditing, not something shown to staff. `students` never had a
dedicated admission-date column, only `date_of_birth`.

**Schema** (`20260830210000_students_admission_date.sql`): `students.admission_date
date`, nullable. Backfilled all 1,125 existing students from `created_at::date` (the
best available proxy for pre-existing rows) rather than leaving them blank.

**Backend**: `CreateStudentSchema`/`UpdateStudentSchema` (`sis/routes.ts`, shared by
`POST /students` and `PATCH /students/:id`) gained `admission_date`. `POST /students`
defaults it to today when omitted — matches how a manually-added student is, by
default, being added because they're joining now; still overridable for backdating
a bulk-imported historical student. `createStudentForApplication()`
(`admission/routes.ts`, the function that creates a student when an admission
application's fee is collected) sets it from `fee_paid_at` specifically — more
precise than "now" (this call runs a beat later, same request) and matches what the
fee receipt already says actually happened.

**Frontend**: added to the student detail page's Personal Information card (next to
Date of Birth) and to the Edit Profile form (same field, same date input pattern).

✅ shipped 2026-08-21, verified live: confirmed backfill matched `created_at` for an
existing student, ran a full application through the admission pipeline and
confirmed the resulting student's `admission_date` matched `fee_paid_at` exactly,
confirmed `POST /students` defaults to today when omitted and accepts an explicit
backdated value when given one. All test rows removed afterward, seat ledger
restored.

---

## Post-Phase-9 bug fixes (2026-08-21)

Three real bugs found from live user testing, not part of the phased plan — recorded
here since all three touch schema/routes this plan already built.

**Slot booking made at inquiry stage invisible after converting to an application**
(inquiry page showed "Class 11 MCQ Test — Booked", the same candidate's application
page showed "No bookings yet"). Root cause: `admission_slot_bookings` rows only ever
carry one of `inquiry_id`/`application_id`, set to whichever stage the candidate was
at when the slot was booked — and `POST /inquiries/:id/convert-to-application` never
relinks a candidate's existing bookings to the new application, so a booking made
before conversion keeps pointing at the (now-superseded) inquiry only.
`SlotBookingCard`'s two instances each queried by exactly one FK, so the
application-page instance never saw pre-conversion bookings. Fixed at the query layer
rather than by backfilling data: `GET /admission-slot-bookings` now accepts
`inquiry_id` and `application_id` together and OR-matches (previously AND — always
empty when both were passed), and the application detail page now also passes the
app's own `inquiry_id` (`alsoInquiryId` prop, read-only — never changes what a *new*
booking from that page attaches to, still `application_id`). Fixes every existing
converted application retroactively, not just future ones. ✅ shipped 2026-08-21,
verified live against the real mismatched booking.

Two more bugs, same day:

**Status badge desync (application detail page showed "Admission Confirmation" at
the top while the workflow pipeline below showed "Rejected").** Root cause:
`admissionApplicationStatusBadge()` (`frontend/lib/utils.ts`) only ever read
`admission_applications.status` — a plain column only written by the
workflow-completion handlers in `admission/routes.ts` — and never looked at the live
`workflow_status`/`current_step_name` the backend already attaches to every
application response, even though `WorkflowPipeline.tsx` (the widget right below it)
reads exactly that field. The two can genuinely disagree: `seed.ts` picked
`status` and its seeded `workflow_instances.status` independently for demo rows (4 of
41 seeded applications landed on opposite outcomes — e.g. `status: 'rejected'` next to
a seeded `workflow_status: 'approved'`, or vice versa). Fixed the helper to treat the
live workflow as the source of truth whenever one exists, falling back to the plain
column only for applications with no workflow instance at all — matching what
`WorkflowPipeline` already shows, so the two can no longer say different things.
Also fixed `seed.ts` so `status` is now derived from the same seeded workflow outcome
instead of picked independently, so a fresh re-seed won't reproduce the drift.
**Not done:** the 4 already-seeded live rows still have a stale `status` column
(harmless to the badge now, but the Applications list's status filter still queries
that raw column) — backfilling them needs a DB-writing script, which this session's
permission settings blocked; flagged to the user, not silently left broken.
✅ shipped 2026-08-21.

**Document upload failing outright** (`Could not find the 'notes' column of
'application_documents' in the schema cache"). Root cause: migration
`20260830030000` brought `application_documents` in line with the sibling
`student_documents` table's shape (`school_id`, `mime_type`, `file_size`,
`uploaded_by`) but missed `notes` — `student_documents` has always had it, and both
`POST /applications/:id/documents` and the upload form's "Notes" field had always
assumed it existed. Every document upload for an application has been failing since
that migration shipped. Migration `20260830180000_application_documents_notes.sql`
adds the missing column. ✅ shipped 2026-08-21, verified live: uploaded a real test
document with a notes value through the actual endpoint, confirmed it saved and
returned correctly, then removed it (soft-delete, same as every other document
removal in this module).

## Post-Phase-9 fixes (user-requested, 2026-08-20)

Three targeted fixes requested directly by the user, done between Phase 9 and the
still-paused Phase 10. Not part of the original 10-phase plan; recorded here because
they touch the same schema/routes.

1. **Strict class filtering on slot booking.** `GET /admission-slots` now accepts an
   optional `class_id` query filter. `SlotBookingCard.tsx` (shared by both the inquiry
   and application detail pages) takes a new `classId` prop and passes the candidate's
   `applying_for_class_id` straight into the slot query, so the "Book a Slot" dropdown
   only ever offers slots generated for the class the candidate is actually applying
   for — no more cross-class booking mistakes. ✅ shipped 2026-08-20, verified live:
   created two test slots for two different classes, confirmed the `class_id` filter
   returned only the matching one, then deleted both test rows.

2. **"Previous Academic Percentage" as an entrance mode.** `admission_class_settings.entrance_mode`'s
   CHECK constraint extended (migration `20260830170000`) to add
   `previous_academic_percentage` alongside the existing `interview` /
   `written_mcq` / `written_subjective` / `observation`. Some schools admit off prior
   school performance rather than a fresh test — `admission_inquiries.previous_percentage`
   already captures the input this mode would evaluate against, no new capture needed.
   The per-class "% required" threshold input (previously shown only for the two
   written modes) now also shows for this mode, reusing `pass_marks_percent`. ✅ shipped
   2026-08-20, verified live via direct PATCH.

3. **Class numbering style toggle (numeric vs Roman), admission-module scope.**
   `schools.class_display_style` (`numeric` | `roman`, default `numeric`) is the single
   source of truth, read/written via `GET`/`PATCH /admission/class-display-style`
   (School Admin only to write). A segmented toggle now lives at the top of
   Settings → Classes & Sections. `classLabel(name, numeric_level, style)`
   (`frontend/lib/utils.ts`) and the `useClassDisplayStyle()` hook
   (`frontend/lib/useClassDisplayStyle.ts`) do the actual formatting, and are now wired
   into every class-name display inside the admission module: Pipeline and
   Applications list tables, inquiry/application detail pages, Seats cards + adjust
   dialog, Slots list + Entrance Mode card + New Slot class picker, and the Document
   Requirements class picker. **Follow-up fix, same day:** the strict filter also
   surfaced a pre-existing data gap — a slot's title can say "Class 3" while its actual
   `class_id` column is unset (the New Slot form's class picker was always optional,
   for genuinely class-agnostic slots like a general campus tour), and such a slot
   silently never appeared in that class's "Book a Slot" list even though it was
   plainly intended for it. There was no way to fix this without deleting and
   recreating the slot — `PATCH /admission-slots/:id` already accepted `class_id`
   server-side, but no UI called it. Added an Edit button (reusing the New Slot form,
   now `SlotFormModal`, in edit mode) so an existing slot's class link — or any other
   field — can be corrected in place, plus a "Not linked to a class" warning badge on
   any non-campus-tour slot with no `class_id`, so a misconfigured slot is visible on
   the Slots list itself rather than only discovered when a booking dropdown comes up
   empty. ✅ shipped 2026-08-20, verified live: found and corrected one real orphaned
   slot this way (Class 3 Entrance Test, created earlier the same day with no class
   selected), confirmed it then appeared correctly in that class's strict-filtered
   booking list.

   Backend joins that only returned `classes(id, name)`
   were extended to also select `numeric_level` (four spots in
   `admission/routes.ts` — inquiry list/detail, application list/detail — plus the
   `admission-seats` and `class-settings` endpoints, which already fetched
   `numeric_level` internally but weren't putting it on the response).
   **Deliberate scope decision, stated to the user, not yet pushed back on:** "source
   of truth throughout the whole ERP" is honored at the *setting* level (one column on
   `schools`, one pair of endpoints) but the *display* rollout in this pass is
   admission-module only. SIS, Fee, Exam, Timetable, and HR modules still render class
   names raw wherever they show them — none of that code was touched. Propagating
   `classLabel()` there is a separate, larger follow-up (dozens of files across
   modules this session didn't build), not silently done. ✅ shipped 2026-08-20,
   verified live via direct GET/PATCH.
