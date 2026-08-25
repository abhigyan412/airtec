# Admission Module — Implementation History (Phase 0-2, shipped)

> Recovered file. The original `PLAN.md` was accidentally overwritten when a
> later file named `plan.md` was created in this same directory — on this
> Windows filesystem, `PLAN.md` and `plan.md` are the same file (case-insensitive
> lookup), so the write silently replaced it instead of creating a second file.
> It was never committed to git, so this is reconstructed from conversation
> history rather than restored from version control. Kept under a
> case-distinct name from here on to avoid the same collision happening again.

Derived from the competitive audit (AIRTEC vs. Fedena, Meritto, LeadSquared/Slate, OpenApply, Blackbaud EMS, Veracross, SchoolAdmin, Ravenna, Finalsite). Scope is strictly `backend/src/modules/admission` and its matching frontend surface — other modules (fee, RTE, attendance, SIS) are only ever touched through their existing public routes, never modified.

Status tags used below: `[new]` no code exists yet · `[wire]` schema/column already exists, needs routes/logic · `[expose]` logic already exists, needs a school-facing setting.

## Phase 0 — Cleanup & foundation

- [x] Remove or archive the stale duplicate router at `src/modules/admission/routes.ts` (root, 696 lines, pre-dates the live 1218-line `backend/src/modules/admission/routes.ts`). Confirmed untracked by git and never built/deployed (`render.yaml` rootDir: `backend`) — deleted along with its now-empty parent folder. The other 8 orphaned module folders under root `src/` were left untouched (out of scope for admission-only work).
- [x] `[new]` Admission cycle gating — new `admission_cycles` table (school_id, academic_year_id, opens_at, closes_at, unique per year). `POST/GET/DELETE /admission-cycles` manage it; `POST /inquiries` and `POST /applications` reject writes outside an active window via `checkAdmissionCycleOpen()`. No row for a year = always open (permissive default).
- [ ] Retire the four dead legacy statuses (`counselor_approved`, `documents_verified`, `fee_paid`, `principal_approved` on `admission_applications.status`) — deferred. Confirmed dead (frontend comment: nothing writes them; real status lives in `workflow_instances`), but altering a `CHECK` constraint on a populated `NOT NULL` column wasn't required for Phase 1 and carries its own risk. Revisit in a later pass.

## Phase 1 — Close existing stubs (P0, blocks basic parity)

1. **Document upload & verification** `[wire]` — ✅ done
   - `POST/GET /applications/:id/documents`, `PATCH .../documents/:docId` (verify/reject), `DELETE .../documents/:docId`.
   - Follows the exact base64-body upload pattern already used for `student-documents`/`staff-documents` (`sis/routes.ts`) — no multer, public Supabase Storage bucket (`admission-documents`), `getPublicUrl()`.
   - Intentionally **not** auto-wired to `documents_submitted`/`documents_verified` inquiry statuses — deciding "which documents are enough" needs the per-class required-document config from Phase 3. Staff still set inquiry status manually.

2. **Application fee** `[wire]` — ✅ done, scope changed from the original plan
   - Investigation found `fee_invoices.student_id` is `NOT NULL`, and an application has no student until admitted — so routing through the Fee module (`fee_invoices`/`fee_adhoc_charges`) isn't possible without either a placeholder student or a Fee-module change, both rejected to keep the "other modules untouched" rule.
   - Decision: `POST /applications/:id/collect-fee` is **admission-internal only** — sets `application_fee_paid`, `application_fee_amount`, plus new audit columns (`fee_paid_at`, `fee_payment_method`, `fee_payment_reference`, `fee_collected_by`). Not an accounting entry, no ledger involvement.

3. **Real follow-up communication** `[new]` — deferred
   - No SMS/WhatsApp/email provider has been chosen yet (Gupshup/Twilio/MSG91/etc. still an open question below). Decided not to build a scaffold-only adapter ahead of that choice — nothing to build without real credentials to integrate against. Still the highest-leverage remaining P0 item once a provider is picked.

## Phase 2 — Mid-market parity (P1)

1. **Entrance test / interview scheduling** `[new]` — ✅ done
   - `admission_slots` (generic `slot_type`: entrance_exam/interview/campus_tour — Phase 3's tour booking reuses this, not a second system) + `admission_slot_bookings`.
   - `GET/POST/PATCH/DELETE /admission-slots`, `POST /admission-slots/:id/book` (enforces capacity, not just displays it), `GET /admission-slot-bookings`, `PATCH /admission-slot-bookings/:id`.
   - Booking an inquiry into an `entrance_exam` slot auto-advances its status to `entrance_exam` if it's still early in the funnel (`new`/`follow_up`/`interested`) — never regresses a status already further along.

2. **Offer letter → binding acceptance** `[new]` — 2a done, 2b deferred
   - Confirmed there's no PDF library anywhere in this app — every printable document (certificates, TCs, HR offer letters) is server-rendered HTML with a print button, in `backend/src/modules/documents/routes.ts`. Followed that exact convention.
   - `POST /applications/:id/issue-offer-letter` (admission module) stamps an `OFR...` number via the existing `nextDocumentNumber` sequence, gated on the application being `admitted`. `GET /admission-offer-letter/:application_id` (documents module) renders it — a distinctly-named route from the pre-existing HR `/offer-letter/:application_id`, which is for `job_applications`, not admission (same word, different subsystem — confirmed before naming this to avoid a collision).
   - This is the first (and so far only) piece of admission work that touches a file outside `admission/` — done with the user's explicit go-ahead, following the established issue-vs-render split used everywhere else in this app rather than inventing a new pattern.
   - E-signature (binding acceptance) still deferred — needs a provider decision, same class of open question as SMS/WhatsApp.

3. **Waitlist state** `[new]` — ✅ done
   - `waitlisted` added to `admission_inquiries.status`, plus a `waitlist_rank` column. Settable through the existing `PATCH /inquiries/:id`.
   - Auto-promotion when a seat frees up is **not** implemented — deciding the trigger rule (on reject only? on withdrawal too?) is a judgment call left for later, same as the legacy-status cleanup.

4. **Seat cap wired into the pipeline** `[wire]` — ✅ done
   - `getClassSeatAvailability()` derives capacity (sum of `sections.max_strength`) − enrolled active students − applications still in flight (not yet `admitted`/`rejected`).
   - `GET /admission-seats` surfaces the per-class breakdown; `POST /applications` now blocks new applications for a class with zero seats left, suggesting the requester waitlist the inquiry instead. A class with no sections configured (capacity 0) is treated as unlimited rather than blocked.
   - Enforcement is at application-creation time only — not re-checked at final workflow approval. A low-probability race (two applications approved back-to-back past capacity) is possible; noted, not fixed this pass.

**Aside — pre-existing issue found, unrelated to this work**: `backend/src/shared/types/database.ts` (the generated Supabase types file `shared/db/client.ts` imports) doesn't exist anywhere in the repo, and never has. This makes `npx tsc --noEmit` report thousands of type errors across virtually every module (not just admission) — confirmed harmless for now (the app runs via `tsx`, which transpiles without type-checking, and `npm run build`'s `tsc` still emits working `dist/` output despite the errors), but real type-checking is effectively off repo-wide until someone runs `supabase gen types typescript` against the live project and commits the result. Out of scope for admission work; flagging so it doesn't get mistaken for something this session broke.

## Phase 3 — Differentiators (P2) — not started

1. **Configurable settings surface** `[expose]` — school admin UI + backend for:
   - Admission cycle open/close per academic year (Phase 0's gate, made editable)
   - Per class: is an entrance test required, is an application fee required and how much, which documents are mandatory
   - Approval chain depth — the generic workflow engine already supports custom steps; today no school can edit its own chain
   - Quota categories (RTE / sibling / staff / general) applied at seat-allocation time — distinct from the Fee module's billing-side category enum

2. **Shareable QR / public inquiry link** `[new]`
   - Public, unauthenticated `POST /public/inquiries` (rate-limited, bot-protected), pre-tagged with `school_id` + `source_id` from `inquiry_sources`.
   - QR is just that URL rendered as an image in the admin UI — no separate subsystem.

3. **Custom form fields** `[new]`
   - No dynamic-field pattern exists anywhere in AIRTEC today; forms are fixed columns.
   - New `admission_form_field_definitions` table (school-scoped: key, label, type, required, applies-to-class), submitted values stored as JSONB — the one place JSONB is justified here, since the field set is genuinely dynamic per school.

4. **Family / sibling linking** `[new]`
   - Siblings are currently two unrelated inquiries. Add a family grouping (new table or a `family_id` linking column) so a parent portal can manage every child under one login.

5. **School-run financial aid / scholarship request** `[new]`
   - Distinct from RTE government reimbursement (which lives entirely in the Fee module). A school-side request + review flow inside the admission pipeline itself.

6. **Lead scoring & counselor performance** `[new]`
   - Derivable from existing `counselor_id` + follow-up history; needs a scoring rule config per school and a reporting view.

7. **Parent/applicant self-service portal** `[new]`
   - The umbrella surface: status tracking, document upload, fee payment, and a guided task checklist ("what's left to do"), with the QR link, family accounts, and public inquiry endpoint all plugging into it.

## Frontend UI — done

Everything shipped in Phases 0-2 now has a UI, organized the same way as Fees/Staff-HR/Timetable: a sidebar `children` group (`components/layout/Sidebar.tsx`) plus a route-group tab bar (`app/(app)/admission/layout.tsx`, copied from `fees/layout.tsx`). New pages: `/admission/seats`, `/admission/cycles`, `/admission/slots`. New sections on `admission/applications/[id]/page.tsx`: Documents, Fee Collection, Offer Letter. New shared `components/admission/SlotBookingCard.tsx`, used on both the inquiry and application detail pages. `admission/[id]/page.tsx`'s status picker got the missing `waitlisted` entry. One small backend addition alongside it: `GET /admission-slot-bookings` gained a `slot_id` filter (needed for the Slots page's per-slot bookings view), plus joined inquiry/application names into the response.

## Sequencing rationale

Phase 1 items are prioritized because their schema already exists — closing them is a linking problem, not a build-from-scratch one. Phase 2 brings AIRTEC to feature parity with Fedena/Meritto. Phase 3 is what separates AIRTEC from the India-market set and starts closing the gap with global independent-school platforms (OpenApply, Veracross, SchoolAdmin).

## Open questions for stakeholders (carried forward into decisions.md)

- Should approval chain depth be configurable per class, or only per school globally?
- Is e-signature a hard requirement, or is a generated PDF sufficient for a v1 offer letter?
- Which SMS/WhatsApp provider should Phase 1's communication integration target (e.g. Gupshup, Twilio, MSG91)?
- Should quota categories (RTE/sibling/staff) be enforced as hard caps at admission time, or advisory only, given the existing RTE module doesn't currently enforce its own 25% cap either?
