# Admission Engine — Decisions Log

Companion to `plan.md`. That document is the *how*; this is the *what's actually
undecided and who decides it*. Nothing here is a technical implementation choice —
everything below is a business-policy or ownership question this plan correctly
refuses to answer on its own, per its own guiding principle: if two schools could
reasonably want a different answer, it's a setting, not code.

Each row ships with the stated default so the system works before anyone configures
anything. "Status: open" means the default is a placeholder, not a recommendation —
build against it, but don't treat it as decided.

---

## Standing principles (decided, not open)

1. **Settings over hardcoded rules.** Confirmed in `plan.md` — kept.
2. **Extend, don't duplicate.** Confirmed against the actual codebase for every phase
   except Notifications (Phase 8) and Marks Entry/Auto-Evaluation (Phase 6b), which are
   genuinely net-new and labeled as such.

---

## Blocking decisions

These aren't settings with a safe default — building ahead of an answer risks a
rebuild, not a config tweak later. The first two were resolved 2026-08-20 (adopted
recommendations, Phases 1/2 shipped on them); the third is new and still open.

| Decision | Why it blocks | Options | Recommendation |
|---|---|---|---|
| **Does AIRTEC need a Campus layer at all?** | Verified: no campus/multi-campus concept exists anywhere in the current schema. `school_id` is the only tenancy boundary today. Phase 1's ledger and Phase 2's locking hierarchy both need to know whether to key on `(academic_year, class)` or `(academic_year, campus, class)` from day one — adding it later is a real migration, not a toggle. | (a) Single-campus per school, as today — drop Campus from the hierarchy entirely. (b) Add Campus now, even if every current school has exactly one. | **Adopted: (a)**, 2026-08-20. Ledger keys on `(school_id, academic_year_id, class_id)`, no campus column. Revisit only if a specific multi-campus school is actually on the roadmap. |
| **How do new job titles (Director, Admission Officer, Exam Coordinator, Examiner, IT Admin) map onto the existing 8-value `users.role` enum?** | Verified: `users.role` is a `CHECK`-constrained column with exactly 8 values (`super_admin, school_admin, principal, teacher, accountant, counselor, parent, student`). None of the five new titles this plan assumes (Phase 2's "Director-only unlock", Phase 6's "Examiner", Phase 10 generally) exist there. RBAC v2 (`roles` table) can add them freely as *additional* granted roles, but every real person still needs one of the 8 base values to log in at all. | (a) Map each new title to the closest existing base value (Director→`school_admin` or `principal`; Admission/Exam Officer/Examiner→`teacher` or `accountant`), with the real distinction living entirely in RBAC v2. (b) Alter the `users_role_check` constraint to add new base values. | **Adopted: (a)**, 2026-08-20. Not needed for Phase 1 (no role-gated feature in this phase beyond existing School Admin/Principal). Applies when Phase 2/6/10 build role-gated features against these titles. |
| **How should entrance-test auto-evaluation capture a candidate's answers?** | Scoped 2026-08-20 while researching Phase 6b: confirmed no question/options/correct-answer model, and no candidate-facing portal, exist anywhere in this codebase. Real MCQ auto-grading cannot be built without picking one of these — it isn't a config default, it changes what gets built. | (a) Staff transcribes marked options from a paper answer sheet, system scores it. (b) Build a candidate-facing digital test-taking flow first — a materially bigger initiative than this feature. | **Not yet decided — still open.** Recommend (a) if auto-evaluation is wanted soon, or deferring 6b-ii entirely in favor of 6b-i (plain manual marks entry, already scoped and buildable) until there's a concrete reason a manual score isn't enough. |

---

## Per-phase settings — carried from the plan, status marked

Everything below already has a safe default in `plan.md`. Listed here so there's one
place to see what's actually been confirmed by a stakeholder vs. still running on the
placeholder default.

### Phase 1 — Seat Ledger — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Who may update/degrade seat count | School Admin + Principal, independently | **Shipped as the hard-coded gate** (`requireRole('school_admin','principal')`) rather than a configurable setting — still open whether this should become school-configurable later, but not blocking, since the shipped default matches the recommendation exactly |
| Whether degrade requires a reason | On (optional field, not enforced) | Shipped as optional-but-recorded, not enforced-required — open whether it should become mandatory |
| Buffer/frozen seats per class | 0, adjustable via `PATCH /admission-seats/:classId` | Shipped, per-class, no default-setting UI beyond direct adjustment |
| Concurrency rule | Last-write-wins + `updated_by`/`updated_at` on the ledger row | **Shipped as decided** — read-then-write, no locking, matches the hard default exactly |
| Ledger grain | `(school_id, class_id)`, not `(academic_year_id, class_id)` | **New decision surfaced during implementation** — see `plan.md` Phase 1 for why (sections aren't year-scoped in this schema today) |

### Phase 2 — Locking Governance — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Lock granularity | Per class (lock state lives on the seat ledger, not a new table) | Shipped as the only granularity — no cycle/year dimension, matching Phase 1's per-class-not-per-year grain decision |
| Who can lock/unlock a class | `school_admin` only (Principal keeps capacity/frozen access but not lock) | **Shipped**, resolving the blocking decision: "Director" mapped to School Admin, the closest existing base role, with lock and unlock treated identically rather than split into two authority levels |
| Section-plan pre-declaration before lock | Off | **Deferred, not built** — genuinely no consumer of this setting exists yet; building UI/schema for an off-by-default setting nothing reads yet was skipped rather than speculative |

### Phase 3 — Fee Seat-Hold Clock — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Hold duration | 7 days (`schools.admission_fee_hold_days`) | Shipped, per-school column, no UI to edit it yet (edit directly or via a future settings page — Phase 3's own scope was the mechanism, not a settings screen) |
| Reminder cadence | Day 3, Day 6 | **Not built** — confirmed still blocked on Phase 8 (no send channel exists), exactly as flagged before starting. No reminder infrastructure was built ahead of that, to avoid dead code with nothing to call it |
| Grace period after deadline | 0 days (`schools.admission_fee_hold_grace_days`) | Shipped, same as hold duration — column exists, no edit UI yet |
| Manual override to extend a hold | Allowed, logged | **Shipped**: `POST /applications/:id/extend-fee-hold`, School Admin/Principal (not "Admission Officer" — doesn't exist as a role yet) |
| **What happens on expiry: reject vs. waitlist** | Auto-reject, `auto_rejected_reason` recorded | **New decision made during implementation, not left open** — the plan didn't specify this. Adopted "reject" because "seat released" already means someone else can claim it, matching how rejection is used everywhere else in this pipeline. Reconsiderable — if schools want expired-but-still-interested applicants routed to waitlist instead of rejected, that's a real behavior change, not a bug fix |

### Phase 4 — Waitlist Auto-Promotion — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Promotion mode | Auto-select next candidate + visible response clock, not auto-confirm | **Shipped, adapted**: "auto-notify" became "auto-select + visible deadline" rather than an actual sent message, since Phase 8 is still blocked. No admission decision is ever made automatically — only who's offered next and by when they should respond |
| Response deadline for offer | 3 days (`schools.admission_waitlist_response_days`), then next rank | Shipped, per-school column, no edit UI yet (same as Phase 3's hold-duration setting) |
| Tie-break rule | `waitlist_rank` ascending (nulls last), then enquiry date ascending | Shipped exactly as decided |
| **Rank-setting UI** | Inline input in the Status-Change modal, shown only when selecting Waitlisted | **New scope item from the plan's own correction, now closed** — every inquiry's rank was null before this; new waitlisted inquiries can now be ranked at the moment of the status change |

### Phase 5 — Document Completeness Gate — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Mandatory document checklist per class | Empty until configured, no blocking on unconfigured classes | Shipped as `(school, class)`, not `(board, class)` — a school has one board (`schools.affiliation_board`), so the board dimension was redundant. **UI now exists** at `/admission/document-requirements` — still needs an actual admissions-team-sourced checklist per class entered, not a guess, but the mechanism to enter it is no longer missing |
| Who can verify a document | Admission Officer + Principal | **Left as-is** (`admission.edit` permission, broad) — still soft-blocked on the Phase 10 role-mapping decision; tightening this now would mean picking an arbitrary existing role to stand in for "Admission Officer" for verification specifically, which felt worse than leaving it broad until that mapping is actually decided |
| Override authority (admit despite gaps) | Principal-only, reason required, logged | **Shipped and verified**: a School Admin's override attempt was confirmed rejected server-side even with the override flags and a valid section supplied — the restriction isn't just a hidden UI control |

### Phase 6a — Entrance Mode per Class — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Entrance mode per class | Interview (schema default, no row needed) | **Shipped**, `/admission/class-settings` UI (School Admin/Principal write, everyone with `admission.view` reads) |

### Phase 6b — Marks Entry / Auto-Evaluation, scoped 2026-08-20

Researched the existing Examinations module first (`student_marks`, `MarksEntry` UI) —
confirmed reusable in shape for manual marks entry, and confirmed **no MCQ/question/
correct-answer model exists anywhere in this codebase**. This splits what was one
settings row in the original draft into two features of very different size — see
`plan.md`'s Phase 6b section for the full research.

| Setting | Default | Status |
|---|---|---|
| Marks entry required | Off unless mode = written | **✅ Shipped 2026-08-20** (6b-i) — `admission_slot_bookings` gained `marks_obtained`/`max_marks`/`is_pass`, verified live at both above- and below-threshold |
| Pass mark threshold per class | 40% | **Shipped**, `admission_class_settings.pass_marks_percent`, editable inline on the Slots page next to each written-mode class |
| **Auto-evaluation answer-capture method** | — | **New blocking decision, not just an open setting**: (a) staff transcribes marked options from a paper answer sheet for the system to score, or (b) build a candidate-facing digital test-taking flow first (this app has no candidate portal at all today — see the earlier competitive-audit artifact). (b) is a materially bigger initiative than an entrance-test feature. **Recommend (a)** if auto-evaluation is wanted soon; **recommend deferring 6b-ii entirely** until there's a concrete reason a manual score (6b-i) isn't enough |
| Result publish approval chain | ~~Examiner → Review → Principal Approval → Publish~~ **Shipped as Counselor → Principal**, 2026-08-20 | Deviated from the drafted default deliberately: confirmed `ensureMultiStepWorkflow` silently no-ops if a named step role isn't seeded, and "Examiner"/"Exam Coordinator" aren't seeded anywhere — creating them is Phase 10 work. Used the two roles guaranteed to exist instead of shipping a workflow that would silently fail to start for every school. `workflow_steps.role_id` is a plain FK — repointing it to real Examiner/Exam Coordinator roles once Phase 10 seeds them needs no code or schema change |

### Phase 7 — Consistent Audit Columns — ✅ shipped 2026-08-20

| Item | Status |
|---|---|
| Seat Ledger | Audited, already fully compliant from Phases 1-2 — nothing added |
| Documents (`application_documents`) | **Shipped**: DELETE converted from hard delete to soft delete (`deleted_at`/`deleted_by`), verified live — the row survives, just excluded from normal reads |
| Pipeline (`admission_inquiries`) | **Shipped**: `updated_by` added, verified live on a real PATCH |
| `admission_cycles` / `admission_slots` / `admission_class_settings` / `admission_document_requirements` | **Found, not fixed** — each has `updated_at` but no `created_by`/`updated_by`. Left out deliberately: none were named in Phase 7's original scope, and adding them unasked would have quietly grown the phase. Real candidate for a small fast-follow if wanted |

| Setting | Default | Status |
|---|---|---|
| Audit log retention period | Indefinite | Open — check against actual data-retention/compliance obligations (e.g. state education board rules on applicant record retention) rather than defaulting to "forever" without checking |
| Who can view audit logs | Director + Principal, configurable to add Admin | Soft-blocked on role-mapping ("Director") |
| **Scope of "audit"** | Plain tracking columns, matching the existing fee-column convention | **Needs an explicit yes/no**: is column-level tracking (`*_at`/`*_by`/reason) actually sufficient, or does this need real immutable event-log infrastructure (tamper-evidence, full change history, not just latest state)? Verified: no such infrastructure exists anywhere in this codebase today — building it would be a materially bigger scope than Phase 7 as drafted. Don't let "audit" quietly grow from a column convention into a logging platform without that being a deliberate call. |

### Phase 9 — Leadership Dashboard — ✅ shipped 2026-08-20

| Setting | Default | Status |
|---|---|---|
| Stage-aging alert threshold | 10 days at same stage (`schools.admission_stage_aging_days`) | Shipped, column exists, no edit UI yet — same state as Phase 3's hold-duration setting |
| Occupancy warning threshold | Below 70% at 60 days before cycle close (`schools.admission_occupancy_warning_percent`/`admission_occupancy_warning_days`) | Shipped, same as above. Checked against the *soonest* upcoming cycle close since cycles aren't per-class — accepted simplification, not an oversight |
| **How to measure "days at the same stage"** | `admission_inquiries.status_changed_at`, set by a DB trigger | **New decision made during implementation**: `updated_at` was ruled out because it's bumped by any field edit, not just status changes, which would have made the alert noisy and wrong. A trigger (not an app-level write) was chosen specifically because `status` is written from several call sites and a trigger covers all of them without relying on each one remembering to set a timestamp |

### Phase 10 — RBAC Finalization

| Item | Status |
|---|---|
| Full role set: Director, School Admin, Admission Officer, Exam Coordinator, Examiner, Accountant, Parent, Student, IT Admin | Resolve the base-role-mapping blocking decision first, then this becomes a straightforward RBAC v2 data seed, not a schema question |
| `permissions.md` deliverable | Not started — should explicitly separate which permissions live in `users.role`/`requireRole()` vs RBAC v2/`requirePermissionV2()`, since both mechanisms are live and checked in different places |

---

## Post-Phase-9 fixes (2026-08-20) — settings shipped

| Setting | Default | Owner | Status |
|---|---|---|---|
| Class numbering display style (`schools.class_display_style`) | `numeric` | School Admin (write); everyone with `admission.view` reads it | ✅ Decided & shipped — see below |
| Interview/test slot booking scoped to the candidate's applying-for class | always strict, not a toggle | — (not a setting; a correctness fix) | ✅ Shipped |
| `previous_academic_percentage` as an entrance-mode option | opt-in per class, alongside interview/written/observation | School Admin / Principal, per class via existing entrance-mode setting | ✅ Shipped |

**Class numbering — scope decision, not yet re-confirmed with the user:** the user's
literal ask was a toggle that's "source of truth throughout the whole ERP." The
*setting itself* is genuinely school-wide (one column on `schools`, not scoped to
admission) — but *displaying* classes through it was only done inside the admission
module in this pass. SIS, Fee, Exam, Timetable, and HR modules all render class names
directly from `classes.name` in dozens of files untouched this session; none of them
read `class_display_style` yet. Rolling `classLabel()` out there is real, scoped work
(one call site swap per display, but many files) — flagged here as an explicit
follow-up rather than claimed as done. If the user pushes back wanting full-ERP
coverage now, this is the next unit of work, not a bug fix.

---

## Carried forward from Phase 0-2 (unresolved before this revision, still unresolved)

These predate this plan and were never actually decided — recorded in
`admission-history.md`'s "Open questions" section, repeated here so there's one list of
outstanding decisions instead of two:

| Decision | Status |
|---|---|
| Should approval chain depth be configurable per class, or only per school globally? | Open |
| Is e-signature a hard requirement for the offer letter, or is a generated PDF sufficient for v1? | **Decided 2026-08-25 by the user: the current printable HTML offer letter is sufficient for v1.** e-signature capture remains a real, separate initiative if wanted later — not scoped further. |
| Which SMS/WhatsApp provider should the communication integration target (Gupshup / Twilio / MSG91 / other)? | Open — blocks Phase 8 entirely. User confirmed 2026-08-25 this stays parked deliberately, not an oversight. |
| Should RTE/sibling/staff quota categories be enforced as hard caps at admission time, or advisory only? | **Decided 2026-08-25 by the user: advisory only**, matching current practice — the existing RTE reimbursement module doesn't enforce its own 25% cap either. No build required. |
| Which payment gateway should the admission-fee collection step target? | Open — blocks `remaining-work-plan.md` Section B2 entirely. User confirmed 2026-08-25 this stays parked deliberately, same as the SMS/WhatsApp decision above. |

---

## How to use this file

When a decision above gets made, update its **Status** column in place (e.g. `Open` →
`Decided 2026-09-02 by <name>: <answer>`) rather than deleting the row — the row's
existence is the record that this was a deliberate choice, not an oversight, the same
way `plan.md` and `admission-history.md` record what was verified vs. assumed.
