# Result Settings — a fully configurable results engine (board-agnostic)

## Context

Every Indian school's actual result rules differ — not just across CBSE vs
ICSE, but school-to-school, class-to-class, even subject-to-subject.
`computeGrade()` (`exam/routes.ts`) was one hardcoded percentage-band function
used unconditionally for every school, every class, every subject, with no
way to configure pass criteria, grading scale, theory/practical splits,
composite terms, or any of the real edge cases (no-detention up to Class 8,
best-of-N subjects, compartment, attendance eligibility, grace marks,
subject groups, additional-subject substitution).

This is a generic rules engine, not board-specific special-casing: every
decision in how a result computes is a configurable field, resolved per
school → per class → per exam type → per subject → (where needed) per
student. `schools.affiliation_board` stays free text; the engine never
branches on it. Board presets (CBSE/ICSE/generic) are a one-time "apply and
edit" convenience layered on top (Phase 7), never a gate on what a school
can configure.

Full design, every table/route/decision, and the phased build order live in
the approved plan this was built from (see chat history 2026-08-29). This
file tracks build progress and the verification evidence for each phase, in
this module going forward.

## Phase 0 — Groundwork (2026-08-29) — shipped

New permission `exam.result_settings_manage`
(`20260831000000_result_settings_permissions.sql`), added to
`PHASE2_MANAGEMENT` in `rbac/seed.ts` (School Admin/Principal/Vice
Principal) and explicitly to `Exam Controller`'s array, plus a live-data
backfill for every existing school — same two-step pattern
`20260808000000_rbac_phase2_permissions.sql` established.

## Phase 1 — Schema (2026-08-29) — shipped

Three migrations, all purely additive, zero rows changing existing
behavior:
- `20260831010000_result_settings_schema.sql` — `exam_grade_scales` /
  `exam_grade_bands`, `exam_remarks_rules` / `exam_remarks_bands`,
  `exam_class_result_rules`, `exam_subject_result_overrides`. Seeds two
  system scales ("Generic (Legacy Bands)" matching `computeGrade()` exactly,
  "CBSE 9-Point CGPA") and one system remarks rule — none read by default.
- `20260831020000_exam_subjects_practical_split.sql` — theory/practical
  columns + `is_additional` on `exam_subjects`; matching split columns +
  `grace_marks_applied`/`result_status_override` on `student_marks`;
  `overall_cgpa`/`result_status`/`grace_marks_applied_total`/
  `remarks_source` on `report_cards`.
- `20260831030000_result_groups.sql` — `result_groups`,
  `result_group_exams`, `result_group_subjects`,
  `result_group_subject_marks`, `result_group_cards` — mirror
  `exams`/`exam_subjects`/`student_marks`/`report_cards` exactly, for
  composite "Term" results (Phase 6).

Rule rows are keyed on `exam_type` (the enum already on every `exams`
row), not a template FK — `exams` has no column recording which
`exam_templates` row it came from, and most exams are created from
scratch. Confirmed with the user during planning before building.

## Phase 2 — Backend computation core (2026-08-29) — shipped

New files:
- `services/resultComputation.ts` — pure functions, no DB calls.
  `computeGrade()` moved here **verbatim** (byte-identical fallback
  guarantee); `LEGACY_CLASS_RULE`/`LEGACY_SUBJECT_RULE` sentinels reproduce
  today's exact math for any class with zero configured rows (integer
  `Math.round` percentage via `rounding_decimals: 0`, aggregate pass check
  against `sum(subject.pass_marks)` via `aggregate_pass_percent: null`,
  `'Promoted'`/`'Detained'` remarks). Full pipeline:
  `computeReportCard()` — eligibility → per-subject outcomes (plain /
  theory+practical / grade_only / manual override) → subject groups →
  best-of-N → additional-subject substitution → aggregate → grading →
  compartment → no-detention override → remarks.
- `services/resultComputation.test.ts` — 26 unit tests (vitest), covering
  the legacy fallback exactly, per-subject pass criteria, theory/practical
  splits, grade_only exclusion from the aggregate, best-of-N, substitution,
  compartment, no-detention, attendance eligibility.
- `services/resultRuleLoader.ts` — DB-aware loaders
  (`loadClassRules`/`loadSubjectOverrides`) that join grade-scale/remarks
  bands and build the `Map` inputs the pure resolvers expect.
- `resultSettings.routes.ts` — full CRUD for grade scales (+ bands),
  remarks rules (+ bands), class rules (default + per-exam-type rows),
  subject overrides. Mounted at `/exams/result-settings`. Reads gated
  `exam.view`, writes gated `exam.result_settings_manage`.

Modified in `exam/routes.ts`:
- `GET /:id/marks/:class_id` — now also returns the resolved class rule +
  per-subject rules for that class/exam-type.
- `POST /:id/marks` — resolves the effective subject rule once; branches
  theory/practical split, `grade_only`, or plain marks; derives grade via
  `gradeForPercent()`.
- `POST /:id/generate-results` — resolves rules **per student's own
  `class_id`** (an exam can span multiple classes; each student's
  aggregate now only ever uses their own class's subjects — a real
  correctness fix over the previous flat-list-shared-by-every-student
  behavior, found while building this), delegates arithmetic to
  `computeReportCard()`.
- The now-dead local `computeGrade()` definition was deleted (moved, not duplicated).

**Found and fixed in the same pass**: `generate-results`' `student_marks`
fetch had no pagination — Postgres/PostgREST's default row cap silently
truncated any exam with >1000 total marks rows (subjects × students) to
whichever ~1000 rows happened to sort first, silently dropping every
student past that point from their report card run. Same bug existed
identically in the pre-refactor code (not something this work introduced),
but directly adjacent to what was being touched, so fixed here rather than
filed separately — the three unbounded fetches in `generate-results` now go
through the existing `fetchAllRows()` helper (`shared/utils/helpers.ts`,
already used by `sis`/`principal`/`hrms` for exactly this).

### Verification

- 26/26 unit tests pass; full backend suite (`npx vitest run`) — 483
  passed, 1 pre-existing unrelated flaky timing test in the timetable
  engine (`engine.test.ts`'s realistic-scale perf assertion), 0 failures
  anywhere touched by this work.
- Byte-identical check against real production-scale data: for a real exam
  with 1120 students / 6400 marks rows / 86 subjects across 12 classes, the
  new pipeline (under `LEGACY_CLASS_RULE`) was compared row-for-row against
  the exact original inline formula, independently computed — **0
  mismatches across all 1120 students**, before and after the pagination
  fix (167/167 matched pre-fix on the then-truncated subset; 1120/1120
  matched post-fix at full scale).
- Rule isolation confirmed live: inserted a throwaway `no_detention` class
  rule for one class within that same multi-class exam, re-ran the
  computation — only that class's students showed the new
  `rounding_decimals: 2` percentage precision (e.g. `51.5`) and forced
  `is_pass: true`; every other class's students kept the exact legacy
  integer-percentage output. Throwaway rule deleted after.
- All throwaway verification scripts were scratch-only (`backend/scripts/`,
  never committed) and deleted after use.

## Phase 3 — Rule-editor UI (2026-08-29) — shipped

New page `frontend/app/(app)/exams/result-settings/page.tsx`, gated on
`exam.result_settings_manage`, three tabs:
- **Class Rules** — a "Default (all exam types)" card always shown per
  class, plus one card per exam-type override already added, each with an
  explicit Save; "Add exam-type override" offers only the types not yet
  configured, clones the default's shape as a starting point via
  `PATCH .../class-rules/:class_id?exam_type=X`; a trash icon on a
  type-specific card reverts it to inheriting the default
  (`DELETE .../class-rules/:class_id?exam_type=X`). Scoped this pass to
  the core fields — promotion policy, pass criteria mode (+ "also require
  aggregate" toggle), aggregate pass %, grading mode, grade scale. The
  edge-case fields already on the table (best-of-N, compartment,
  attendance eligibility, grace marks, rounding, remarks rule) get their
  own editor addition once Phase 5 wires the rest of the pipeline to them.
- **Subject Overrides** — one row per subject (sourced from
  `classesApi.subjects.list`, same convention as everywhere else in this
  app), collapsed by default, expanding to pass-criteria/grading-mode
  overrides (each independently "inherit or override") plus the
  `has_practical` toggle Marks Entry's theory/practical fields will read
  in Phase 4.
- **Grade Scales** — list of system + school-owned scales with their
  bands rendered as chips (red-tinted for non-passing bands); "New Scale"
  creates an empty custom scale, "Edit Bands" opens a full replace-all
  band editor (add/remove rows, save validates coverage server-side).
  Built-in scales show a "Built-in" badge and have no edit/delete actions
  (server-enforced too — `PATCH`/`DELETE`/`PUT bands` all 400 on
  `is_system`).

Sidebar: new entry in the Examinations group, right after Examination
Settings, same `lockUnless` pattern that entry already uses.

No dedicated `resultSettingsApi` wrapper was added to `lib/api.ts` —
the exam module's own existing pages (`exams/[id]/page.tsx`,
`exams/templates/page.tsx`) all call `api.get/post/patch/delete(...)`
directly with full paths, no per-module wrapper object exists for `exam`
at all, so this page matches that established local convention instead of
introducing a new one.

### Verification

- `npx esbuild` clean on the new page and `Sidebar.tsx`.
- Route-mounting smoke test: started the backend, confirmed every new
  `/exams/result-settings/*` path returns 401 (reaches the router's
  `authenticate` middleware) rather than 404, with a genuinely unmounted
  path (`/api/totally-fake-path`) confirmed to return a real 404 as the
  control — proves the new router is wired in correctly. Full logged-in
  click-through deferred (this session avoids calling the login endpoint
  — see prior Supabase Auth throttle finding); the class/subject rule
  precedence itself was already proven via the Phase 2 unit tests and the
  live rule-isolation test against real data.

## Phase 4 — Marks-entry UI (2026-08-29) — shipped

**Backend gap found and closed first**: `POST /exams/subjects/add` and
`PATCH /exams/subjects/:id` never accepted the theory/practical columns
added in Phase 1 — `CreateExamSubjectSchema`/`UpdateExamSubjectSchema` would
have silently stripped them (Zod strips unknown keys by default), so any
frontend UI for the split would have appeared to save and done nothing.
Added the four fields to both schemas; both routes now enforce
all-four-or-none and always server-recompute `max_marks =
theory_max_marks + practical_max_marks` on write, never trusting a
client-sent combined total (`PATCH` additionally supports clearing a split
back to a plain subject when all four are sent as explicit `null`).

`frontend/app/(app)/exams/[id]/page.tsx`:
- **`MarksEntry`** — reads the `class_rule`/`subject_rules` Phase 2 already
  added to `GET /:id/marks/:class_id`'s response. A split subject
  (`exam_subjects.theory_max_marks`/`practical_max_marks` both set) shows
  Theory + Practical columns, each with its own Absent checkbox, instead of
  one Marks column; a `grade_only` subject (from the resolved subject rule)
  shows a grade `Select` populated from that rule's own resolved
  `grade_bands` instead of a numeric input — no separate grade-scales fetch
  needed, since the rule endpoint already returns resolved bands, not just
  an id.
- **`AddSubjectModal`/`EditSubjectModal`** — "Split into Theory + Practical"
  toggle revealing the four fields + a live combined-max readout; `Add`
  pre-checks the toggle when Result Settings' Subject Overrides already has
  `has_practical: true` for that class+subject, so setting it up once
  there carries through to every future datesheet entry.
- **`ResultsView`** — a new `ResultStatusBadge` renders
  `result_status` (Pass/Fail/Compartment/Not Eligible/Withheld) instead of
  a flat pass/fail boolean, falling back to `is_pass` for any report card
  generated before this feature; `overall_cgpa` and grace-marks-applied now
  show inline when populated. (The rule-editor UI for actually configuring
  compartment/eligibility/grace marks is Phase 5 — this only makes
  `ResultsView` correctly render whatever `generate-results` computes,
  which it already has since Phase 2.)

`backend/src/modules/documents/routes.ts`'s printable report card
(`generateReportCard`) got the same `result_status`-aware label/color
treatment plus a CGPA/grace-marks line — the family-facing printable card
would otherwise have kept showing a flat "Fail" for a Compartment result.

### Verification

- `npx esbuild` clean on every touched file.
- Full `resultComputation.test.ts` suite re-run clean (26/26) after the
  schema changes.
- Live check against real tables: created a throwaway split
  `exam_subjects` row via the exact insert logic the route now runs —
  confirmed `max_marks` computed as 70+30=100, not the client-sent 999;
  then ran the exact clearing-split update logic — confirmed all four
  split columns null out and the plain `max_marks` from that same request
  takes over. Throwaway row deleted after.

## Phase 5 — Edge-case rules (2026-08-29) — shipped

**Backend**: new `PATCH /:id/marks/:student_id/:exam_subject_id/override`
— the one-off, per-student exception path ("Absent - Medical", "Result
Withheld", or a specific grace-mark award), separate from the bulk
`POST /:id/marks` sheet save. Always requires a `reason` (audit trail via
the existing `entered_by`), always touches exactly one of
`result_status_override`/`grace_marks_applied` per call — enforced by only
including whichever field was sent in the upsert payload, so a status-only
call can never wipe an existing grace-mark award or vice versa, and never
wipes existing `marks_obtained`/`grade` either, since Supabase's
`upsert(...).onConflict` only updates the columns actually present in the
payload. Gated on `exam.result_generate` (a results-level exception, not
day-to-day marks entry — different permission from `exam.marks_entry`).

**Frontend — Result Settings page**: Class Rules' `RuleCard` gained a
collapsed-by-default "advanced rules" section exposing every remaining
`exam_class_result_rules` field — best-of-N subject count, compartment
policy (+ max failed subjects), the additional-subject-substitution
toggle, minimum attendance %, grace-mark ceilings (per-subject and
total), percentage rounding (mode + decimals), and a remarks-rule picker.
Subject Overrides gained `is_additional`, `include_in_aggregate`, and a
free-text `subject_group_key` (two subjects sharing a key form a "pass at
least one" group — e.g. tagging Hindi and Sanskrit both `"language"`).
New **Remarks Rules** tab, same list+band-editor shape as Grade Scales,
mapping a result status (+ optional percentage range) to a free-text
remark.

**Frontend — Marks Entry**: a permission-gated "Override" action per
student row (`exam.result_generate`, same gate as the backend route)
opens `StudentOverrideModal` — a small form to set either a manual status
string or a grace-mark amount, with a required reason, calling the new
endpoint directly (separate from the bulk marks-sheet save).

### Verification

- `npx esbuild` clean on every touched file.
- `resultComputation.test.ts` re-run clean (26/26) — the edge-case
  computation logic itself (best-of-N, substitution, compartment,
  eligibility) was already covered there in Phase 2; this phase only adds
  UI and one new CRUD-shaped route on top of already-tested machinery.
- Live check of the new override endpoint's upsert semantics against a
  real `student_marks` row with real marks: confirmed a status-only
  override doesn't touch `marks_obtained`/`grade`; confirmed a
  grace-marks-only update doesn't touch an existing
  `result_status_override`; confirmed a plain marks-entry save is
  unaffected by either. Row restored to its original state after.

## Phase 6 — Composite terms (2026-08-29) — shipped

**One shared-function widening first**: `resolveEffectiveClassRule()`/
`resolveEffectiveSubjectRule()` (`resultComputation.ts`) now accept
`examType: ExamType | null` — `null` skips the type-specific lookup
entirely and resolves only the class's default rule. Needed because a
composite Term isn't any one of the 7 `exam_type` values; passing a real
type (even a plausible-looking sentinel) risked silently picking up a
type-specific override that shouldn't apply to it. Backward compatible —
every existing caller still passes a real `ExamType`.

**New `resultGroups.routes.ts`**, mounted at `/exams/result-groups`:
CRUD for `result_groups` and their member exams (`weight_percent` per
member); `POST /:id/subjects/sync` unions member exams' `exam_subjects`
(scoped to the group's own `class_id`) into the curated
`result_group_subjects` list, additive only, safe to re-run;
`DELETE .../subjects/:subject_id`; `POST /:id/generate-results`; `POST
/:id/publish` (reuses `createNotifications`, same pattern as an exam's
own publish step); `GET /:id/results[/:student_id]` with the identical
staff-always / published+own-child-only gating `GET /exams/:id/results`
uses.

**`generate-results` algorithm**: validates member weights sum to 100%
and every member exam already has its own results declared, then for
each `result_group_subject` × student, blends that subject's percentage
across whichever member exams actually have a subject of that name *and*
a real mark for that student — weighted by each contributing exam's own
weight, renormalized by the weight that actually contributed (so a
student missing one member exam's mark isn't penalized as if it were a
zero). The blended per-subject marks are then fed through
`computeReportCard()` **unmodified** — the exact same function
`POST /:id/generate-results` uses for a single exam — resolved against
the class's default rule (`examType: null`, per the widening above), so
every edge case (per-subject pass criteria, best-of-N, compartment,
no-detention, grading mode/scale, remarks) already works for composite
terms with zero extra code.

**Frontend**: `exams/results/page.tsx` gained a Single Exam / Composite
Term toggle; Term mode is a class-scoped list of `result_groups` with a
"New Term" create action, linking out to each term's own detail page
rather than re-implementing the results table twice. New
`exams/result-groups/[id]/page.tsx`: member-exam list with inline weight
editing and an "Add Exam" picker, a subject list with a "Sync from
Member Exams" action, Generate Results (disabled until weights sum to
100% and every member is ready) and Publish actions, and a results view
mirroring `ResultsView`'s section-grouped, collapsible table.

### Verification

- `npx esbuild` clean on every touched file; `resultComputation.test.ts`
  re-run clean (26/26) after the `examType | null` widening.
- **Found and fixed a real bug in this phase's own new code, not a
  pre-existing one**: `generate-results`' three fetches
  (`exam_subjects`/`student_marks`/`students`) were written as plain
  unbounded `.select()` calls — the exact same 1000-row PostgREST
  truncation already fixed once in the single-exam route. Caught live: a
  throwaway 2-exam, 78-student, 12-subject-row composite term (936 total
  `student_marks` rows) silently blended using only ~1000/12 ≈ 83
  students' worth of marks before the fix. All three fetches now go
  through `fetchAllRows`.
- Full live end-to-end test against real data: created a throwaway
  Result Group for a real class, added two real member exams (Unit Test
  1 at weight 20%, Half Yearly at weight 80% — both already had results
  declared and shared the same 6 subjects), synced subjects, ran the
  exact `generate-results` algorithm, and hand-verified one student's
  blend by hand: `(47×20 + 73×80)/100 + (66×20 + 92×80)/100 + ... =
  418.20` obtained / 600 total = 69.7% → rounds to 70%, grade B, pass —
  matched the script's output exactly, digit for digit. Throwaway group
  deleted after (cascade — member exams, subjects, subject marks and
  cards all removed with it); confirmed zero rows left behind.

## Phase 7 — Presets (2026-08-29) — shipped

**New `services/presets.ts`** — five static, hand-authored presets, each
a class-range hint + a rule payload using exactly the same fields a
school could set by hand: `cbse_up_to_8` (no-detention), `cbse_9_10`
(per-subject pass, CGPA via the seeded "CBSE 9-Point CGPA" system
scale), `cbse_11_12` (per-subject pass, marks — CBSE issues no CGPA at
this level), `icse` (per-subject pass, marks throughout, no CGPA at any
level), `generic` (the exact legacy aggregate/33%/marks behavior, made
explicit and editable). A preset's `gradeScaleName` (never a raw id, since
ids don't exist until the Phase 1 seed migration has run) is resolved to
a real `grade_scale_id` at apply time by name-matching a system
(`school_id IS NULL`) scale.

**`GET /result-settings/presets`** (static list) and **`POST
/result-settings/presets/:key/apply`** (`{class_ids: []}`) added to
`resultSettings.routes.ts`. The apply route does **not** use
`.upsert()` — there's no plain `UNIQUE(school_id,class_id,exam_type)` to
target (only the Phase 1 partial indexes, which supabase-js's `upsert()`
can't address for the `exam_type IS NULL` case) — so, matching `PATCH
/class-rules/:class_id`'s own existing pattern, it checks each class for
an existing default row and explicilty updates or inserts.

**Frontend**: new "Apply Preset" tab on the Result Settings page —
preset cards, a class checklist ("Select suggested range" pre-checks
classes within the preset's `classRange`, still freely editable), and an
explicit overwrite-confirm dialog before applying, since this can replace
an already-configured class default.

### Verification

- `npx esbuild` clean on every touched file; `resultComputation.test.ts`
  re-run clean (26/26) — untouched by this phase, included as a final
  sanity check that nothing regressed.
- Live check against a real class: applied `cbse_9_10`, confirmed the
  new row's `grade_scale_id` correctly resolved to the real "CBSE
  9-Point CGPA" system scale's id (not a placeholder); re-applied a
  different preset (`generic`) to the same class and confirmed exactly
  one row still exists for that class's default afterward (update, not
  a duplicate insert). Row deleted after.

## Plan complete

All 8 phases (0-7) of the approved Result Settings plan are now shipped:
a fully configurable, board-agnostic results engine — pass criteria,
grading modes and scales, theory/practical splits, best-of-N, subject
groups, additional-subject substitution, compartment, attendance
eligibility, grace marks, configurable rounding, custom remarks,
per-student manual overrides, composite weighted terms, and one-click
presets — resolved per school → class → exam type → subject → student,
with every unconfigured class continuing to behave byte-identically to
the system as it existed before this feature, verified against real
production-scale data at every phase.

## Follow-up — Examination ↔ Result Settings total sync (2026-08-29) — shipped

Three real gaps found once the engine started getting used end-to-end:
Result Settings' Subject Overrides could only ever be pre-filled manually,
never auto-updated from a real datesheet or template; Theory and Practical
shared one date even when split, but real school datesheets hold them on
different days; and the Datesheet tab read as a flat date-grouped list
instead of a school's actual datesheet.

**Schema** — `20260831040000_exam_split_dates_and_template_marks.sql`:
`exam_subjects` gains `practical_exam_date`/`practical_start_time`/
`practical_end_time` (existing `exam_date`/`start_time`/`end_time` keep
meaning "Theory's schedule when split, the whole subject's when not" — no
rename); `exam_template_subjects` gains the same four split-marks columns
`exam_subjects` already had (still no date columns — a template is reused
across years, dates only ever exist on the real rows an apply creates).

**Auto-sync** — new `syncSubjectSplitOverride()`
(`services/resultRuleLoader.ts`) — same check-then-update-or-insert
pattern as `PATCH /class-rules/:class_id` (no plain unique index to
`.upsert()` against), touching only `has_practical` and never any other
field an admin already configured on that override. Wired into
`POST /subjects/add`, `PATCH /subjects/:id`, `POST /templates` (create),
and `POST /templates/:id/apply` (belt-and-braces, for templates
predating this feature) — a subject's split state on a real datesheet or
a template now always drives Result Settings, never the other way.

**Backend** (`exam/routes.ts`): `CreateExamSubjectSchema`/
`UpdateExamSubjectSchema` carry the three practical fields;
`CreateTemplateSchema`'s per-subject entries and `ApplyTemplateSchema`
carry the split-marks/practical-date fields; `POST /templates/:id/apply`
now carries theory/practical marks through from the template and
recomputes `max_marks` as their sum, matching `POST /subjects/add`'s
existing rule. `documents/routes.ts` admit cards (single + bulk) show
both dates for a split subject via a shared `subjectDateLabel()` helper.

**Frontend**: `AddSubjectModal`/`EditSubjectModal`
(`exams/[id]/page.tsx`) gain a Practical Date/Time picker alongside the
existing (now Theory-labelled-when-split) one. `TemplateSubjectRow`/
`ApplyTemplateModal` (`exams/templates/page.tsx`) get the same split
toggle + marks fields, and two date inputs at apply-time when split.
The Datesheet tab is rebuilt as a class-rows × date-columns grid — real
`<table>`, sticky first column, `bg-muted/50` header, subject-name-hashed
colour chips (`subjectColor()`, written locally rather than importing
`timetable/components.tsx` across module boundaries) — a split subject
with differing dates appears as two chips, the Practical one suffixed;
same-day or unsplit subjects render as one unsuffixed chip. The old
class/subject filter selects are gone — redundant once every class is
its own row.

### Verification

- `npx esbuild` clean on every touched file (`exam/routes.ts`,
  `resultRuleLoader.ts`, `documents/routes.ts`,
  `exams/[id]/page.tsx`, `exams/templates/page.tsx`).
- Live script (`backend/scripts/verify-sync.ts`, deleted after use)
  against real school/class data: `syncSubjectSplitOverride` creates a
  fresh override row on split=true, flips `has_practical` without
  touching a row's other configured fields (`pass_criteria_mode`,
  `subject_group_key`) on split=false, and is a true no-op (no clutter
  row) when syncing false against a subject with no existing override.
  A real split `exam_subjects` row persisted independent Theory/Practical
  dates with the correct summed `max_marks`. A template with split marks,
  applied with two different per-subject dates, produced a real
  `exam_subjects` row with both dates and the summed marks, and the
  create-time sync correctly set `has_practical` on the resulting
  override. All test rows deleted after.
- Full backend suite re-run after the change (`resultRuleLoader.ts`/
  `exam/routes.ts` edits) — no regressions.

## Follow-up — Result Settings default marks (2026-08-29) — shipped

The datesheet's Add Subject form had no memory of what a subject "should"
be worth — every new subject started from a generic 100/33 default
regardless of school policy (e.g. "Practical Examination English is
always /100"). `exam_subject_result_overrides` gains
`default_max_marks`/`default_pass_marks` (unsplit) and
`default_theory_max_marks`/`default_theory_pass_marks`/
`default_practical_max_marks`/`default_practical_pass_marks` (split) —
`20260831050000_subject_override_default_marks.sql`. Editable directly on
Result Settings' Subject Overrides tab; Add Subject now pre-fills from
them using the same exam-type-then-default precedence `has_practical`
already used.

New `fillSubjectMarksDefaults()` (`resultRuleLoader.ts`) — deliberately
NOT the same always-overwrite behavior as `syncSubjectSplitOverride`'s
`has_practical`: this only ever fills a still-null default field, never
overwrites one an admin (or an earlier auto-fill) already set. A school's
configured default marks are policy; one exam happening to use a
different total shouldn't silently redefine it. Wired into the same 4
call sites as the split sync, always run after it in the same request
(so a freshly-inserted override row is found rather than raced into a
second insert). Verified live: fresh insert fills correctly, an
admin-set default resists being overwritten by a different real number,
and a still-null field on an otherwise-configured row still gets filled.

Also, while diagnosing a "why is this 100?" question about a stale
datesheet row: Marks Entry's max-marks placeholder text disappeared the
moment a teacher typed a value, leaving no persistent indication of the
subject's actual max marks. Now shown in the column header ("Marks (out
of 100)") and as a fixed suffix beside every input, sourced from the
same real `exam_subjects.max_marks`/split fields Result Settings pre-
fills — not a new source of truth, just made visible.

## Follow-up — Strict exam lifecycle (2026-08-29) — shipped

Every stage of an exam was independently reachable with no ordering
enforced server-side: marks could be entered on a still-Draft exam,
results could be generated mid-Ongoing exam, and `PATCH /:id/status`
accepted any-status-to-any-status. The frontend's own Publish/Start/
Complete buttons already implied a strict staircase; the backend just
never enforced what they implied.

`PATCH /:id/status` now validates the transition against a fixed
sequence (`draft -> published -> ongoing -> completed`) — one step
forward only, no skipping, no going backward, and an exam already past
Completed (`result_declared` onward, set only by the result flow itself)
can't be touched by this route at all. `POST /:id/marks` now rejects
while Draft/Published ("numbers only fit in after the exam starts").
`POST /:id/generate-results` now requires `status === 'completed'`.
Frontend: the Generate Results button only shows once Completed (was
also showing at Ongoing); Marks Entry shows a clear "opens once the exam
starts" empty state instead of the class/subject pickers while Draft/
Published, matching the backend gate instead of letting a teacher fill
out a form that would just get rejected. Verified live against a real
exam moved through every stage.

## Follow-up — Composite Terms made discoverable + Theory/Practical fixed (2026-08-29) — shipped

Composite Terms (a weighted blend of several exams into one result — the
answer to "schools don't grade every exam standalone, Unit Tests fold
into Half Yearly, Half Yearly + Annual fold into the final card") were
fully built in the original Phase 6 but only ever reachable one click
deep inside Results' "Composite Term" toggle, with no direct nav entry.
`TermResultsBrowser` (the list/create UI) extracted into
`frontend/components/exams/TermResultsBrowser.tsx` so it's shared
between that existing toggle and a new dedicated `/exams/terms` page +
sidebar entry, rather than duplicated.

Real gap found while re-reading the composite generate-results logic: it
always flattened every subject to one plain percentage, even when member
exams recorded it as split Theory+Practical — meaning a school with
per-subject pass criteria (must pass both components separately) never
got that check applied at the Term level, only within each member exam's
own standalone result. Fixed:
- `result_group_subjects` gains the same four split-marks columns
  `exam_subjects` has; `result_group_subject_marks` gains
  `theory_marks_obtained`/`practical_marks_obtained`
  (`20260831060000_result_group_subject_split.sql`).
- `POST /:id/subjects/sync` now prefers a split representative over a
  plain one for the same subject name when scanning member exams (a
  split row carries strictly more information), carrying its
  theory/practical marks through.
- `POST /:id/generate-results`: a split Term-subject now blends Theory
  and Practical as two SEPARATE weighted averages across member exams,
  not one flattened number. A member exam that never split this subject
  itself (e.g. a Unit Test with one combined mark) has no per-component
  breakdown to contribute — rather than drop out of one channel, its
  single percentage counts toward BOTH Theory and Practical, so it still
  carries its intended weight instead of arbitrarily penalizing (or
  inflating) whichever component it can't speak to.

### Verification

- `npx esbuild` clean on every touched file.
- Live-data check: `fillSubjectMarksDefaults`/split-sync tests as above.
- Exam-lifecycle sequencing verified against a real exam moved through
  draft -> published -> ongoing -> completed, confirming marks-entry and
  generate-results gates fire exactly where expected.
- Term split-blend verified via the arithmetic feeding directly into the
  already-tested `computeSubjectOutcome()` (26 existing unit tests,
  untouched): a student scoring well overall but failing Practical badly
  (Theory 65/70, Practical 3/30, well above the 33-mark aggregate pass
  bar) now correctly fails under `per_subject` criteria — confirmed this
  would NOT have been caught under the old always-null-split behavior
  (explicit regression-guard assertion against the pre-fix shape).
- Full backend suite re-run after all three follow-ups — no regressions
  beyond one pre-existing, unrelated timing flake in the timetable engine
  test (documented earlier in this file as established environmental
  noise).

## Follow-up — Term Templates (2026-08-29) — shipped

Creating a composite Term was still fully manual every time: New Term,
then one at a time "Add Exam" + type a weight for every member exam,
then a separate "Sync Subjects" click. A school redoes this by hand
every year for every class. Term Templates let a school configure the
*structure* once ("Term 1 = Unit Test 1 20% + Unit Test 2 20% + Half
Yearly 60%") and apply it against a class in a couple of clicks —
mirrors Examination Settings' own Exam Templates
(blueprint -> apply -> real instance) one level up, for Result Groups
instead of real exams.

`20260831070000_term_templates.sql`: `term_templates` (school-owned,
named) + `term_template_slots` (`label`, optional `exam_type` hint —
never enforced, just pre-sorts the apply-time exam picker —
`weight_percent`, `sort_order`). New
`backend/src/modules/exam/termTemplates.routes.ts`, mounted at
`/exams/term-templates`: `GET /`, `POST /` (validates slot weights sum
to 100% ±0.01 before inserting, rolls back the template on a
slot-insert failure — same orphan-avoidance pattern `exam_templates`'
own creation route uses), `DELETE /:id` (no edit route —
recreate-only, matching `exam_templates`/`certificate_templates`),
`POST /:id/apply` (`{class_id, name, academic_year_id?, exam_ids: {slot_id: exam_id}}`
— validates every slot has an assigned exam and every exam_id belongs
to the school, then creates one `result_groups` row + one
`result_group_exams` row per slot with that slot's weight, then syncs
subjects).

`resultGroups.routes.ts`'s subject-sync logic (the split-representative
-preferring version from the previous follow-up) was extracted into an
exported `syncGroupSubjectsFromMembers(resultGroupId, classId)` so
`POST /:id/subjects/sync` and the new apply endpoint share one
implementation instead of two copies drifting apart.

Frontend: new "Term Templates" tab in `exams/result-settings/page.tsx` —
`NewTermTemplateModal` (name + repeatable slot rows, a running-total
footer that blocks Save until it reads exactly 100%, mirroring
`NewTemplateModal`/`TemplateSubjectRow` from Examination Settings) and
`ApplyTermTemplateModal` (pick class + Term name, then one exam-picker
per slot, matching-type exams sorted first) — on success routes
straight to `/exams/result-groups/:id`, same as Exam Template's own
apply flow.

### Verification

- `npx esbuild` clean on every new/edited file.
- Migration applied to local dev via the established convention.
- Live script: created a real 3-slot template (20/20/60, weights
  verified to sum to 100%), created 3 real exams, applied the template
  end-to-end against a real class — confirmed the resulting
  `result_groups`/`result_group_exams` rows carried the slot weights
  correctly and `syncGroupSubjectsFromMembers` (the actual shared
  function, not a re-transcription) produced the right synced subject.
  Confirmed a bad weight total and a left-unassigned slot are both
  correctly rejected. All test rows deleted after.
- Full backend suite re-run — no regressions.

## Follow-up — Term-member warning, then Term-only report cards (2026-08-30) — shipped

Two-part change resolving the parallel-publish-paths issue: an exam that
feeds a composite Term could still generate and publish its own
standalone percentage/report card, independent of the Term — a parent
could see two different numbers for the same subject/period.

**Part 1 (warning)**: `GET /exams/:id` now returns `term_memberships`
(which Result Groups this exam belongs to, via a
`result_group_exams.select('result_groups(id,name,status)')` lookup —
symmetric to the join `resultGroups.routes.ts` already used in the
other direction). Frontend: `TermMembershipWarning` (`exams/[id]/page.tsx`)
renders an `Alert` (existing shared component, not a new one) on the
Results tab when non-empty, naming the Term(s) and linking to them —
a hint only, never blocking Freeze/Publish.

**Part 2 (enforcement)**: explicitly decided via two AskUserQuestion
rounds — standalone exams (never a Term member) keep generating their
own report card as before (nothing else would ever compute a result for
them); ONLY the Generate Results step changes for a Term-member exam,
not the Results tab or per-subject marks-entry grading (both left
untouched, out of scope by explicit choice). `POST /:id/generate-results`
now checks `result_group_exams` for this exam_id first — if it's a Term
member, skips the entire percentage/pass-fail/rank computation
(`computeReportCard` never runs, no `report_cards` row is written) and
only flips `status` to `result_declared` directly, since that's the
Term's own precondition for treating the exam as ready. A standalone
exam is unaffected — full computation runs exactly as before. Frontend
button relabels to "Finalize Marks" (with an explanatory `title`) for a
Term-member exam, and the success toast reflects which path ran.

### Verification

- `npx esbuild` clean on every touched file.
- Live script: confirmed the membership-check query resolves correctly
  in both directions (no membership -> nothing found; real membership ->
  resolves the real Term). Ran the exact new short-circuit logic against
  real exam/subject/student rows: a Term-member exam's status flips to
  `result_declared` but produces zero `report_cards` rows; a standalone
  exam's membership check correctly finds nothing (existing, unchanged
  computation path would still run for it). All test rows deleted after.
- Full backend suite re-run — no regressions.

## Follow-up — Exam auto-start (2026-08-30) — shipped

Publish stayed a manual click (a real "we're committing to this
datesheet" decision), but Start never needed to be one — once
Published, an exam should move to Ongoing on its own once its
`start_date` arrives, not sit waiting for someone to remember to click
Start that morning. Same shape as every other unattended sweep already
in this codebase (`absconded.ts`/`hrAlerts.ts`): an unattended
cross-school cron plus a per-school manual trigger route, not a new
pattern.

New `backend/src/shared/utils/examAutoStart.ts` —
`runExamAutoStart(schoolId?)`: finds every `published` exam with a
non-null `start_date <= today` (school timezone via the already-pinned
`toLocalDateStr`) and flips it to `ongoing`, re-checking `status='published'`
on the write itself as a race guard. Exams with no `start_date` set are
left alone — nothing to trigger off of, so Start stays a manual click
for those, same as today. Wired into `index.ts` as a daily
`cron.schedule('5 0 * * *', ...)` (00:05, right after other daily
sweeps), and exposed as `POST /exams/auto-start/run`
(`exam.create`-gated, mirrors `POST /hrms/absconded/run`'s manual-
trigger-is-the-safety-net convention) for a host that was down at 00:05,
or manual testing.

Closed a same-day gap while at it: the daily sweep only runs once, just
after midnight — an exam whose `start_date` is today but that gets
Published later that same day (or published a day or more late) would
otherwise sit stuck as "Published" until the *next* day's sweep even
though its date has clearly already arrived. `PATCH /:id/status` now
jumps straight to `ongoing` instead of `published` when that specific
transition is requested and `start_date <= today` — the one deliberate
exception to the strict one-step-forward rule from the earlier exam-
lifecycle follow-up (Publish and Start are, in that moment, the same
real-world event).

### Verification

- `npx esbuild` clean on every touched file.
- Live script against real exam rows: a due (published, past-date) exam
  is correctly flipped to `ongoing` by the sweep; a published-but-not-
  yet-due exam and a still-Draft exam (even with a past date) are both
  correctly left untouched. Confirmed the publish-jump logic: publishing
  with `start_date` = today jumps straight to `ongoing`; publishing an
  exam with no `start_date` at all stays `published` exactly as before.
  All test rows deleted after.
- Full backend suite re-run — no regressions.

## Follow-up — Term Template multi-class apply (2026-08-30) — shipped

Applying a Term Template only ever targeted one class, one apply at a
time — a school with 10 classes sharing the exact same "Term 1 = UT1
20% + UT2 20% + Half Yearly 60%" structure had to repeat the whole apply
flow 10 times. The real member exams behind a template's slots are
typically NOT class-specific already (one "Half Yearly Examination"
exam already spans every class's own `exam_subjects` rows), so the fix
only needed to be: pick several classes, reuse the one shared exam pick
per slot, and create one `result_groups` row per class (a Term is always
scoped to a single class — that part of the schema didn't change).

`termTemplates.routes.ts`'s `POST /:id/apply`: `class_id: string` ->
`class_ids: string[]` (min 1). Loops per class, creating one
`result_groups` + its `result_group_exams` (the same shared `exam_ids`
map every time) + running `syncGroupSubjectsFromMembers` per class (so
each Term correctly picks up only its own class's subjects even though
every class shares the same member exams). A class's Term name gets
suffixed with its class name ("Term 1 — Class 9") whenever more than one
class is selected, so the list of Terms stays distinguishable; a
single-class apply keeps the name exactly as typed, unchanged from
before. Whole-request rollback (deletes every group already created in
this call) on any failure partway through, matching every other
apply-a-template rollback already in this module.

Frontend: `ApplyTermTemplateModal`'s single Class `Select` replaced with
the same checkbox-chip multi-select `ApplyPresetTab` already uses
elsewhere on this same page (reused the pattern, not invented a new
one). Response changed from one group to an array — routes to that one
Term's page when exactly one class was picked (unchanged UX), or to
`/exams/terms` with a "N Terms created" toast otherwise.

### Verification

- `npx esbuild` clean on every touched file.
- Live script against two real classes sharing one real exam (mirroring
  how a real Half Yearly datesheet spans classes): confirmed two Terms
  were created, correctly named/suffixed, each correctly scoped to its
  own class, each syncing ONLY its own class's subject (not the other
  class's), and both correctly sharing the same single real exam as
  their member (proving the exam pick isn't duplicated per class). All
  test rows deleted after.
- Full backend suite re-run — no regressions.

## Follow-up — Exam Structure Setup (2026-08-30) — shipped

Even with Exam Templates and Result Settings both built, a new school
still had to hand-build every template one at a time before they could
"just go create the datesheet" — and Result Settings' subject-override
defaults (this session's own `default_max_marks`/`default_theory_*`
work) only ever fed the real datesheet's Add Subject form, never a
template's own subject rows, so every template still started blank.

New `POST /exams/templates/generate-structure` (`exam/routes.ts`) — a
checkbox-driven year plan ("Unit Tests: 2, Classes 1-12" / "Pre-Board:
2, Classes 10 & 12") that generates a real, numbered set of Exam
Templates in one submit ("Unit Test 1", "Unit Test 2", ...), each
already carrying every selected class's full subject list — pulled from
that class's master subject list (`subjects` table, same query
`GET /admission/subjects` already uses) — with marks/split state
pre-filled from `exam_subject_result_overrides`' defaults using the
exact same exam-type-then-class-default precedence `AddSubjectModal`
already uses on the real datesheet (falling back to a 70/25/30/10 split
shape or the generic 100/33 when no override exists at all). Runs the
same `syncSubjectSplitOverride`/`fillSubjectMarksDefaults` auto-serve
loop `POST /templates` already does per subject, so a subject decided
here with no prior override gets that decision remembered as its new
default too. Rolls back every template generated so far in the request
on any failure partway through — a half-generated year structure is
worse to untangle by hand than none at all.

Frontend: new "Exam Structure for the Year" card in
`exams/templates/page.tsx`, above the existing Exam Templates list — a
repeatable row builder (label, exam type, count, and a class picker per
row) mirroring `NewTemplateModal`'s existing row-builder shape, wired to
the new endpoint. The class picker was extracted into a shared
`frontend/components/exams/ClassCheckboxPicker.tsx` — the one real
"extend, don't duplicate" moment in this feature, since
`ApplyTermTemplateModal` already had its own copy of the exact same
checkbox-chip pattern; both now use the one component. Manual "New
Template" is untouched and still available for anything the wizard
doesn't cover (a one-off custom exam type, a mid-year addition).

### Verification

- `npx esbuild` clean on every touched file.
- Live script against a real class with its real existing curriculum
  (not synthetic data): configured one plain subject-override default
  (50/17), one split override (Theory 80/28 + Practical 20/7), and left
  a third subject with no override at all. Ran the exact
  generate-structure logic for "count: 2" against that class and
  confirmed — the plain-override subject picked up 50/17 exactly; the
  no-override subject correctly fell back to the generic 100/33; the
  split subject correctly carried its configured Theory/Practical
  numbers through (max_marks = their sum, 100); both templates were
  numbered "1"/"2" correctly; and the real class's full existing
  curriculum (not just the 3 test subjects) was correctly included in
  both generated templates. All test rows deleted after.
- Full backend suite re-run — no regressions.

## Hotfix — generate-structure performance (2026-08-30)

Shipped, then immediately hung in real use: "socket hang up" against
this school's real data (~12-24 classes, most subjects school-wide via
`class_id IS NULL`). Root cause was the original loop structure —
subjects + overrides were fetched fresh **per class, per template
instance** (nested inside both the `class_ids` loop and the `count`
loop), and `syncSubjectSplitOverride`/`fillSubjectMarksDefaults` were
then called **per subject, per template instance** on top of that. For
"Unit Test x2" across a dozen-plus classes with ~50 subjects each, that
scaled to several thousand sequential awaited Supabase round trips —
minutes of wall time, well past whatever proxy/browser timeout produced
the reset.

Rewritten to batch: subjects and overrides are now fetched **once per
row** — one query each covering every class in `row.class_ids` at once
(`class_id.in.(...)`, not a separate query per class) — and the
resulting per-class subject list is computed once in memory, then
reused as-is across every one of that row's `count` template instances
instead of being re-fetched per instance. The
`syncSubjectSplitOverride`/`fillSubjectMarksDefaults` write-back calls
were dropped from this endpoint entirely — they were the single biggest
cost, and their value here is much thinner than in `POST /subjects/add`/
`POST /templates`: this endpoint only ever *reads* Result Settings'
existing defaults, so writing them back is mostly an expensive no-op,
not new information being recorded about a real exam.

### Verification

- `npx esbuild` clean.
- Live script at REAL scale (not synthetic): a real school's actual 12
  classes, "Unit Test x2" — 3.2 seconds end to end for 264 total
  generated subject rows, both template instances getting byte-identical
  subject counts, every selected class represented. Previously this
  same shape of request was what produced the live "socket hang up."
- Full backend suite re-run — no regressions.

## Follow-up — New from Template on the main Examinations page + tabular Apply Template (2026-08-30)

Two small UX fixes surfaced while the user tested the new features live:

1. **"New from Template" on the main Examinations page.** Applying an
   Exam Template was only ever reachable from Examination Settings —
   `ApplyTemplateModal` was extracted from `exams/templates/page.tsx`
   into `frontend/components/exams/ApplyTemplateModal.tsx` (unchanged
   behavior) so both that page and the main `exams/page.tsx` (header
   action + empty-state action) can use it without duplicating it.
2. **Tabular subject/date list.** Once real templates started coming out
   of the Exam Structure wizard (400+ subjects for a multi-class
   template), the modal's one-bordered-card-per-subject list became
   unusable. Replaced with a real `<table>` (sticky header, its own
   scroll region) — Subject / Class / Time Slot / Date, with a Practical
   Date column that only appears at all when the template actually has
   a split subject somewhere. Modal widened to `max-w-4xl` for the extra
   columns.

## Follow-up — Exam Type Rules: bulk class-rule apply (2026-08-30)

Class Rules only ever configured one class at a time — setting the same
Unit Test pass criteria across 12 classes meant visiting the tab 12
times. New **Exam Type Rules** tab: configure a rule once for an exam
type (or the class default), tick every class it applies to (the same
`ClassCheckboxPicker` Term Templates already uses), submit once.

`RuleCard`'s ~15-field form (promotion policy through remarks rule) was
extracted into a presentational `RuleFormFields` component — no
data-fetching, no save logic, just the fields — so the bulk tab and the
existing single-class `RuleCard` share one form definition instead of
two copies drifting apart.

Backend: new `POST /exams/result-settings/class-rules/bulk-apply`
(`resultSettingsRouter`) — `{class_ids, exam_type, ...rule fields}`,
looping the exact same check-then-update-or-insert
`PATCH /class-rules/:class_id` already uses, server-side per class_id
(not a client-side loop of N requests) — the partial unique indexes on
`exam_class_result_rules` still rule out a plain `.upsert()`. Frontend
loops once **per row** (one API call per exam-type row a user
configures, not per class within a row) — row count is however many
exam types someone sets up in one visit, nothing like the class×subject
blowup `generate-structure` hit, so a simple sequential loop is fine
here.

### Verification

- `npx esbuild` clean on every touched file.
- Live script against 3 REAL classes with pre-existing real
  configuration (not synthetic data) — backed up every existing
  `exam_class_result_rules` row for those classes first, worked against
  an untouched exam_type (`half_yearly`) to avoid any collision, then
  restored the original rows byte-for-byte afterward (verified by row
  count AND by re-querying the untouched real data directly). Confirmed:
  a fresh bulk-apply creates exactly one row per class (no duplicates);
  re-applying with different values updates those same rows in place
  rather than duplicating; a different exam_type on the same classes is
  completely unaffected; class-default (`exam_type: null`) bulk-apply
  works independently of type-specific rows. Original real data
  confirmed restored exactly (same row IDs, same values) via a direct
  follow-up query after the script exited.
- Full backend suite re-run — no regressions.

## Follow-up — Bulk Subject Max/Pass Marks (2026-08-30)

Immediate follow-up to Exam Type Rules: that tab covers the CLASS-level
rule (pass criteria, grading mode — no marks concept at all, by design).
"The numbers" — Max Marks and Pass Marks — live one level down, on
`exam_subject_result_overrides.default_max_marks`/`default_pass_marks`
(this session's own earlier work), and had no bulk path at all: setting
one subject's default marks across several classes meant visiting
Subject Overrides once per class.

New second section on the same **Exam Type Rules** tab —
**Subject Max / Pass Marks** — same shape again: pick an exam type (or
class default) + a subject name (a `Select` sourced from every subject
name used anywhere in the school, `GET /admission/subjects` with no
`class_id` filter — free text would drift from how subjects are actually
spelled per class), set Max/Pass Marks (or toggle Split for Theory/
Practical), tick every class it applies to, Apply.

Backend: `POST /exams/result-settings/subject-overrides/bulk-apply` —
`{class_ids, exam_type, subject_name, ...marks fields}`, the same
check-then-update-or-insert-per-class-id loop as the Class Rules bulk
endpoint (this table has the same partial-unique-index situation ruling
out `.upsert()`). `subject_name` is intentionally free-standing, not
validated against any one class's actual subject list — a class ticked
here that doesn't teach this subject just never reads the override,
same as everywhere else in this session's Result Settings work.

### Verification

- `npx esbuild` clean on every touched file.
- Live script against 3 real classes, using a throwaway/unique
  `subject_name` so the 133 real pre-existing subject-override rows for
  those classes could never collide with the test and were confirmed
  byte-count-unchanged afterward. Confirmed: fresh bulk-insert creates
  exactly one row per class; re-applying as a SPLIT configuration
  updates those same rows in place (not duplicated) and correctly clears
  the plain `default_max_marks`/`default_pass_marks` fields when
  switching to split; class-default scope (`exam_type: null`) is fully
  independent of a type-specific scope on the same subject/classes.
- Full backend suite re-run — no regressions.

## Follow-up — Subject class-scoping fix (admission module) (2026-08-30)

Root-caused, not just worked around: the new Subject Max/Pass Marks bulk
tool showed every class as eligible for subjects like "Accountancy" —
technically correct given the data, but wrong in reality. `subjects`
(the master per-class curriculum list, `backend/src/modules/admission/routes.ts`)
uses `class_id IS NULL` to mean "applies school-wide," and 51 of 60
subjects in this school were stored that way — including plainly
senior-secondary-only ones — because "Add Subject" defaults to no class
and nothing ever prompted fixing that. The bulk-marks tool's own
eligibility filter (added this session, previous entry) was reading
that data correctly; the data itself was wrong.

Two parts, in the module that actually owns this data (admission, not
exam):

1. `frontend/app/(app)/exams/result-settings/page.tsx`'s
   `BulkSubjectMarksTab` now narrows its `ClassCheckboxPicker` to only
   the classes actually eligible for the selected subject (computed from
   `subjects.class_id`: any global row -> every class; otherwise just
   the classes with their own row) — dropping a previously-ticked class
   from the row's own selection if changing the subject shrinks the
   eligible set.
2. New `POST /admission/subjects/rescope` — `{name, class_ids}` — a set
   operation: the given class list becomes the subject's complete,
   authoritative scoping, replacing whatever it was before (always
   removing any `class_id IS NULL` row, removing class-scoped rows no
   longer in the list, adding rows for newly-included classes, and —
   critically — leaving an already-correct class's row completely
   untouched rather than deleting and recreating it). New **Fix Subject
   Scoping** card in `settings/classes/page.tsx` (Class Numbering Style's
   neighbor): pick a subject, its current scoping pre-checks the class
   list (every class pre-checked if it was global, with an explicit
   warning banner), tick exactly the right ones, Save.

### Verification

- `npx esbuild` clean on every touched file.
- Live script against a throwaway subject name (never colliding with
  real data): confirmed a global (`class_id null`) subject correctly
  converts to exactly the requested class-scoped rows, removing the
  global row; confirmed re-scoping to a different but overlapping class
  set removes the now-excluded class's row, adds the newly-included
  one, and — the important case — leaves the still-included class's row
  as the exact same row (same id), not deleted and recreated.
- Full backend suite re-run — no regressions.

## Follow-up — "All Subjects" bulk marks option (2026-08-30)

Last piece of the bulk Subject Max/Pass Marks tool: setting marks one
subject at a time was still tedious for a school that just wants "every
subject, every class, out of 100" as a starting default. New "Apply to
every subject each ticked class teaches" checkbox on each row — when on,
the Subject `Select` disappears and every class becomes tickable (no
longer narrowed to one subject's roster, since it now varies per class).

Backend: new `POST /subject-overrides/bulk-apply-all` —
`{class_ids, exam_type, ...marks fields}`, no `subject_name`. Batched,
deliberately not a per-(class,subject) loop — that's exactly the
O(classes x subjects) blowup that hung `generate-structure` the first
time it shipped (documented in that route's own comment, now referenced
here too). Since every pair gets the IDENTICAL marks config (the whole
point of "apply to everything"), the route: (1) one query for every
class's own subject list (class-specific + school-wide rows, same
resolution `generate-structure` uses), (2) one query for existing
overrides across those classes+exam_type, (3) one batched
`.update(body).in('id', existingIds)` for every match, one batched
`.insert(newRows)` for the rest — three total DB round trips regardless
of class/subject count.

### Verification

- `npx esbuild` clean on every touched file.
- Live script against 3 REAL classes and their real curriculum (129
  actual class/subject pairs, not synthetic data) — used the `pre_board`
  exam_type scope after confirming live it had zero existing rows
  anywhere in the database, so no backup/restore was needed and nothing
  real was ever at risk. 793ms end-to-end for all 129 pairs (well under
  any timeout). Confirmed: a fresh run creates exactly one row per real
  (class, subject) pair with the correct marks; a second run with
  different marks updates all 129 rows in place (0 created, matching row
  count unchanged); each class's rows exactly matched that class's own
  real subject count (49 for the first test class) — never leaking
  another class's subjects. Cleaned up completely, confirmed the scope
  was empty again afterward.
- Full backend suite re-run — no regressions.

## Follow-up — CSV import/export for Apply Template dates (2026-08-30)

The Apply Template table (previous follow-up) made 489 date fields
scannable, but still meant clicking into every single one by hand.
Added Download/Import CSV to `ApplyTemplateModal.tsx` — entirely
client-side (the subject data's already loaded in the browser, so
round-tripping through the backend would just be latency for no
benefit): Download produces a CSV with a `Row Id` (the real
`template_subject_id`) plus Subject/Class/Time Slot for reference and
two blank date columns; a school fills dates in Excel and re-uploads,
and rows are matched back purely by `Row Id` — never by Subject/Class
text, which Excel or a person could reformat without meaning to break
the import.

Hand-rolled CSV build/parse (`csvCell`/`buildDatesCsv`/`parseCsv`), no
new dependency — matches this codebase's existing zero-dependency CSV
convention (`backend/src/shared/utils/csv.ts`, confirmed via research
before writing this: no `papaparse`/`xlsx`/`csv-parse` installed
anywhere in the repo). UTF-8 BOM included so Excel opens the file with
the correct encoding rather than guessing. Import validates every date
against `YYYY-MM-DD` and silently skips (not errors) a row whose date
doesn't parse or whose Row Id no longer matches a real row in the
template — a partial/malformed file still imports whatever it can.

### Verification

- `npx esbuild` clean.
- Live script (pure-function logic, no DB/browser needed) verifying the
  exact build/parse code: round-trip of a subject list including a
  name with an embedded comma AND a class name with embedded quotes
  (`Games, Sports` / `Class "A"`) — both survive the CSV
  quote/round-trip correctly; a simulated filled-in-Excel re-upload
  with a valid date, a valid split (Theory+Practical) row, an invalid
  date string (correctly rejected, not imported), and an unrecognized
  Row Id (whole row correctly skipped) all behaved exactly as designed.
- Frontend-only change — no backend suite re-run needed.

## Hotfix — same O(subjects) bug, second location (2026-08-30)

Live "socket hang up" again, this time on `POST /templates/:id/apply` —
applying the real "Unit Test 1" template (480 subjects, generated
earlier this session) hung the backend. Root cause was the exact same
pattern already fixed once in `generate-structure`: a "belt-and-braces"
loop calling `syncSubjectSplitOverride`/`fillSubjectMarksDefaults` once
**per template subject**, each doing its own SELECT + WRITE round trip —
480 subjects meant roughly a thousand sequential awaited Supabase calls.

Also found and cleaned up along the way, unrelated to the perf bug but
a real bug of its own: 54 throwaway subjects from this session's own
earlier verification scripts (`__GenStructSubj...`) had leaked into the
live `subjects` table and gotten baked into all four real Unit Test
templates. Deleted from `subjects`, `exam_template_subjects`, and
`exam_subject_result_overrides` — every Unit Test template is back to
its correct, real subject count.

Fix mirrors `generate-structure`'s exactly, scoped down to just
`has_practical` (dropped the marks-defaults half entirely here — by the
time a subject reaches this route, its real split marks already live on
the resulting `exam_subjects` row itself, and Result Settings' defaults
already fed the template's own marks in the first place, so re-deriving
and writing them back would mostly be an expensive no-op, the same call
already made once this session for `generate-structure`): one query for
existing overrides across every class in the template, then buckets
subjects into "needs has_practical=true", "needs =false", or "needs a
new row" — three batched writes total instead of one write pair per
subject. `POST /templates` (manual "New Template" creation) has the
identical per-subject-loop shape but was deliberately left untouched —
that route is only ever driven by a human typing rows into a form,
realistically capped at a handful of subjects, not the hundreds a
generated template or CSV bulk-import can reach.

### Verification

- `npx esbuild` clean.
- Live script against the REAL "Unit Test 1" template (480 real
  subjects, not synthetic) — full simulated apply (exam insert, 480
  `exam_subjects` insert, the new batched sync) completed in 2.2 seconds,
  down from what was hanging past any reasonable timeout. All 480
  `exam_subjects` rows confirmed created; sync correctly touched zero
  override rows (none of these 480 subjects are split, so 0 inserts/
  updates is the exact right outcome). Test exam and its subjects fully
  deleted after.
- Full backend suite re-run — no regressions.

## Revert — Term-member exams must still generate their own report cards (2026-08-30)

An earlier session decision ("card generation should only be for term
exams, not individual exams") had `POST /:id/generate-results` skip
computing `report_cards` entirely for any exam that's also a Term
member, flipping straight to `status='result_declared'` with a
`term_finalized: true` response instead. Live testing surfaced the real
consequence: "Unit test 1" went through the full single-exam
Freeze→Verify→Publish workflow to `status='result_published'`, but
because it's a Term member it never got report cards — nothing was
visible to anyone, a silently empty publish. The user's direct
follow-up request ("the exams which are part of template should also be
showing their individual scorecard after result publish") is a reversal
of that earlier decision once its real effect was visible in practice.

### Approach

Reverted `POST /:id/generate-results` (`exam/routes.ts`) to always run
the full report-card computation once an exam reaches `completed`,
regardless of Term membership — removed the `result_group_exams`
membership check and its early-return entirely. Reverted the matching
frontend logic in `exams/[id]/page.tsx`: removed `isTermMember` and the
`term_finalized`-conditional toast/button label; "Generate Results" is
now always the unconditional label and behavior.
`TermMembershipWarning` (the Results-tab banner nudging staff toward
the Term's blended result as the "official" one) was left in place
unchanged — it's a soft nudge, not the mechanism that was broken.

### Data repair

The code fix alone doesn't heal exams already stuck past `completed`
with zero report cards — the normal UI path (Generate Results button)
only shows for `status==='completed'`, and "Unit test 1" had already
moved to `result_published`. Ran a one-time backfill script that calls
the exact same computation path (`loadClassRules`/`loadSubjectOverrides`/
`resolveEffectiveClassRule`/`resolveEffectiveSubjectRule`/
`computeReportCard`, same precedence) directly against live data for
"Unit test 1", inserting the resulting `report_cards` rows without going
through the route's `status==='completed'` gate (deliberately, one-time,
because the exam is already past that stage — not a change to the gate)
and without touching its status (already further along). Checked "Half
yearly" too, which turned out to have `status='completed'` but zero
marks ever entered — its zero report cards were already correct, not an
instance of this bug, so nothing to backfill there.

### Verification

- `npx esbuild` clean on both touched files.
- Live backfill run against real data: "Unit test 1" — 13 real
  `student_marks` rows in, 13 `report_cards` rows out, status correctly
  left at `result_published`. Re-running the script afterward correctly
  no-ops ("already has 13 report_cards, skipping").
- Grepped `exams/[id]/page.tsx` for `isTermMember`/`term_finalized` —
  zero remaining references.
- Full backend suite re-run — no regressions.
- Script deleted after (`rm -rf backend/scripts`).

## Term-member Results tab: subject scoresheet instead of percentage/pass-fail (2026-08-30)

The previous entry restored report_cards for Term-member exams, but
that only fixed the underlying data — the Results tab still displayed
those report_cards' percentage/pass-fail as if this one exam's number
were the final word, which directly contradicts TermMembershipWarning's
own message just above it on the same tab ("the Term's blended result
is the official one"). Explicit follow-up request: for a Term-member
exam, replace that aggregate view with a class-wise, subject-by-subject
raw scoresheet — no percentage, no pass/fail — showing each student's
marks per subject, "NA" where nothing's filled in yet and "Absent"
where the student was actually marked absent.

### Approach

New route `GET /exams/:id/scoresheet` (`exam/routes.ts`), gated
identically to `/:id/results` (staff always see it; parents/students
only once `status='result_published'`). Returns three flat lists —
`exam_subjects` (id, class_id, subject_name, marks/theory/practical
columns), every active student across the exam's classes, and every
`student_marks` row for the exam — batched via `fetchAllRows` since a
480-subject/1000+-student exam (the same real "Unit Test 1" data used
throughout this session) is well past PostgREST's default row cap.
Deliberately returns raw data rather than a pre-pivoted grid: same
"read-only, no writeback" shape as every other endpoint this session
that only pre-fills a display.

Frontend: `exams/[id]/page.tsx` now branches on
`exam.term_memberships.length > 0` (already fetched by `GET /:id` for
`TermMembershipWarning`) — a Term member renders the new
`ScoresheetView` component instead of the existing `ResultsView`.
`ScoresheetView` groups students by class+section (same reasoning as
`ResultsView`'s existing grouping — flattening sections together would
make roll-number ordering meaningless at scale), and for each group
renders a table with one column per subject in that class. Cell logic:
no `student_marks` row at all → "NA"; `is_absent` (or, for a split
subject, both `theory_is_absent` and `practical_is_absent`) → "Absent";
a split subject with only one side absent shows "T: Absent · P: 18"
rather than collapsing the whole cell; otherwise shows the raw
marks_obtained (or grade, for a grade_only subject). `ResultsView`
itself is untouched — a non-Term exam's Results tab still shows the
existing report_cards percentage/pass-fail table exactly as before.

### Verification

- `npx esbuild` clean on both touched files.
- Live script mirroring the new route's exact query logic against the
  real "Unit Test 1" exam (480 subjects across 12 classes, 1077
  students, 13 real `student_marks` rows from earlier testing):
  correctly resolved 13 filled cells, 0 "Absent" (none of this test
  data's marks are flagged absent), and 43,067 "NA" cells for every
  other student x subject pairing with no row at all — printed one
  full student's per-subject breakdown and hand-checked every value
  against the query's raw output. Script deleted after.

## Needs Attention panel + results-browsing IA consolidation (2026-08-30)

Direct feedback: "the ui itself is not very informative for such a huge
flow of examination." Presented 7 possible improvements; user chose the
Needs Attention panel plus an IA cleanup of the overlapping
results-browsing screens. Built via 3 parallel agents (backend
endpoint; panel + Exams list; exam-detail deep-linking + cleanup) on
disjoint file sets, each independently verified.

### Backend — `GET /exams/needs-attention`

New route in `exam/routes.ts` (before `/:id`), mirroring
`GET /admission/admission-alerts`'s counts-plus-capped-example-list
convention. Five categories, all scoped to the current academic year:
ongoing exams with zero `student_marks`; completed exams with zero
`report_cards`; active freeze/verify/publish steps waiting on the
requesting user (role-batched through `canActOnStep`, not one call per
`workflow_instances` row); draft Terms whose members are all
result-declared-or-later with weights summing to 100 and subjects
synced (replicates `resultGroups.routes.ts`'s own generate-results
gate, read-only); and Terms already `result_declared` (ready to
publish). Deviation found live: every real `result_groups` row in the
dev DB has `academic_year_id = null` (the Terms UI never sets it) — a
strict year filter would have zeroed out both Term categories forever,
so those two queries treat "untagged" as still-current via `.or(...
.is.null)` rather than excluding it.

### Frontend — `NeedsAttentionPanel` + tab deep-linking

New shared `components/exams/NeedsAttentionPanel.tsx`, mounted at the
top of the Exams list (before the stat cards). Groups items by type
with a reassuring "All caught up" state when empty rather than hiding
outright. Exam detail page (`exams/[id]/page.tsx`) now reads `?tab=`
via `useSearchParams` to open on the right tab (needed since the
panel's links point straight at e.g. `?tab=Marks+Entry`) — extracted
the `STATUS_VARIANT` status→badge map (previously duplicated 3x, and
drifting: the list page's copy was missing 3 of the 8 keys the detail
page's copy had) into `components/exams/statusVariant.ts`.

### IA cleanup

`/exams/terms` deleted — it was a zero-logic wrapper around
`TermResultsBrowser`, already reachable via `/exams/results`'s
"Composite Term" mode toggle (now itself deep-linkable via `?mode=`).
`/exams/datesheet` deleted — it duplicated the main Exams list's row
markup verbatim just to link into the Datesheet tab; that job is now a
small per-row icon-link on the list itself. Cross-links added both ways
between the exam detail Results tab and `/exams/results` (kept as
separate, genuinely distinct surfaces — one exam's full workflow
context vs. a cross-exam class/section lookup — rather than merged).
Grep-before-delete caught a real dangling reference beyond the sidebar:
`result-settings/page.tsx` was `router.push('/exams/terms')` after
bulk-creating Terms from a template — redirected to
`/exams/results?mode=term` instead.

### Sidebar restructuring

Follow-up request: nest Examination Settings' and Result Settings'
internal tab strips as real, individually-clickable sidebar items
instead of forcing a page-then-tab click. `Sidebar.tsx`'s `NavEntry`
only rendered 3 levels deep (top module → group → leaf grandchild,
confirmed by reading the one existing 3-level example, Timetable/
Examinations under Academics) — extended it one level further so a
grandchild can itself be an expandable group of leaves, reusing the
exact same `expanded`/`onToggle`-by-label mechanism already used one
level up. Asked the user to confirm depth before building (5 levels to
nest Result Settings inside Results as literally worded, vs. 4 levels
keeping it a sibling of Results matching the app's existing nesting cap
everywhere else) — they chose the sibling/4-level option. `exams/templates/page.tsx`
converted from 3 stacked Cards into a real `Tabs` (Time Slots / Exam
Structure (Annually) / Exam Templates), deep-linked via `?tab=` the
same way `result-settings/page.tsx` already was; each of the 3 + 8 tabs
now has its own sidebar leaf under the corresponding settings group,
using `+`-encoded query values to match `URLSearchParams.toString()`'s
own encoding (the convention already established by the exam detail
page's `?tab=Marks+Entry` links).

### Verification

- `npx esbuild` clean on every touched/new file, backend and frontend,
  re-checked together as one final pass at the end.
- Backend: live script against real dev data verified all 5 categories
  (including two deliberate positive-path tests — a temp exam +
  workflow_instances row, a temp result_group at 40/60% weights) plus
  confirmed exclusions (an orphaned workflow_instances row pointing at
  a deleted exam; a draft Term with one non-declared member). Full
  `npx vitest run` — no new failures beyond the two pre-existing,
  already-flagged ones (a flaky timing test, stale `dist/*.test.js`
  artifacts). Scripts deleted after.
- Frontend: no browser-automation tool available in this environment —
  verified by compilation plus careful manual re-read of each diff
  (state wiring, no dangling imports/references). Grepped for
  `/exams/terms` and `/exams/datesheet` before and after deletion to
  confirm nothing else pointed at them. Live browser click-through is
  the user's to do, same as every other frontend change this session.

## Needs-attention perf fix + deep-link state-sync bug (2026-08-30)

Two follow-up reports from live use.

**Perf**: server logs showed `GET /exams/needs-attention` at ~1956ms,
notably worse than every neighboring endpoint. Root cause: 3
independent chunks of work (marks/results check, workflow-permission
check, Term readiness check) were sequential `await`s despite none
depending on each other, and the workflow chunk checked `canActOnStep`
permissions BEFORE filtering out instances pointing at exams that no
longer exist. Fixed by wrapping the 3 chunks in one `Promise.all` and
reordering the workflow chunk to filter to live, current-year exams
first. Verified live: ~1956ms → ~630ms warm, identical category
results, exam suite still 26/26.

**State-sync bug**: screenshot showed clicking "Subject Overrides" in
the sidebar correctly updated the URL (`?tab=Subject+Overrides`) but
left "Publish Workflow" showing on screen — whatever tab had been open
before. Root cause: `exams/result-settings/page.tsx`,
`exams/templates/page.tsx`, `exams/[id]/page.tsx`, and
`exams/results/page.tsx` all seeded their tab/mode state with
`useState(() => searchParams.get(...) ...)` — that initializer only
runs on first mount. Next.js reuses the same component instance across
client-side navigations that only change the query string (or, for
`[id]`, even across a different `id` param), so the state never
re-synced. Fixed identically in all four: added a `useEffect` keyed on
`searchParams` that calls `setTab`/`setMode` when the URL's value
differs from the current state. `npx esbuild` clean on all four.

## Datesheet Viewer + real stream/section scoping for 11th/12th (2026-09-01)

Request: a sidebar-reachable Datesheet Viewer showing an exam's full
schedule as a block/grid across every class at once, with 11th/12th
broken out stream-wise. Investigation first: neither `subjects` nor
`exam_subjects` carried any scoping finer than `class_id` — for 11/12,
whose "sections" are real streams (PCM/PCB/Commerce/Humanities,
confirmed against real data), this meant one flat mixed subject list
per class. A stream-wise block view built on that would've shown the
identical list under every stream heading. Presented this gap; user
chose to add real section-level scoping first rather than a
cosmetically-split view over the same undifferentiated data.

### Migration

`20260901000000_subject_section_scoping.sql`: nullable
`section_id references sections(id) on delete set null` added to
`subjects`, `exam_subjects`, and `exam_template_subjects`. Purely
additive — NULL means "whole class," so every class 1-10 (which never
gets a section picker) is completely unaffected. Applied to dev only;
production is untouched pending an explicit request to migrate it
again, same boundary as every feature before the one prior explicit
prod-push.

### Backend contract

`GET /admission/subjects?class_id=X&section_id=Y` (`admission/routes.ts`):
new optional `section_id` extends the existing class-or-global `.or()`
filter to `and(class_id=X,section_id is null) OR and(class_id=X,section_id=Y)
OR class_id is null` — this exact stream's own subjects, whole-class
subjects, and school-wide ones, excluding other streams'. Omitting
`section_id` (every non-stream caller) keeps the old behavior exactly.
`POST /admission/subjects` accepts an optional `section_id`.

`POST /exams/subjects/add`, `POST /templates` (manual template
creation — its Zod schema was initially missing `section_id` on the
subjects array; Zod strips unrecognized keys silently, so this was
caught and fixed before it shipped) both now accept/store `section_id`
via their existing spread-based insert, no other change needed.
`POST /templates/generate-structure` was the one route needing real
new logic: for a row's class with `numeric_level` 11/12 that has real
sections, it now fetches that class's sections and builds one subject
list PER STREAM (via the new section-aware subjects filter) instead of
one flat list, emitting one `exam_template_subjects` row set per
stream with `section_id` set — every other class keeps today's exact
single-list behavior. `POST /templates/:id/apply` carries `section_id`
straight through from `exam_template_subjects` to the real
`exam_subjects` row, same as every other column already did.
`GET /exams/:id`'s `exam_subjects` join now also embeds
`classes(name, numeric_level)` and `sections(name)`.

Explicitly out of scope, unaffected: Timetable, Homework, the other
Syllabus screens, HR's staff subject picker, and Result Settings'
Subject Overrides tab — none of them filter by section, so the new
nullable column changes nothing about their existing queries.

### Frontend

`AddSubjectModal` (`exams/[id]/page.tsx`) and `TemplateSubjectRow`
(`exams/templates/page.tsx`) both gained the exact `isStreamWise`
convention already proven in Syllabus Setup (`numeric_level === 11 ||
12`, section picker only rendered when the class has real sections) —
a Stream select between Class and Subject, resetting Subject whenever
Class or Stream changes, scoping the subjects query and the create
payload accordingly. Settings → Classes & Sections' `ClassCard`
subject-add form got the same picker (plus an "All Streams" sentinel
option, since Radix `Select` can't take an empty-string value) and
existing subjects now show a small stream badge.

New shared `components/exams/DatesheetGrid.tsx` (`buildDatesheetRows` +
`DatesheetGrid`) extracted from the per-exam Datesheet tab's inline
grid logic — rows group by `class_id` normally, or by `(class_id,
section_id)` for an 11/12 subject, with a subject carrying no
`section_id` on such a class getting its own "Class — All Streams" row
rather than being folded into one stream or dropped. Both the existing
per-exam tab (now correctly split for 11/12 too, an intentional side
effect of sharing the component) and the new
`app/(app)/exams/datesheet/page.tsx` viewer render it. The new page
mirrors `/exams/results`' exam-picker pattern (`?exam=` deep-linked the
same `useEffect`-resynced way as this session's other `?tab=`/`?mode=`
fixes) and adds a `DatesheetPrintSheet.tsx` mirroring
`timetable/block/PrintSheets.tsx` exactly (`print:hidden` chrome,
`hidden print:block` A4-landscape sheet, `window.print()`). One new
sidebar leaf, "Datesheet," next to All Examinations/Results.

### Verification

- `npx esbuild` clean on every touched/new file, backend and frontend,
  re-checked together in one final pass.
- Backend logic verified twice against real data, scripts deleted
  after: (1) the `GET /admission/subjects` stream filter and
  `generate-structure`'s per-stream fan-out, using real Class 11 and
  its real PCM/Commerce sections — a PCM-scoped test subject correctly
  excluded from Commerce's view and vice versa, both correctly
  including a whole-class test subject; (2) a full round trip through
  `GET /exams/:id`'s actual updated query against a real test exam
  with PCM/Commerce/whole-class subjects, confirming the exact response
  shape `DatesheetGrid` consumes, and confirming its row-grouping logic
  produces the expected 3 distinct rows (PCM, Commerce, All Streams).
- Built via 3 parallel agents on disjoint files (Settings→Classes
  picker; exam-module pickers; DatesheetGrid+viewer+sidebar), each
  independently verified, plus a backend contract built and verified
  first so all three had a fixed API shape to build against.
- Full backend test suite re-run.
- Manual browser click-through (the pickers, the viewer, print output)
  is the user's to verify live — no browser-automation tool available
  in this environment.

## "Announce Exam" — notify students/parents a datesheet is out (2026-09-01)

Request: an "Announce Exam" nav entry that "pops" (a pulsing badge) like
Admissions' "Cycles → QR" entry, positioned beside "Exam Templates."
Unlike the QR badge (which points at an already-built feature), nothing
named "Announce" existed anywhere in the app — confirmed by search
before building anything. Asked what it should actually do: a
staff-triggered, one-shot notification to every student/parent affected
by an exam's datesheet, using the app's existing in-app notification
system (the same one already polling the header bell).

### Design precedent

`POST /:id/generate-results`'s existing `exam_result_published`
notification (`exam/routes.ts`, resolves `student_marks` → `getRecipientUserIdsForStudents`
→ `createNotifications`, `link: '/exams'`) is nearly the same shape —
reused directly. The one real difference: at announce-time (right after
publishing a datesheet) there are no marks yet to derive recipients
from, so recipients come from the datesheet's classes/sections instead.

### Backend

New migration adds `'exam_datesheet_announced'` to
`notifications_type_check` (mirroring `20260829010000`'s own
DROP/ADD-CONSTRAINT pattern — a type missing from this constraint is a
silently-rejected insert, never delivered) and to the `NotificationType`
union in `shared/utils/notifications.ts`.

New `POST /exams/:id/announce` (`exam/routes.ts`, gated `exam.schedule`,
rejects a still-`draft` exam): dedupes the exam's `exam_subjects` down
to distinct `(class_id, section_id)` pairs, fetches every active student
across the involved classes in ONE query, then filters in memory —
a student matches a pair if their `section_id` equals the pair's, or the
pair's `section_id` is null (whole-class subject) — so a stream-wise
(11th/12th) subject only reaches its own stream, not the whole class.
Resolves through the same `getRecipientUserIdsForStudents` +
`createNotifications` used by `exam_result_published`; accepts an
optional custom `message`, defaults to a generated one.

### Frontend

Added as a 4th tab, "Announce Exam," on the already-tabbed Examination
Settings page (`exams/templates/page.tsx`) — literally beside "Exam
Templates" in both the `TabsList` and the sidebar tree, the most direct
reading of the placement request. New `AnnounceExamTab` component: pick
any non-draft exam, optional custom message (placeholder shows the
generated default), Send button. Sidebar gained a new leaf under
Examination Settings with `badge: 'New'` — required extending the
great-grandchild (`ggc`) rendering tier to support badges at all, since
that capability only existed one level up (`child.badge`) before now.

### Verification

- `npx esbuild` clean on every touched file.
- Live script against real data (Class 11's real PCM stream, 38 active
  students): confirmed the route's recipient-resolution logic returns
  exactly the 38 real PCM students for a PCM-only test subject,
  correctly excluding the other 3 streams — matching the same
  stream-scoping already verified for the Datesheet Viewer. Recipient
  *user_id* resolution correctly returned 0 (this dev dataset's test
  students aren't linked to real user accounts) — a property of the
  data, not the logic; `createNotifications`/`writeNotifications`
  handled the empty set correctly. Script + test exam + test
  notifications all cleaned up after.
- Backend test suite re-run (exam module + notifications/delivery
  suites specifically, plus the full suite from the prior phase).
