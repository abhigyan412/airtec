# Timetable Module — Build Progress

**Status:** built, tested, migrations applied, **demo school reseeded**, backend and frontend running.
**Companion doc:** [`timetable-rollout-plan.md`](./timetable-rollout-plan.md) — the research and the plan this implements.

---

## 1. Where it stands

All five phases from the plan are implemented. 17,666 lines across 20 new files
plus 4 edited ones.

| Phase | Scope | State |
|---|---|---|
| 0 | Schema, permissions, Timetable Manager role, engine port | **Done** |
| 1 | XLSX importer, canonicalization, review screen | **Done** |
| 2 | Setup, views, absences, arrangements, notifications, escalation | **Done** |
| 3 | Workload, free-period bookings, early leave, cancel-cover | **Done** |
| 4 | Frontend pages, navigation | **Done** |
| 5 | Feasibility, generation, drafts, publish, rollback | **Done** |

### Verification actually performed

| Check | Result |
|---|---|
| Engine unit tests (ported from edut) | **21/21 pass** |
| Engine purity guard (no I/O imports, no `Math.random`) | **7/7 pass** |
| Importer tests (synthetic + the real workbook) | **32/32 pass** |
| Substitute ranking tests | **22/22 pass** |
| Demo-seed scheduling tests | **19/19 pass** |
| Reseeded demo school, live | **readiness 100%, 2,068 periods, 0 over limit** |
| **Suite total** | **101/101 pass** |
| All 51 migrations on a fresh Postgres | **apply cleanly** |
| SQL functions smoke-tested with real rows | **all absence scopes correct** |
| Backend module loads, routes register | **56 routes** |
| Frontend production build | **6 new routes compile** |
| TypeScript, new module | **0 non-noise errors** |
| Pre-existing `helpers.test.ts` failures (2) | **untouched by this work** — `defaultSectionNamesForClass`, unrelated |

### Deployed and verified live

Migrations were applied to the hosted Supabase project
(`kylblxzmbbuzqcdfvmsj.supabase.co`) on 2026-08-18, each inside a single
transaction, and recorded in `supabase_migrations.schema_migrations` as
`20260829000000` / `010000` / `020000`.

| Post-deploy check | Result |
|---|---|
| 14 of 14 tables created | ✓ |
| `timetable_periods` + `subjects` columns added | ✓ |
| 4 Postgres functions installed | ✓ |
| 11 permission codes registered | ✓ |
| Timetable Manager role, 13 permissions | ✓ for all 3 schools |
| `timetable_settings` seeded | ✓ one row per school |
| Existing data after migration | **unchanged** — 3 schools, 74 users, 2,068 periods, 654 notifications |
| 26 read services against the real school | **25 ok, 1 correct refusal** |
| `timetable_materialize_arrangements` on real data | **7 periods materialised, idempotent on re-run, rolled back** |
| Backend routes live on :4000 | ✓ 56 routes |
| Every seeded row shape against the live schema | ✓ 14 of 14 accepted (scratch school, deleted after) |
| Frontend routes on :3000 | ✓ all 7 serve 200, no compile errors |

The one "failure" in the live service sweep is `runFeasibility` returning
*"No sections have a day template yet"* — the feasibility gate refusing to run
before setup exists, which is the behaviour it is there for.

**What the live data says**, read through the new services:

```
Delhi Public School Lucknow — 58 staff, 51 teaching
weekly load 8–38 periods, median 18
busiest: Bhavya Rastogi, 38/week, max 7/day, 4 back to back
setup readiness 29% — outstanding: day templates, capabilities,
                      fallback subjects, limits, weekly plan
```

Nothing has been written to that school. It has no day templates, no
capabilities and no plan, so the module is installed but not yet configured
for it — which is exactly the state the readiness checklist reports.

---

## 2. What was built

### Database — 3 migrations

`20260829000000_timetable_core.sql` — 12 new tables:
`classrooms`, `day_templates`, `period_slot_defs`, `section_day_templates`,
`teacher_capabilities`, `teacher_constraints`, `class_subject_plan`,
`timetable_versions`, `timetable_draft_periods`, `teacher_absences`,
`arrangements`, `period_bookings`, `timetable_settings`, `timetable_audit_log`.
Extends `timetable_periods` (`subject_id`, `room_id`, `is_locked`,
`is_double_part`, `version_id`) and `subjects` (`room_type`, `placement`,
`subject_type`).

`20260829010000_timetable_permissions.sql` — 11 new permission codes, backfill
onto existing roles in every existing school, the **Timetable Manager** role,
12 new notification types.

`20260829020000_timetable_functions.sql` — 4 Postgres functions for the
operations that must not half-happen.

**Two structural decisions worth knowing:**

- **Drafts live in their own table.** `timetable_periods` stays exactly what
  every existing consumer already assumes it is — *the live timetable*. Nothing
  generated can leak into the teacher view, `/academics/my-classes` homework
  scoping, or the attendance cross-check, none of which filter by version and
  none of which had to learn to.
- **The dangerous steps are single function calls.** PostgREST has no
  transactions, and both publishing and importing *begin by deleting the live
  timetable*. A failure between delete and insert leaves a school with no
  timetable at 7am. `timetable_replace_periods`, `timetable_publish_draft`,
  `timetable_rollback_version` and `timetable_materialize_arrangements` are each
  one statement, therefore one transaction. Same pattern as
  `fee_collect_payment`.

### Engine — ported, not rewritten

~2,200 lines of pure TypeScript from edut, moved verbatim into
`backend/src/modules/timetable/engine/`. The only edit was stripping `.js` from
import specifiers (edut is ESM/NodeNext, this backend is CommonJS).

`purity.test.ts` enforces that it stays portable: no import outside the
directory, no `Math.random`, no `process.env`. One convenient
`import { supabase }` to "just look up a teacher" would end that quietly, and
nothing else in the build would complain.

### Importer

- **`xlsx.ts`** — a dependency-free XLSX reader (~230 lines). An .xlsx is a ZIP
  of XML; SheetJS is ~7MB of parser for a format consumed in one shape from one
  trusted upload path. Handles ZIP central directory, DEFLATE and stored
  members, shared strings, inline strings, entities. Refuses ZIP64 and encrypted
  files rather than guessing.
- **`canonicalize.ts`** — collapses the dirt. On the real file: 35 subject
  strings → 27 subjects, 28 teacher strings → 26 people, with only 4 items
  needing human review.
- **`parseWorkbook.ts`** — the domain parse, plus derivation of day templates,
  the weekly plan, teacher capabilities and workload limits.
- **`resolve.ts`** — matches spreadsheet names against existing staff.
- **`commit.ts`** — writes it, grid last and atomically.

### Backend services — 56 routes

`config` · `views` · `absences` · `arrangements` · `bookings` · `workload` ·
`generate` · `escalation`, behind `/api/timetable`.

### Frontend — 6 pages

`/timetable/my-week` · `/arrangements` · `/workload` · `/import` · `/setup` ·
`/generate`, plus a shared component file. The existing 1,362-line
`/timetable` page is untouched and still works.

### Cron

Four sweeps added to `backend/src/index.ts`, each with a manual POST equivalent
because an in-process schedule never fires on a host that sleeps:

| When | What |
|---|---|
| Every 5 min, 06:00–16:00 Mon–Sat | Chase unacknowledged cover, then escalate |
| 06:45 Mon–Sat | Sync approved leave, flag missing check-ins |
| 08:00 and 11:00 Mon–Sat | Periods still uncovered today |
| 07:30 Monday | Workload breaches |

---

## 3. Your 15 features

| # | Feature | Where it lives |
|---|---|---|
| 1 | Automated generation | `services/generate.ts`, `/timetable/generate`. Feasibility gate refuses *before* running, naming the bottleneck. Produces a draft, never a live overwrite. |
| 2 | Conflict detection | edut's `conflicts.ts` verbatim — 15 codes across block/warn/info. Live on the import screen, the pre-publish checklist, and `POST /validate-move` with `suggestSwaps`. |
| 3 | Customizable views | Section, teacher, master grid, free-teacher matrix, my-week. Day/week; filters by class, section, teacher. |
| 4 | Notifications & reminders | 12 new types over the existing in-app + push + email pipeline. **The "didn't mark attendance" case:** `detectAbsences` cross-references `staff_attendance` against periods already started and proposes an absence — never confirms one. |
| 5 | SMS integration | Reads `leave_requests`, `staff_attendance`, `sections.class_teacher_id`; writes through the existing notification delivery. |
| 6 | Roles & permissions | 11 codes, new Timetable Manager role. It deliberately does **not** hold `timetable.publish` or `arrangement.override_booking`. |
| 7 | Export & print | **Partial** — CSV register export done. Bulk PDF is not built. See §5. |
| 8 | Bulk view for the manager | Master grid, all sections × periods, one day at a time. |
| 9 | Define everything up front | 7-tab setup page. The importer pre-fills six of them. |
| 10 | Workload alerting | Dedicated page: spread, heatmap, breach list, redistribution assist with validated one-click reassign. |
| 11 | Teacher free-period booking | Built **with guardrails** — see §4. |
| 12 | Acknowledgement & escalation | Full state machine, per-school thresholds, cron-driven reminder → escalate to manager *and* principal. |
| 13 | Early departure | Teacher self-reports from their phone; remaining periods queue immediately, manager notified at once. |
| 14 | Full-day absence | Three intake paths into one queue. Multi-absence safe: assigned cover occupies the slot, so five absences on one morning can't all be offered the same substitute. |
| 15 | Teacher returns / cancels | "They're back" stands down everything not yet started. Periods already running stay in the register as actually taught. |

---

## 4. Two places I did not build it literally

Both are flagged in the plan; this records what shipped.

**Feature #11 — free-period booking.** Built as a *hard* block against routine
scheduling and a *−1000* penalty on the substitute ladder, not an absolute
block. Reasons: the free time in this school is concentrated in six people, so
a heavy-absence Monday would have nobody left; and without a notice period a
teacher who sees an absence notice could reactively book to dodge cover.

Guardrails, all configurable per school: **12 hours notice**, **4 protected
periods a week**, and override gated behind `arrangement.override_booking`,
which the Timetable Manager does not have. Overriding requires a written reason
and the teacher is told, by name, with the reason attached.

If the school wants absolute protection, it is one boolean.

**Sequencing.** You listed generation first; it is last. The school's timetable
already exists and took someone weeks. Generation is also worthless until
`class_subject_plan` is trustworthy, which the importer derives. Day one is
import → conflicts → arrangements.

---

## 4b. The demo seed, and two bugs it surfaced

`npm run seed` predated this module and produced a timetable the module
could not use. Four defects, in rising order of seriousness:

1. **No `subject_id` or `room_id`** on `timetable_periods` — every new query
   that joins on subject got null.
2. **No day templates**, so `periodsPerDay` computed as zero everywhere:
   the workload report showed nobody with a free period, the booking screen
   offered no slots, and generation refused outright.
3. **No capabilities, constraints or weekly plan**, so substitute ranking
   degraded to "whoever is free" and generation was impossible.
4. **The seeded grid broke the module's core invariant.** The old layout
   picked whichever teacher happened to be free for each individual slot,
   so Class 5-A's Maths was taught by a different person on Monday and
   Tuesday. Nothing double-booked, so nothing looked wrong — but one
   teacher per subject per section is what the ranking ladder, the
   workload report and the generator all rest on.

Fixing (4) forced a sizing correction. 47 sections × 38 periods = 1,786
periods a week; the old bench of 50 teachers sat at **94% utilisation**.
That is unschedulable once a teacher is bound to a section+subject, and —
worse for a demo — leaves nobody free to cover an absence, so the
arrangements screen would have opened empty. The bench is now derived from
curriculum demand at a 65% target: **83 teachers, ~22 periods each**.

The scheduling logic moved to `src/seedTimetable.ts`, kept free of
Supabase, because it is the only part of the seed that can produce data
that is *wrong* rather than merely absent. `seedTimetable.test.ts` runs it
at full size and asserts the invariants — **19 tests**, including zero
double-bookings, zero multi-teacher section-subjects, zero unfilled slots
and full weekly quotas. The curriculum and day shapes live there too and
are imported by `seed.ts`, so the test asserts the real constants rather
than a copy that drifts.

Two implementation notes worth keeping:

- A greedy fill left **19 of 1,786 periods empty**, each short by exactly
  one, with no teacher above 74% load — a packing failure, not a shortage.
  Most-constrained-first ordering plus a swap repair pass clears all 19.
- Same-day subject repeats run at ~18%, which is not a defect: a
  six-subject section with seven periods a day *must* repeat something.
  The test asserts closeness to that structural floor rather than an
  arbitrary percentage.

The seed now also stages a live arrangement queue for the next school day
— one absence fully covered and confirmed, one assigned and awaiting a
reply, one still needing somebody — plus a few protected free periods, so
the screens open with something on them.

### Two real bugs, found only by a live round-trip

Neither was reachable by unit tests or `tsc`; both surfaced when the row
shapes were pushed at the actual schema.

**`users.id` has no default.** The importer's "create teacher" path
inserted a `users` row without an id, which would have failed on the first
import with a not-null violation. Every teacher the spreadsheet introduced
would have been rejected.

**That id cannot be changed later.** `users.id` is the target of **109
foreign keys, none of them `ON UPDATE CASCADE`**. `POST /team/:id/reset-login`
gives a no-login staff member an account by creating an auth user and
re-pointing `users.id` at it — which fails the moment that person has a
single timetable period against them. So the first fix (invent a uuid)
would have produced teachers who could *never* be given a login, breaking
acknowledgement (#12) for the whole school.

The importer now creates the Supabase Auth account first and takes its id,
exactly as `/team/invite` does, with a random password nobody is told. The
account owns the id from the start, so `reset-login` only ever has to set
a password — the path that already works. Credentials are still issued
deliberately, per person; importing a timetable does not hand out 27
working logins.

---

## 4c. Reseed, and the realism pass

The demo school was torn down and rebuilt (`npm run seed:reset`). What it
looks like now:

```
1 school · 103 users · 1,882 students · 47 sections
2,867 timetable rows (2,068 lessons + 799 assemblies/breaks)
80 teachers · load 8–35/week, median 28 · 0 over limit
2 day shapes · 61 rooms · 357 plan rows · 194 capabilities · 80 limits
setup readiness 100%
```

### What changed to make it realistic

**A real school day, not an invented one.** Assembly 08:00, eight
40-minute periods, a short break after the third and lunch after the
sixth, half-day Saturday — 44 teaching periods a week, which is the range
CBSE middle schools actually run. The old shape was five identical
09:00–14:00 days with one break.

**Weighted period allocation.** The old seed split a section's week evenly
across its subjects, so Art & Craft got as many periods as Mathematics.
That is the detail that gives a demo away instantly. Allocation now
follows the CBSE-aligned ranges — core 6–9, languages 6–9, computing 2–3,
art and PE 2–5 — and each stage's list sums to exactly 44.

**PRT / TGT / PGT means something.** Designations used to be handed out by
`i % 3`, producing "PGT Numbers" teaching nursery. The bench is now sized
per stage from that stage's demand, teachers carry a class range, and the
layout only gives them sections inside it.

**Rooms that can actually hold the timetable.** One computer lab cannot
host 150 Computer Science periods in a 44-period week. There are now four
computer labs, three science labs, two art rooms, two grounds, a library,
a music room and an auditorium — 61 rooms — and specialist subjects are
booked into them per slot, falling back to the home room when they are
full, which is what a school does and what the app reports as
`ROOM_FALLBACK`.

**Workload limits follow the designation.** PGT 26/week, TGT 30, PRT 34,
with the observed load winning where it is higher, plus a minimum so the
report can flag someone carrying almost nothing.

**Teacher count.** 50 → 80, derived from demand at 75% target utilisation
rather than hand-tuned. The old figure put every teacher at 94% of their
available periods: unschedulable once a teacher is bound to a
section+subject, and with nobody free to cover an absence.

### Tearing a school down turned out to be its own problem

`--force` *adds* a second school, which is not what "reseed" means, so
`--reset` and `npm run seed:reset` are new. Getting the teardown right
took three attempts, each defeated by something real:

1. **The fee ledger is append-only** and refuses DELETE even through a
   cascade — correctly. `fee_ledger_force_delete` (20260827000000) already
   existed for exactly this and is now used rather than worked around.
2. **~100k cascading deletes exceed the API's statement timeout**, and
   `SET LOCAL statement_timeout = 0` inside a function does nothing about
   a gateway cancelling the request around it. `--reset` now clears the
   bulk tables as separate statements first, and prints the direct-psql
   fallback if the remainder still will not fit.
3. **The blocking foreign keys are transitive.** v1 hardcoded the four
   tables that block deleting `schools`; it hit `workflow_approvals`,
   which blocks deleting `users`. v2 asked the catalogue for every
   NO ACTION key pointing at either; it hit `issued_certificates`, which
   points at `certificate_templates`, which v2 had just emptied. v3
   (20260829050000) stops enumerating: the schema is `school_id`-scoped
   throughout, so it clears every school-scoped table repeatedly and lets
   foreign key violations decide the order by retry. A school clears in
   two passes.

### Six more bugs, all found by running against real data

| Bug | Why it mattered |
|---|---|
| **`sections.class_teacher_id` does not exist** — dropped by 20260801000000 in favour of `class_teacher_assignments`. The baseline dump still shows it, which is what misled me. | PostgREST rejects the whole query, so `loadDayState` threw. **The entire substitute-ranking path was dead** — every candidate lookup and every assign would have 500'd. |
| **PostgREST silently caps responses at 1,000 rows.** | The school has 2,867 periods. The workload report was computing everyone's load from a third of the timetable, the setup checklist saw 38 teachers instead of 79, and generation planned around a fictional grid. No error, no flag — just a short array. Every unbounded read now pages through `fetchAll`. |
| **Generation grouped sections by day template.** | Every section follows the weekday template *and* the Saturday one, so each group thought it owed a full 44-period week. Feasibility reported "Nursery-A needs 44 periods but only 24 slots exist". Groups are now day *shapes*, and a section's quota is split across them. |
| **The split ignored per-teacher capacity.** | A teacher has four Saturday slots however many sections want them. Allocating the roomy weekday shape first left a remainder Saturday could not absorb. The scarce shape is now filled first, under its ceiling. |
| **Capabilities never matched.** `subjects` is per class, so a capability against Class 6 Mathematics does not match a Class 2 Mathematics period by id. | Every subject specialist vanished from the ranking; the top suggestion for a Class 2 English absence was whoever happened to be free. Matching now falls back to the normalised subject name. |
| **Duplicate permission codes in the RBAC seed** — `arrangement.view` is in both the senior and own-record sets. | A fresh school aborted with a unique-constraint violation before any data was written. `seedDefaultRoles` now dedupes. |

The ranking now reads as it should:

```
cover for Class 2-C English, period 1
  88  Gaurav Pandey    Teaches this subject · 4 periods today
  88  Kavya Chauhan    Teaches this subject · 4 periods today
  72  Bhavya Bhatt     Can teach this subject · Teaches this class level · 6 periods today
  65  Parth Nair       Can teach this subject · 5 periods today
```

### Generation, end to end on real data

```
feasibility            OK for both shapes
Regular day   1,877 periods placed, score 7164, 71s, 1 blocking, 136 warnings
Saturday        188 periods placed, score  655,  0.6s, 0 blocking, 110 warnings
```

71 seconds for 47 sections × 5 days × 8 periods is slower than the
engine's stated budget and worth profiling before anyone generates a
whole school routinely; it is a background operation producing a draft,
so it is not blocking. Three of 1,880 weekday periods went unplaced.

---

## 5. Known gaps

| Gap | Impact | Notes |
|---|---|---|
| **Bulk PDF export** | Feature #7 half done | CSV register export works. Bulk "print 16 class timetables and 27 teacher timetables" needs a PDF renderer — no dependency exists in the repo yet. Browser print CSS on the existing page still works. |
| **Old `/timetable` page not migrated** | Cosmetic | Still on the legacy endpoints and still works. Its Free Faculty tab duplicates the better one on the arrangements page. |
| **Long-absence redistribution** | Detection only | `GET /absences/long` flags teachers past the threshold; there is no dedicated UI to bulk-redistribute their term. The workload page's per-period reassign covers it manually. |
| **Combined classes, elective bands, exam-day templates** | Out of scope, hooks present | `day_templates.template_type` already accepts `exam`/`activity`/`half_day`. Classes I–VIII don't need elective bands. |
| **Rooms are minimal** | By design | Table, types and clash detection exist; no management UI beyond add-a-room. This school is homeroom-based. |
| **Seasonal timings, shifts** | Not built | No evidence this school needs them. |
| **Co-taught periods** | Partial | `Vishnu/ Preeti` imports as Vishnu with the pairing surfaced for review. There is no two-teachers-per-slot model. |

---

## 6. The real school's file

`New Time table (1).xlsx` is **deliberately not in the seed**, per your
instruction. It contains 27 real teachers' names.

- `backend/src/seed.ts` is **unmodified**.
- The importer test uses a **synthetic fixture** that reproduces the same
  *categories* of mess — case drift, doubled spaces, eaten leading characters,
  merged cells, one misspelt name, one co-taught slot — so the suite passes
  without the real file present.
- One test block opportunistically re-parses the real file *if it happens to be
  on disk*, and is skipped otherwise (`describe.skipIf`).
- The path to production for this school is the **Import screen at runtime**,
  into its own school record.

What the parser reads from it, verified end to end:

```
6 days · 16 sections (I–VIII × A/B) · 912 periods
two day shapes: 9-period (I–IV) and 10-period (V–VIII), break after P4
P1 07:50–08:25 … P10 13:25–14:00
35 subject spellings → 27 subjects   (4 need review)
28 teacher spellings → 26 people     (Krishna/Krishana merged)
2 pre-existing clashes found: Pooja Rai, Thu + Fri P-IX, III A and III B at once
workload seeded from observation: 5 to 49 periods/week
```

---

## 7. Before this touches a real school

**In order.**

1. ~~**Apply the three migrations.**~~ **Done** — applied to the live project and
   verified (see §1). Note for the record: the schema change is expand-only.
   No table was dropped, no row deleted; the only destructive statement is the
   `notifications_type_check` swap, which was replaced in the same transaction
   with a superset, and every existing notification type was checked against the
   new list first.
2. ~~**Restart the backend.**~~ **Done** — `tsx watch` reloaded it; all 56 routes
   answer and the four cron schedules are registered.
3. **Create the school**, then use `/timetable/import` — do not seed. The real
   school is *not* Delhi Public School Lucknow, which already exists on this
   project with its own 2,068 periods; give the new school its own record.
4. **Walk the setup checklist.** It will show two things outstanding after
   import: fallback subjects and reviewed limits. Fallback subjects are the one
   thing the spreadsheet cannot supply and the single biggest lever on cover
   quality.
5. **Dry-run a full day** before go-live: mark two teachers absent, let one
   escalation fire, assign and acknowledge, cancel one when a teacher "returns",
   print the register.
6. **Tune the thresholds** with the school in week one — acknowledgement
   timings, booking cap, whether long consecutive runs warn or block.

### Open questions for the school

Carried from the plan, still unanswered, and each changes behaviour:

1. Are Pooja Rai's Thursday/Friday P-IX remedial slots a genuine merged
   III-A + III-B group, or an error? A merged group needs a combined-class model
   that does not exist yet.
2. Is P-XI (14:00–14:35) really unused?
3. Are `Zero` and `Zero/ READING` one subject or two?
4. `Vishnu/ Preeti` — co-teaching or a rotation?
5. Should long consecutive runs block a save, or only warn? Current practice
   runs to 8 in a row.
6. Who is the Timetable Manager, and should they be able to publish? (Default:
   no — that is the principal.)
7. Do teachers have devices for push notifications, or is email the realistic
   channel?

---

## 8. Files

**New**
```
supabase/migrations/20260829000000_timetable_core.sql
supabase/migrations/20260829010000_timetable_permissions.sql
supabase/migrations/20260829020000_timetable_functions.sql

backend/src/modules/timetable/
  routes.ts                      56 routes
  lib/core.ts                    settings, audit, notify, errors
  engine/                        types · feasibility · conflicts · generate
                                 + engine.test.ts + purity.test.ts
  import/                        xlsx · canonicalize · parseWorkbook
                                 resolve · commit + import.test.ts
  services/                      config · views · absences · arrangements
                                 bookings · workload · generate · escalation
                                 + ranking.test.ts

backend/src/seedTimetable.ts       curriculum, day shapes, plan + layout (pure)
backend/src/seedTimetable.test.ts  invariants at full demo scale

frontend/lib/timetableApi.ts
frontend/app/(app)/timetable/
  components.tsx                 status pills, chips, subject colours, date nav
  arrangements/page.tsx          the morning screen
  workload/page.tsx              spread, heatmap, rebalancing
  my-week/page.tsx               teacher self-service
  import/page.tsx                3-step import
  setup/page.tsx                 7-tab configuration
  generate/page.tsx              feasibility, drafts, publish, rollback
```

**Edited**
```
backend/src/seed.ts                      timetable setup, derived teacher bench,
                                         demo arrangement queue
backend/src/index.ts                     mount routes, 4 cron sweeps
backend/src/modules/rbac/seed.ts         timetable permissions, Timetable Manager
backend/src/shared/utils/notifications.ts 12 new notification types
frontend/components/layout/Sidebar.tsx   6 nav entries
```

---

## 9. Two things worth remembering

**Limits are seeded from observation, not from a textbook.** edut ships
`maxConsecutive = 3`. This school runs 8. Shipping the default would have
flagged roughly 20 of 27 staff on the first page load, the alerts would have
been switched off within the hour, and they would have been worth nothing on
the day something genuinely broke. The importer therefore writes each teacher's
*observed* maxima as their limit, so nothing is in breach on day one, and the
workload page exists to let the school tighten them once it can see the real
distribution. `ranking.test.ts` has a test for each side of that.

**Role labels do not decide who teaches.** An early version filtered the
substitute pool on `users.role = 'teacher'`, which would have hidden a vice
principal who takes two periods of Maths — exactly the kind of person with free
time. The pool is now everyone who is not a parent or a student, consistently
across the ladder, the free-teacher matrix, the workload report and the
generator.

---

## 10. End-to-end pass before rollout (19 Aug)

A full sweep against the live school — every endpoint over real HTTP as
real users, then the flows behind them. Seven defects, all reproduced
before being fixed and re-verified after. The ones worth remembering:

**A generator can be correct per run and wrong overall.** Generation runs
once per day shape and hands each run the other shapes' timetable as
immovable occupancy. That occupancy was read from the live grid — which
is what the run is replacing. Every individual run was internally
consistent; the draft as a whole had 35 teacher double-bookings, because
shape two scheduled around where shape one's teachers used to be. Later
shapes now receive what this run actually placed. The lesson generalises:
when a job replaces state in stages, "current state" means *as of this
job*, not as of the database.

**A foreign key encoded a claim nobody had checked.**
`arrangements.timetable_period_id` was `ON DELETE CASCADE`, which asserts
that a cover assignment is meaningless without its period row. It isn't —
the arrangement already stores the class, section, day, period, times and
subject. Meanwhile all three functions that put a timetable live work by
deleting and reinserting every period row, so publishing at eleven in the
morning silently erased that day's cover: teachers who had accepted it no
longer had it, and nobody was told. Found because a rollback to the
imported timetable wiped cover for three confirmed absences. The link now
goes null and is re-established by matching section + weekday + period.

**A button with no preview is a button that gets pressed blind.**
`versionGrid` had existed in the API client since the module was written
and was called from nowhere: the screen offered a score, a conflict count
and Publish. That is how a generated draft came to replace this school's
imported timetable without anybody seeing it. The preview also revealed
that `draftGrid` never paginated — a full week would have shown
two-thirds of itself and looked complete.

**Deciding on the user's behalf is not the same as helping.** "They're
back" cancelled everything the clock said had not started and reported a
total afterwards. But which cover survives a teacher's return is one
decision per period: they take their afternoon back, period 3 was taught
by somebody else an hour ago, and period 7 may want leaving covered
because they are going into a meeting. It now asks, shows which periods
have already gone, and tells a substitute whose cover was deliberately
kept that it still stands.

**A cross-school sweep needs to know which schools it applies to.** The
absconded sweep flags anyone unmarked for 15 working days. A
timetable-only school keeps no attendance register, so all 29 teachers
were flagged, burying every real notification in the administrator's
list; with `absconded_auto_flag` on it would have marked all 29 absconded
outright. Guarded twice — on the module, and on whether the register
contains anything at all, which protects any school that stops using it.

**Red tests protect nothing.** Six were failing at HEAD, all stale
expectations rather than real breakage: two predated a deliberate move to
three sections per class, three assumed every school holds all sixteen
default roles (a module-restricted school deliberately drops the ones it
will never use), one counted permissions before dedupe. Back to 459
passing across 26 files.
