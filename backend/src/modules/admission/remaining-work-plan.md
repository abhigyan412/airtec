# Admission Engine — Remaining Work Plan (2026-08-25)

Companion to `plan.md` (the phase-by-phase build log — 9 of its 10 phases are now
✅ shipped) and `decisions.md` (the open/closed policy-decision register). Neither
of those is a good single place to hand someone asking "what's actually left to
build" — `plan.md` is mostly history now, and `decisions.md` is a decision log, not
a build plan. This document is that single place. It does not repeat what's already
shipped; every item below is either unbuilt, blocked, or explicitly deferred.

Two sources feed this list, kept in separate sections since they arose differently:

- **Section A** — gaps `plan.md`/`decisions.md` already named but didn't close:
  blocked phases, deliberate fast-follows, and open policy questions.
- **Section B** — gaps surfaced by the 2026-08-25 competitive comparison against
  Fedena, Meritto, OpenApply, and the SchoolAdmin/Veracross/Ravenna cluster
  (published artifact: "How AIRTEC Stacks Up") — capabilities those platforms treat
  as core that this module doesn't have yet, not previously scoped anywhere.

Same guiding principles as `plan.md`: settings over hardcoded rules where two
schools could reasonably disagree, and extend what exists rather than building a
parallel system — flagged explicitly below wherever an item is genuinely net-new
instead.

---

## Section A — Finish what's already scoped

### A1. RBAC Finalization (`plan.md` Phase 10) — ✅ shipped 2026-08-25

All four checklist items closed:
- Director/Admission Officer/Exam Coordinator/Examiner/IT Admin seeded as real
  RBAC v2 roles, backfilled live into the local dev school.
- The invite/assign-role UI needed **no changes** — checked first, and
  Settings → Team's existing "Manage Roles" modal already generically lists
  every RBAC v2 role with primary-vs-additional clearly shown; the five new
  titles just needed to exist to appear there.
- `rbac/permissions.md` shipped — turned out to be **four** gating mechanisms
  in this codebase, not two (`requireRole()`, `requirePermissionV2()`, the
  `NON_STAFF_ROLES` own-record filter, and workflow-step `role_id`
  membership) — all four documented, not just the two originally named here.
- Phase 6c's placeholder Counselor step repointed to the real Examiner role,
  both in the seed function (new schools) and directly on the one existing
  school's already-completed workflow instance (verified safe first — no
  in-flight instance depended on the old role).

Also caught and fixed a real, pre-existing bug surfaced by adding these roles:
`seedDefaultRoles()`'s re-seed guard queried `role_permissions_v2` with no
scope and no pagination, silently truncating at PostgREST's 1000-row default
once the table crossed that line — causing duplicate-insert failures. Fixed
by scoping the query to the school's own role ids.

See `plan.md`'s 2026-08-25 "RBAC Finalization" entry for the full account.

### A2. Notification & Communication Layer (`plan.md` Phase 8) — blocked

**Blocking decision (open in `decisions.md`):** which SMS/WhatsApp/email provider
(Gupshup / Twilio / MSG91 / other). Nothing else in this item can start first —
picking the provider is the actual work of un-blocking it.

Once unblocked:
- Consume the `seat.*` and pipeline-transition events Phases 1–6 already emit
  (built with this in mind — no re-instrumentation needed).
- Turns Phase 3's fee-hold reminder cadence (day 3, day 6 — column exists, logic
  doesn't) from dead config into a real send.
- Turns Phase 4's waitlist "offer made" step from a visible-in-portal callout staff
  act on by hand into an actual outbound message.
- Portal notifications stay on regardless (per `plan.md`'s settings table); this
  item is specifically about external channels.

### A3. Entrance Auto-Evaluation (`plan.md` Phase 6b-ii) — blocked

**Blocking decision (open in `decisions.md`):** how a candidate's answers get
captured at all — (a) staff transcribes marked options from a paper answer sheet
for the system to score, or (b) build a candidate-facing digital test-taking flow
first (this codebase has no candidate portal today — see A-note below, this is the
same gap as B1). (b) is materially bigger than "add auto-grading" — closer to a
second product surface.

**Recommendation, unchanged from `decisions.md`:** don't build this until there's
a concrete reason 6b-i (manual marks entry + pass/fail threshold, already shipped
and verified live) isn't enough. If it is wanted, (a) is the lower-lift path and
doesn't require B1 to exist first.

### A4. Small fast-follows — status as of 2026-08-25

| Item | Status |
|---|---|
| `created_by`/`updated_by` on `admission_cycles`, `admission_slots`, `admission_class_settings`, `admission_document_requirements` | ✅ **Shipped 2026-08-25** — migration `20260830220000_admission_config_audit_columns.sql`, wired into every write site, verified live |
| Settings-edit UI for fee-hold duration/grace, waitlist response days, stage-aging threshold, occupancy thresholds | ✅ **Shipped 2026-08-25** — combined `GET`/`PATCH /admission/admission-settings`, new Settings tab, verified live |
| Backfill seeded applications with a stale `status` column | ✅ **Shipped 2026-08-25**, but caught a real bug along the way: the leftover script predated the fee-sequencing rework and initially mis-set 4 real applications to `admitted` with no fee collected and no student record — caught by cross-checking `fee_paid_at`/`students` before moving on, corrected to `fee_pending`. See `plan.md`'s 2026-08-25 entry for the full account. |
| Remove dead `admission_applications.status` enum values (`counselor_approved`, `documents_verified`, `fee_paid`, `principal_approved`) | ❌ **Not dead — this plan's earlier claim was wrong.** Checked live: 17 real rows still carry these four values. Given the backfill incident directly above, this needs a careful per-row remap (real `fee_paid_at`/student-record state per row), not a constraint drop. **New, real item, not a trivial cleanup — re-scope before attempting.** |
| Roll `classLabel()`/`class_display_style` out past the admission module | Not started — confirmed still admission-module-only. Genuinely medium-sized (many files, each a small swap, no schema change) — next in line within A4, not attempted this pass. |

### A5. Open policy decisions

Three of four resolved 2026-08-25 (see `decisions.md` for the authoritative
record — status kept there, not duplicated here beyond this summary):

| Decision | Status |
|---|---|
| Approval chain depth: configurable per class, or only per school globally? | Still open — no build blocked on it yet |
| Is e-signature required on the offer letter, or is the current HTML/print document sufficient for v1? | **Decided: printable document is sufficient for v1.** Section B5 below closed as a result — see there. |
| RTE/sibling/staff quota: enforced as a hard cap at admission time, or advisory only? | **Decided: advisory only**, matching current practice. No build required. |
| Audit scope: is the plain-column convention (`*_at`/`*_by`/reason) enough, or is real immutable event-log infrastructure wanted? | Still open — no such infrastructure exists anywhere in this codebase today |

Also confirmed 2026-08-25: both vendor-blocked items (A2 notifications, B2
payment gateway) stay deliberately parked — the user was asked directly
whether to name a provider for either now, and chose to leave both blocked
rather than pick one. Not an oversight; re-visit when there's an actual
provider decision to make.

---

## Section B — Close the competitive gaps

From the 2026-08-25 comparison against Fedena, Meritto, OpenApply, and
SchoolAdmin/Veracross/Ravenna. None of these were in the original 10-phase plan —
they're new scope, not missed scope. Each entry states what exists today, what's
actually missing, and what it depends on, so none of these get built as a bigger
rewrite than the gap requires.

### B1. Parent self-service status portal — ✅ shipped 2026-08-25

Built on the recommended tokenized-link approach — the inquiry's own v4 UUID
`id` doubles as the access token, never a real parent account (still a
separate, bigger initiative if ever wanted). New `GET
/schools/:schoolId/inquiries/:inquiryId/status` and `POST
.../documents` (public), new `frontend/app/apply/[schoolId]/status/[inquiryId]/page.tsx`,
linked from the form's own success screen. Verified live end-to-end: status
view before/after conversion to an application, document upload flipping the
checklist, and the parent-uploaded document confirmed visible (and
verifiable) on the authenticated admin side. Also fixed a real pre-existing
bug found along the way — the form's success screen never actually rendered
the reference number it claimed to (`res.data?.inquiry_number` against a
flat response body). See `plan.md`'s 2026-08-25 "Parent self-service status
portal" entry for the full account.

### B2. Admission-fee payment gateway, wired into the fee-pending step

**Today:** `POST /applications/:id/collect-fee` records that a fee was paid
(method, reference, amount, who collected it) — it doesn't process a payment. The
main Fee module has real gateway plumbing (`fee_gateway_and_bounce` migration),
but it's a separate system built for recurring school fees, not this one-time
admission fee, and isn't wired to it.

**Gap:** an actual online payment flow for the fee-pending step — split
payments, discounts/vouchers, and late-fee logic the way Meritto's does, are the
specific features named in the comparison.

**Depends on:** a payment-gateway provider decision — same shape of blocker as
Phase 8's SMS/WhatsApp provider, and possibly the same underlying gateway the Fee
module already integrates, in which case this is "point the admission fee step at
existing gateway plumbing" rather than a second integration from scratch. Worth
checking against the Fee module's actual gateway code before scoping further.

### B3. Interview/exam slot self-booking (parent-facing) — ✅ shipped 2026-08-25

Extended the B1 status page rather than a separate surface, per this
section's own scoping note. New `GET .../slots` and `POST
.../slots/:slotId/book` (public), strictly class-filtered like the
staff-side booking dropdown, reusing the same capacity-enforcement and
entrance-exam status-advance logic as the authenticated endpoint — plus an
explicit duplicate-booking guard neither endpoint had before. New
"Available Slots" section on the status page. Verified live end-to-end:
class-strict filtering, capacity enforcement (a second candidate correctly
rejected from a now-full slot), duplicate-booking rejection, and the
status-advance side effect. See `plan.md`'s 2026-08-25 "Parent-facing slot
self-booking" entry for the full account.

### B4. Lead-source / conversion funnel analytics — ✅ shipped 2026-08-25

`GET /inquiries/stats` now accepts `academic_year_id` and returns, per source,
inquiry count / reached-application count / admitted count / conversion rate —
not just a raw lead count. `PipelineCharts.tsx` (Pipeline tab) gained a
"Conversion by Source" table below the existing charts. Verified live against
real data (44 inquiries / 9 sources unfiltered, correctly narrowed by year).
See `plan.md`'s 2026-08-25 entry for the full account.

### B5. e-Signature on offer letters — closed, no build needed

**Decided 2026-08-25:** the current printable HTML offer letter is sufficient
for v1 — the user confirmed directly rather than leaving this to a guess.
e-signature capture remains a real, separate initiative if ever wanted later,
but nothing here is scoped or pending.

---

## Suggested sequencing

Ordered by what's actually buildable now vs. what's waiting on a decision someone
outside this codebase has to make:

1. **A4 fast-follows** — ✅ mostly done 2026-08-25 (see status table above; one
   item re-scoped, one still open).
2. **A1 RBAC Finalization** — ✅ shipped 2026-08-25, unlocking cleaner role
   gating for everything after it (including B1/B3 if a parent ever needs a
   real role, not just a token link).
3. **B4 Conversion analytics** — ✅ shipped 2026-08-25.
4. **B1 Parent self-service (tokenized-link scope)** — ✅ shipped 2026-08-25.
5. **B3 Slot self-booking** — ✅ shipped 2026-08-25.
6. **A5 policy decisions** — ✅ three of four resolved 2026-08-25 (e-signature,
   RTE quota enforcement, and confirming the two vendor blockers stay parked).
   Approval chain depth and audit-log scope remain open, neither blocking
   anything currently in flight.
7. **A2 Notifications** and **B2 Payment gateway** — confirmed 2026-08-25 to
   stay deliberately parked, not an oversight. Re-visit once there's an actual
   provider decision to make; the two are still the highest-leverage items on
   this list once unblocked (real reminders, real online fee collection).
8. **B5 e-Signature** — ✅ closed 2026-08-25, no build needed. **A3
   Auto-evaluation** — still open, unchanged: build only if a concrete reason
   emerges that 6b-i's manual marks entry isn't enough.

---

## What this document does not do

It doesn't re-decide anything `decisions.md` already has open — those decisions
are listed here for completeness (so this reads as a full picture of what's left)
but their resolution belongs in that file, not this one. Update `decisions.md`'s
Status column when one lands, the same convention it already documents.
