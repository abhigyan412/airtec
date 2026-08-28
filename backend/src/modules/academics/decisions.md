# Homework Module — Decisions Log

Companion to `plan.md`. That document is the *how*; this is the *what's
actually undecided and who decides it*. Nothing here is a technical
implementation choice — everything below is a business-policy or ownership
question `plan.md` correctly refuses to answer on its own, per its own
guiding principle: if two schools could reasonably want a different answer,
it's a setting, not code. Mirrors the structure of
`backend/src/modules/admission/decisions.md` deliberately, not by accident —
same convention, applied to a different module.

Each row ships with a stated default so the system works before anyone
configures anything. "Status: open" means the default is a placeholder, not a
recommendation — build against it, but don't treat it as decided.

---

## Standing principles (decided, not open)

1. **Settings over hardcoded rules.** Adopted from Admission — kept.
2. **Extend, don't duplicate.** `homework_students` gets new columns, not a
   new table; submission uploads reuse the proven base64 pattern from
   Admission's document uploads, not a new mechanism.
3. **A dead write-path outranks new surface area.** Confirmed in `plan.md`
   Phase 1/2 — closing the submission/grading gap comes before any Tier-3
   standout work, including the syllabus cross-link.

---

## Blocking decisions

These aren't settings with a safe default — building ahead of an answer
risks a rebuild, not a config tweak later.

| Decision | Why it blocks | Options | Recommendation |
|---|---|---|---|
| **Is the parent/student portal login-provisioning gap actually fixed?** | Verified 2026-08-26: `resolveOwnStudentId` (`shared/utils/helpers.ts:96-109`) returns null — i.e. denies access — until `students.user_id`/`parents.user_id` are populated by something other than demo seed data. No such flow existed in `sis`, `admission`, or `team` routes as of that read. Every phase in `plan.md` that touches the portal (1, 2, 6, 8) would have been dead code for a real school without it. | (a) Confirm/build it before starting Phase 1. (b) Leave it open, build homework's portal-facing phases against a known-broken dependency. | **Resolved 2026-08-27 — built (a).** `POST /students/:id/portal-login` ships in `plan.md` Phase 0, live-verified: a real student login resolves via `GET /students/me`, a real parent login gets a real `200` from `GET /academics/homework`. Phases 1, 2, 6, 8 are unblocked. |
| **Grading model: accept/reject, or marks + written feedback?** | Changes the schema Phase 2 ships. Fedena does the former; Teachmint and Google Classroom do the latter (Classroom adds reusable rubrics on top). Picking wrong means a follow-up migration, not a setting flip — `marks_obtained`/`max_marks` either exist or don't. | (a) Accept/reject + optional text feedback only (simpler, matches Fedena). (b) Numeric marks + written feedback (matches Teachmint/Classroom, more work, more familiar to a teacher who's used either). (c) Both — a per-assignment or per-school toggle between modes. | **Resolved 2026-08-27 — (b).** `marks_obtained`/`max_marks`/`feedback` shipped on `homework_students` in Phase 2. |
| **Submission storage: new `homework-submissions` bucket, or reuse `admission-documents`?** | Phase 1 needs to pick before the first upload. Reusing `admission-documents` means homework files sit under a bucket whose storage policies were written for a different data-sensitivity and retention context (admission documents, tied to a formal application record with its own audit trail). | (a) New `homework-submissions` bucket, mirroring the existing `admission-documents` bucket's pattern but with its own policies. (b) Reuse `admission-documents`, path-namespaced by `homework/...`. | **Resolved 2026-08-27 — (a).** New `homework-submissions` bucket, same public-read pattern as `admission-documents`/`staff-photos`. |
| **Originality/AI-authorship signal: build, and if so, how?** | Not a setting — "what counts as flagged" and "false-positive tolerance" are product decisions that change what gets built, the same way Admission's marks-entry auto-evaluation decision did. No competitor benchmarked (AIRTEC included) does AI-authorship detection at all; Google Classroom's Originality Reports only cover web/prior-submission overlap, not AI-generated text. | (a) Skip entirely for v1 — text-submission originality isn't proven demand yet, just a benchmarking observation. (b) Web/prior-submission overlap only, Classroom-style (needs a text-comparison approach or third-party API — not scoped). (c) AI-authorship detection specifically (needs a detector API decision — not scoped, and these tools have real false-positive rates worth being cautious about before shipping a flag that could wrongly accuse a student). | **Confirmed 2026-08-27 — (a), explicitly re-asked and re-decided, not left stale.** Presented all three options directly; user chose to keep it parked rather than build (b) or (c). Same posture Admission took on e-signature: not needed for v1, not an oversight. Revisit only if a specific school asks. |

---

## Per-phase settings — carried from the plan, status marked

Everything below already has a safe default in `plan.md`. Listed here so
there's one place to see what's actually been confirmed by a stakeholder vs.
still running on the placeholder default.

### Phase 1 — Submission — ✅ shipped 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Storage bucket | `homework-submissions`, new | **Shipped as decided.** |
| Who can submit on a student's behalf (staff-recorded, e.g. a physical paper handed in) | Any role holding `homework.create` | **Shipped as the placeholder default** — not yet confirmed with a stakeholder, but live and working |

### Phase 2 — Grading — ✅ shipped 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Grading model | Marks + feedback | **Shipped as decided.** `marks_obtained`/`max_marks`/`feedback` all live. |
| Who can grade | Any role holding `homework.create` (i.e. the same teachers who can assign) | **Shipped as the placeholder default** — not yet confirmed with a stakeholder, but live and working |
| Notification on grading | On, best-effort (matches `homework_assigned`'s existing pattern) | **Shipped as decided.** |

### Phase 3 — Edit — ✅ shipped 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Who can edit | Same roles as `homework.create` | **Shipped as the placeholder default** — not yet confirmed with a stakeholder, but live, working, and RBAC-backfilled onto every existing school |
| Can `assignment_type`/targets be edited | No — out of scope this phase | **Shipped as decided.** |

### Phase 6 — Late submission — ✅ shipped 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Accept submissions after due date | On (permissive) | **Shipped as the placeholder default** — not yet confirmed with a stakeholder, but live, working, and enforced (turning it off actually blocks the submit endpoint, verified live) |
| Grace period before flagging late | 0 days | **Shipped as the placeholder default.** |

### Phase 9 — Resubmission — ✅ shipped 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Resubmission allowed after grading | Off | **Shipped as the conservative default** — the one deliberately-off toggle in this module, unlike most others; live and enforced (verified both directions: blocked when off, clears the grade correctly when on) |
| Settings page placement | Undecided — new "Academics Settings" surface vs. folding into an existing one | **Resolved 2026-08-27 — folded into the existing Phase 6 `homework-settings` card.** Three toggles didn't justify a new page. |

### Phase 10 — Syllabus cross-link — ✅ shipped 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Is `chapter_id` on `homework` required when assigned from a chapter | No — nullable, optional | **Shipped as decided.** |

### Phase 12 — Originality signal — parked, confirmed 2026-08-27

| Setting | Default | Status |
|---|---|---|
| Build at all | No | **Resolved — see blocking decision above.** Not skipped by default/inertia — explicitly re-asked 2026-08-27, and the answer was to keep it parked. Revisit only on explicit ask from a real school. |
