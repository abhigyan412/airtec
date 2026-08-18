# Timetable Module — Production Rollout Plan

**Target:** one real school, live on the timetable module only.
**Source of truth for day one:** `New Time table (1).xlsx` (Classes I–VIII, 6-day week).
**Engine and domain model:** ported from `/Users/kartik/Developer/Personal/edut`.
**Host app:** `airtecv2` (Express + Supabase + Next.js 14).

---

## 1. What we are actually shipping

A timetable module that a school with **no other airtec module enabled** can run its
week on. Three people use it:

| Who | What they do |
|---|---|
| **Timetable Manager** | Owns the grid. Imports/edits it, sees conflicts, handles the daily absence queue, assigns arrangements, watches workload. |
| **Teacher** | Sees their own week, acknowledges arrangements, books their own free periods, declines cover they can't take, reports leaving early. |
| **Principal / School Admin** | Read-everything, override-anything, receives escalations. |

Day one is **not** "generate a timetable". Day one is **"operate the timetable this
school already has"**. Generation is phase 3, for the *next* session and for
mid-session repairs. Getting that order wrong is the single biggest way this
rollout fails.

---

## 2. Evidence base — what the school's real timetable tells us

Parsed from all six sheets of `New Time table (1).xlsx`. Every number below is
measured, not assumed.

### 2.1 Shape

- **6-day week**, Monday–Saturday (one sheet each).
- **16 sections**: Classes I–VIII, sections A and B.
- **11 period columns + one break.** Bell schedule (35-minute periods):

  ```
  P-I    07:50–08:25      P-VII   11:40–12:15
  P-II   08:25–09:00      P-VIII  12:15–12:50
  P-III  09:00–09:35      P-IX    12:50–13:25
  P-IV   09:35–10:10      P-X     13:25–14:00
  BREAK  10:10–10:30      P-XI    14:00–14:35   (unused)
  P-V    10:30–11:05
  P-VI   11:05–11:40
  ```
- **Two day-lengths.** Classes I–IV run P-I…P-IX (**9 periods/day, 54/week**).
  Classes V–VIII run P-I…P-X (**10 periods/day, 60/week**). P-XI is empty for
  everyone.
- One 20-minute break after P-IV, labelled "LUNCH" on the sheet. There is no
  second break. Engine config: `breakAfter = [4]`, `postLunchPeriod = 5`.
- **912 filled slots, zero gaps, zero orphan cells.** Every section is fully
  staffed on paper.

### 2.2 The data is dirty and the importer must expect it

35 distinct subject strings resolve to roughly 20 real subjects:

- Case drift: `GK` / `Gk`, `SST` / `SSt`, `Computer Lab` / `Computer LAB` / `Computer  LAB`
- Truncation: `emedial- Science`, `medial- English`, `SST              Re`, `Sanskrit           Re`
- Spacing: `Remedial- English` / `Remedial-English`
- Merged concepts: `Zero` / `Zero/ READING`

28 teacher strings resolve to **27 real teachers**:

- `Krishna` and `Krishana` are the same person (proven below).
- `Vishnu/ Preeti` is a co-taught cell, not a person — 3 slots.

**Consequence:** the importer is a real workstream with a human-in-the-loop
review screen, not a one-shot script. See §9.

### 2.3 The invariant holds

One teacher per subject per section: **362 section+subject pairs, 2 apparent
violations, and both are the `Krishna`/`Krishana` typo.** The school already
works the way edut's model assumes. We can enforce this as a hard rule with
confidence.

### 2.4 Two genuine conflicts already exist in the live timetable

| Day | Period | Teacher | Clash |
|---|---|---|---|
| Thursday | P-IX | Pooja Rai | `III A / Remedial-Maths` **and** `III B / Remedial-Maths` |
| Friday | P-IX | Pooja Rai | `III A / Remedial-Maths` **and** `III B / Remedial-Maths` |

Conflict detection pays for itself on the import screen, before the school has
even logged in. This is the demo.

### 2.5 Workload is the headline problem

Periods taught per week, out of 54–60 available:

```
Basundhara   48  (8/day, every day, 8 consecutive — 1 free period/day)
Reetika      46      Vijaya        46      Arti Pal   46
Pooja Rai    46      Payal         46
Sajida       44      Heena         44      Neha Mishra 44   Neha Joshi 44
Neha sri     43      Mamta         41      Neha Singh  40   Krishna    39
Mrinalini    36      Amirah        36      Nupur       36
Shivam       33      Aarti         32      Kunal       32
Komal        24      Ayushi        16      Shabeena    12   Priyanka   12
Preeti        8      Vishnu         5
```

- **Max consecutive periods observed: 8.** edut's default `maxConsecutive` is 3.
  Shipping that default would flag ~20 of 27 teachers on the first page load and
  the school would switch the alerts off forever.
- Spread is 5 → 48 periods/week. A ~10x range.
- Feature #10 (workload alerting) is not a nice-to-have here. It is the finding.

### 2.6 The substitute pool is thin and lopsided

Free teachers available in each slot, out of 27:

```
        P-I  II  III  IV   V   VI  VII VIII  IX   X
MON      10  10   10  10  10   10   10    9   9  18
TUE      10  10   10  10  10   10   10   10  10  18
WED      10  10   10  10  10   10   10   10  10  18
THU      10  10   10  10  10   10   10   10  11  18
FRI      10  10   10  10  10   10   10   10  11  18
SAT      10  10   10  10  10   10   10   10  10  18
```

Nominally ~10 candidates per slot. But free time is concentrated in the
lightest-loaded staff:

```
free periods/week:  Vishnu 52 · Preeti 50 · Priyanka 48 · Shabeena 48 · Ayushi 44 · Komal 36
                    …vs…  Krishna 11 · Basundhara 12 · Reetika 14 · Vijaya 14 · Payal 14
```

Six people hold most of the slack, and several of them are specialists (Dance,
Robotics, Games) who cannot cover Class VIII Maths. **Without subject-capability
ranking and fairness caps, the arrangement engine will dump every substitution
on the same six people.** This directly justifies porting edut's ranking ladder
rather than writing a simpler "pick anyone free".

---

## 3. Gap analysis — airtecv2 today

### 3.1 What already exists and we keep

| Asset | Where | Verdict |
|---|---|---|
| `timetable_periods` table | `supabase/migrations/20260720000000_baseline.sql:1094` | Keep, extend |
| Timetable page (class/teacher/free views, print) | `frontend/app/(app)/timetable/page.tsx` (1362 lines) | Keep, extend |
| `GET /students/timetable/free-faculty` | `backend/src/modules/sis/routes.ts` | Keep, becomes engine-backed |
| `GET /students/timetable/substitutes` | `sis/routes.ts` | **Replace** with edut's ladder |
| `GET /students/timetable/attention-required` | `sis/routes.ts:1206` | **Gold.** Already cross-references `staff_attendance` against today's periods — this *is* feature #4's "if they just don't mark attendance" |
| `staff_profiles.subjects text[]` | `20260824000000_staff_subjects_taught.sql` | Upgrade to priority-ranked capabilities |
| Notifications: in-app + web push + email | `20260724000000`, `20260729000000`, `shared/utils/notifications.ts` | Keep — feature #4/#12 has infrastructure already |
| `timetable_assigned` notification on save | `sis/routes.ts:484` | Extend with acknowledgement |
| `staff_attendance`, `leave_requests`, `leave_types` | baseline | Absence intake sources |
| node-cron job runner | `backend/src/index.ts:10` (feeReminders, deliveries, hrAlerts…) | Escalation sweeps get a home for free |
| `sections.class_teacher_id`, `classes.numeric_level` | baseline | Ranking ladder inputs |

### 3.2 What is missing

- `timetable_periods.subject_name` is **denormalized text** with no FK to
  `subjects`. Every "how many Maths periods does VIII-A get" question is a string
  match today. This must be normalized before generation is possible.
- No day templates → the grid's period times are effectively hardcoded per row.
- No teacher constraints (max/day, max/week, max consecutive, availability).
- No teacher capabilities with priority (only a flat `text[]`).
- No rooms/classrooms table at all.
- No absences, no arrangements, no acknowledgement, no register.
- No generation engine, no feasibility check, no draft/publish lifecycle.
- Only two permissions: `timetable.view`, `timetable.manage`.

---

## 4. Port inventory — what we take from edut

edut's timetable work is *already built and tested*, not just designed. Files:

| edut path | Lines | Port strategy |
|---|---|---|
| `packages/modules/academics/src/services/engine/types.ts` | 216 | **Copy verbatim.** Pure types, zero deps. |
| `.../engine/feasibility.ts` | 212 | **Copy verbatim.** Pure. |
| `.../engine/conflicts.ts` | 464 | **Copy verbatim.** Pure. |
| `.../engine/generate.ts` | 1291 | **Copy verbatim.** Pure. Seeded PRNG (mulberry32), deterministic. |
| `.../engine/engine.test.ts` | 690 | **Copy verbatim.** Vitest, no DB — airtecv2 already runs vitest. |
| `.../services/arrangements.ts` | 2101 | **Rewrite** against Supabase. Port the *ranking ladder algorithm* exactly. |
| `.../services/timetable-config.ts` | 1091 | **Rewrite** against Supabase. Port the shapes. |
| `.../services/timetable-scheduler.ts` | 1300 | **Rewrite** the `buildEngineInput` DB assembly; the engine call is unchanged. |
| `timetable.md` | 393 | **Reference doc.** Sourced Indian-school research (CBSE/RTE norms, PRT/TGT/PGT, leave types). Copy into `docs/`. |
| `timetable-design.md` | 340 | **The contract.** This plan supersedes it where they differ. |

**Why this split matters:** the engine is ~2,170 lines of pure TypeScript with no
Prisma import anywhere. It moves from a Prisma/Fastify monorepo into an
Express/Supabase app *unchanged*. Only the DB assembly layer is rewritten. That
is the whole reason to build on edut rather than start over.

The engine is mature, not a prototype — it has randomized restarts, ejection
chains, section-swap repair, room fallback, orphan-locked-half handling, and a
relaxed final attempt that trades a repeat-warning for an unplaced period. That
behaviour is expensive to rediscover.

---

## 5. Architecture decisions

**[D1] Normalize `subject_name` → `subject_id`, keep the text column.**
Add `subject_id uuid REFERENCES subjects(id)`. Backfill from the importer's
canonical map. Keep `subject_name` as a denormalized display cache so the
existing 1362-line page and `/academics/my-classes` keep working during the
migration. New code reads `subject_id`.

**[D2] The engine stays pure and un-forked.**
Lands at `backend/src/modules/timetable/engine/`. No Supabase import may ever
appear in that directory — enforce with a lint boundary or a CI grep. Bugs get
fixed in both repos, but the file contents stay diffable.

**[D3] Ship the operating layer before the generating layer.**
Import → conflicts → views → arrangements → acknowledgement → workload, *then*
generation. The school's timetable already exists and it took someone weeks.
Nobody will let us regenerate it in week one.

**[D4] Calibrate every default to this school's measured reality (§2.5).**
Ship `maxPeriodsPerDay = 9`, `maxPeriodsPerWeek = 50`, `maxConsecutive = 8`
as the *imported* baseline, and surface the school's actual distribution on the
workload page so the manager tightens the numbers themselves. Alerts that fire
on everyone are alerts nobody reads.

**[D5] Rooms are a stub in v1.**
No `classrooms` table exists and this school is homeroom-based. Create the table
with `room_type` and `capacity_groups` so the engine contract is satisfied, seed
one homeroom per section plus `Computer Lab` and `Science Lab` (both appear as
subjects in the sheet). Do not build a room-management UI in v1.

**[D6] Arrangements never mutate the master timetable.**
They are an overlay for a date. The teacher/class views render today's overlay in
a distinct colour. This is how the school already thinks about it, and it keeps
the master grid auditable.

**[D7] Everything the manager does that touches a teacher's day emits a
notification and an audit row.** Non-negotiable — arrangements are a source of
staffroom disputes, and the register is what protects the manager.

---

## 6. Data model

New migration series under `supabase/migrations/`. All tables carry `school_id`,
`uuid` PK, `created_at`, and follow the existing snake_case convention.

### 6.1 Extend existing

```sql
ALTER TABLE timetable_periods
  ADD COLUMN subject_id      uuid REFERENCES subjects(id),
  ADD COLUMN room_id         uuid REFERENCES classrooms(id),
  ADD COLUMN is_locked       boolean NOT NULL DEFAULT false,
  ADD COLUMN is_double_part  boolean NOT NULL DEFAULT false,
  ADD COLUMN day_template_id uuid REFERENCES day_templates(id);

ALTER TABLE subjects
  ADD COLUMN room_type text,          -- null = homeroom
  ADD COLUMN placement jsonb;         -- {preferMorning,avoidPeriod1,avoidPostLunch,preferLast}
```

### 6.2 New tables

```
classrooms              name, room_type, capacity, capacity_groups
day_templates           name, type(regular|saturday|exam|activity|half_day), status
period_slot_defs        day_template_id, index, kind(period|assembly|break|lunch),
                        period_number, start_time, end_time
class_subject_plan      class_id, section_id?, subject_id, weekly_periods,
                        double_periods, teacher_id
teacher_constraints     teacher_id, max_per_day, max_per_week, min_per_week,
                        max_consecutive, arrangement_cap_day, arrangement_cap_week,
                        exempt_from_arrangements, availability jsonb
teacher_capabilities    teacher_id, subject_id, priority(1|2|3),
                        min_class_level, max_class_level
teacher_absences        teacher_id, date, scope(full_day|first_half|second_half|periods|
                        early_leave|late_arrival), periods int[],
                        source(manual|leave|attendance|self_report),
                        leave_request_id, effective_from_period, note
arrangements            date, absence_id, timetable_period_id, day_of_week, period_number,
                        section_id, class_id, subject_id,
                        absent_teacher_id, substitute_teacher_id,
                        status(unassigned|assigned|acknowledged|declined|cancelled|unfilled),
                        reason, assigned_by, assigned_at,
                        acknowledged_at, declined_at, decline_reason,
                        reminder_sent_at, escalated_at
period_bookings         teacher_id, date, period_number, purpose,
                        status(active|released|overridden),
                        overridden_by, override_reason, created_at
timetable_versions      label, status(draft|active|archived), effective_from,
                        effective_to, score, generated_at, created_by
```

### 6.3 Permission registry additions

Follow `20260720000001_permission_registry.sql`'s `(module, action, permission_code, description)`
shape and attach in `backend/src/modules/rbac/seed.ts`.

```
timetable.view                  (exists)
timetable.manage                (exists)
timetable.setup.manage          day templates, constraints, capabilities, rooms, plan
timetable.generate              run feasibility + generation, create drafts
timetable.publish               activate a draft / archive a version
timetable.export                bulk PDF/Excel export and print
timetable.workload.view         the workload dashboard
arrangements.view               see the daily queue and register
arrangements.manage             mark absences, assign/unassign substitutes
arrangements.override_booking   book over a teacher's protected free period
arrangements.acknowledge        act on one's own assignment (all teachers)
bookings.manage_own             book/release one's own free periods (all teachers)
```

---

## 7. Roles & permissions (feature #6)

Only the timetable module is enabled, so the role set is deliberately small.

| Role | Permissions |
|---|---|
| **School Admin / Principal** | Everything above, including `timetable.publish`, `arrangements.override_booking`, and receipt of all escalations. |
| **Timetable Manager** *(new role)* | `timetable.view`, `.manage`, `.setup.manage`, `.generate`, `.export`, `.workload.view`, `arrangements.view`, `.manage`. **Not** `timetable.publish` — activating a version is a principal act. **Not** `arrangements.override_booking` — see §8.11. |
| **Teacher** | `timetable.view` (scoped to own), `arrangements.acknowledge`, `bookings.manage_own`. |

### Scoping rules (server-enforced, per the invariant airtec already follows)

- A teacher's `GET /timetable` returns **their own week + their homeroom
  section's full grid**, nothing else. The existing page already does this;
  keep it and enforce it in the handler, not the UI.
- "See all vs. see mine" is decided by the **permission**, never by role name and
  never by a heuristic like *"no homeroom ⇒ unrestricted"*. That pattern is a
  privilege-escalation bug.
- Own-record endpoints (`acknowledge`, `decline`, `book`, `release`,
  `report-early-leave`) resolve the actor from the JWT and **ignore any
  `teacher_id` in the body**. A teacher passing a colleague's id must not widen
  anything.
- No dead buttons: every control gates on the same permission its endpoint
  requires.

---

## 8. Feature design — all 15 requests

### #1 Automated timetable generation — *port from edut*

`POST /timetable/generate` with `{ dayTemplateId, sectionIds[], effectiveFrom, seed?, keepLocked? }`.

Pipeline (edut `generate.ts`): feasibility gate → place locked cells → place
external occupancy from other sections' active timetables → place doubles
(adjacent, never spanning `breakAfter`) → place singles most-constrained-first →
swap-based local search over a weighted soft-penalty score → report.

Soft weights (edut defaults, tune after the first dry run): preferMorning 4,
same-subject-same-period-daily 2, consecutive-over-limit 6, spread-across-week 3,
class-teacher-P1 2, avoidPostLunch 3, avoidPeriod1 3, preferLast 2, day-balance 2.

Output is a **draft version**, never a live overwrite. Manager reviews, edits,
principal publishes. Must handle 16 sections × 6 days × 10 periods well inside
2 seconds (edut's stated budget is 24×6×8).

**Sequencing note:** this is worthless until `class_subject_plan` is populated,
which the importer derives in §9. Phase 3, not phase 1.

### #2 Conflict detection — *port from edut*

`conflicts.ts` verbatim. Codes and severities:

- **Block:** `TEACHER_DOUBLE_BOOKED`, `SECTION_SLOT_CONFLICT`, `ROOM_OVERBOOKED`,
  `QUOTA_UNMET`, `QUOTA_EXCEEDED`, `TEACHER_MAX_PER_DAY`, `TEACHER_MAX_PER_WEEK`,
  `BLOCKED_SLOT`, `DOUBLE_SPANS_BREAK`
- **Warn:** `CONSECUTIVE_OVERRUN`, `NO_FREE_PERIOD_DAY`, `SUBJECT_TWICE_A_DAY`,
  `HEAVY_LAST_PERIOD`, `UNDER_MIN_LOAD`
- **Info:** `CLASS_TEACHER_NOT_P1`

Surfaced in three places: live while editing a cell
(`POST /timetable/:id/validate-move` → `{ conflicts, suggestions }`), as a
pre-publish checklist, and on the import review screen. Every conflict is
clickable and jumps to the offending cell.

Resolution suggestions come from edut's `suggestSwaps` — *"swap VII-A Tue-P3 with
Thu-P5, no conflicts"* — rather than a bare "conflict!".

### #3 Customizable views

Extend the existing page. Views: **Day**, **Week** (default), **Class/Section**,
**Teacher**, **Master grid** (all 16 sections × periods), **Free-teacher matrix**
(day×period → who's free — the sheet this school does arrangements from by hand
today), **Room utilization** (stub). Filters: class, section, teacher, subject,
day. Month view is deferred — a 6-day repeating grid has no monthly information
except overrides and arrangements, so "month" becomes a *calendar of exceptions*,
which is genuinely useful and cheaper to build than a month grid.

### #4 Notifications & reminders

Infrastructure exists (in-app + web push + email, `notification_preferences`).
New notification types:

| Type | Trigger | To |
|---|---|---|
| `arrangement_assigned` | manager assigns cover | substitute |
| `arrangement_reminder` | no ack within N minutes | substitute |
| `arrangement_escalated` | no ack within M minutes | manager + principal |
| `arrangement_declined` | substitute declines | manager |
| `arrangement_cancelled` | original teacher returns (#15) | substitute + manager |
| `timetable_changed` | published change touching your week | affected teachers |
| `absence_detected` | no check-in and a period is starting | manager |
| `workload_breach` | teacher over configured cap | manager |
| `booking_overridden` | manager overrode a protected free period | teacher |

**The "just don't mark attendance" case is already half-built.**
`GET /students/timetable/attention-required` (`sis/routes.ts:1206`) already
cross-references `staff_attendance` against periods running right now and returns
reasons: `not_checked_in`, `absent`, `on_leave`, `no_checkin_time`,
`checked_in_late`. Promote it from a passive page into an active trigger: a cron
sweep that, once the day's first period has started and a teacher has no valid
check-in, **auto-creates a provisional `teacher_absences` row** (`source =
'attendance'`) and materializes the arrangement queue — pending one-click manager
confirmation, never silently.

### #5 Integration with the school management system

We are *inside* it. Concretely:

- Teachers are `users` rows; `staff_profiles` carries designation and subjects.
- Absence intake reads `leave_requests` (status `approved`) and
  `staff_attendance` — both already exist and are already populated by HR.
- `sections.class_teacher_id` feeds the ranking ladder.
- Notifications ride the existing delivery pipeline.
- Because only the timetable module is enabled for this school, the sidebar and
  role seed must be trimmed so the school does not see empty Fees/Admission
  screens. Add a school-level module flag; default the rest off for this tenant.

### #6 Roles and permissions — §7 above.

### #7 Export & print, in bulk

- **PDF:** per-section timetable, per-teacher timetable, master grid (A3
  landscape), free-teacher matrix, daily arrangement slip, arrangement register.
- **Bulk:** multi-select sections or teachers → one merged PDF, one page each,
  correct page breaks. This is the actual ask — the school prints 16 class
  timetables and 27 teacher timetables at session start.
- **Excel/CSV:** round-trippable with the importer, so the manager can bulk-edit
  offline. Export format must match import format exactly.
- **Image export** for WhatsApp circulation — ubiquitous in Indian schools and
  nearly free once PDF rendering exists.
- Print CSS on the existing page already has a `Printer` action; extend rather
  than replace.

### #8 Bulk view for the timetable manager

Master grid: rows = 16 sections, columns = P-I…P-X, one day at a time, with a
day switcher; cells show subject + teacher. Plus a **period-wise "who is where"**
pivot. Both need to stay readable at 16×10 — use the existing subject colour
scale in `timetable/shared.ts` (note: it will need entries for this school's
actual subjects — EVS, GK, Communication, Presentation, Robotics, Remedial-*).

### #9 Define everything up-front, edut-style

New **Timetable Setup** page, tabbed:

1. **Day Templates** — period rows with kind/number/times. This school needs two:
   *Junior (I–IV)* with 9 periods and *Senior (V–VIII)* with 10, both breaking
   after P-IV.
2. **Subjects** — canonical list, room type, placement preferences.
3. **Teachers** — capabilities (subject + priority 1/2/3 + class-level range) and
   constraints (max/day, max/week, min/week, max consecutive, arrangement caps,
   exempt flag, blocked slots).
4. **Rooms** — type and `capacity_groups` (stub, §D5).
5. **Class-Subject Plan** — per class/section: subject, weekly periods, double
   periods, assigned teacher. Live validation that Σ weekly periods = periods
   available (54 for I–IV, 60 for V–VIII) with a shortfall/overflow warning.
   Rejects two teachers on the same section+subject.

**The importer pre-fills all five tabs from the spreadsheet** (§9). The manager
reviews rather than types — the difference between a two-hour onboarding and a
two-week one.

### #10 Workload monitoring & redistribution

Dedicated page. Per teacher: periods/day across the week, periods/week, max
consecutive run, free periods/day and /week, arrangements this month, and a
band indicator against their configured min/max.

Views: a **heatmap** (27 teachers × 6 days), a **distribution chart** (this
school's 5→48 spread is the story), and a **breach list**.

Redistribution assist: for an over-loaded teacher, list their periods alongside
same-subject colleagues with remaining capacity, and offer a validated
"reassign this period" that runs `detectConflicts` before committing.

Seed the thresholds from §2.5, not from edut's defaults (§D4).

### #11 Teacher free-period booking — **design tension, read this**

Teachers book their own free periods for copy correction, event work, etc., and
the manager cannot take them.

**The problem with the literal version:** §2.6 shows the free pool is ~10 per
slot but concentrated in six people. If any teacher can hard-block any free
period at any time, a heavy-absence Monday has nobody left, and a teacher who
sees an absence notice can reactively book their free period to dodge cover.

**Recommended design — protection with guardrails:**

- A booking is a **hard block against routine scheduling** (the manager may never
  place a regular class there) and a **strong soft block against arrangements**
  (`−1000` on the ranking ladder, so the teacher is last, not absent).
- Bookings must be created **at least N hours ahead** (default: by 18:00 the
  previous day). No reactive booking after the day's absence queue is built.
- A **weekly cap** on protected periods (default 4), configurable. Teachers with
  14 free periods/week keep most of them; nobody becomes uncoverable.
- The manager can override only with `arrangements.override_booking` — which the
  Timetable Manager role **does not have** — requiring a written reason, an audit
  row, and a `booking_overridden` notification. Escalating to the principal to
  break a teacher's protected time is the correct amount of friction.
- A teacher can voluntarily **release** a booking, which the arrangement screen
  surfaces as "3 teachers released time for this slot".

If the school insists on absolute protection, the flag is one boolean — but ship
the guarded version and let the data argue.

### #12 Assignment acknowledgement & escalation

State machine:

```
unassigned → assigned → acknowledged
                   ↓
                declined  → back to unassigned (manager re-picks)
                   ↓
     (no ack in N min) → reminder_sent → (M min) → escalated
```

- `N` and `M` configurable; sensible defaults 15 and 30 minutes for same-day
  cover, longer for next-day.
- Reminders and escalations run on the existing node-cron sweep in
  `backend/src/index.ts` — same pattern as `runFeeReminders` / `runHrAlerts`.
- Escalation notifies the manager **and** the principal, and flags the
  arrangement red in the queue.
- Acknowledgement rate per teacher lands on the fairness dashboard. This is the
  number that changes behaviour.

### #13 Early departure mid-day

Teacher (or manager) files an early-leave from a given period. The system
computes the remaining affected periods for the rest of that day, creates a
scoped absence (`scope = 'early_leave'`, `effective_from_period = P`), and pushes
those periods into the arrangement queue **with the manager notified
immediately** — this is time-critical in a way a next-day leave is not. Ranked
candidates come from the same ladder, filtered to teachers free *right now*.

### #14 Full-day absence

Three intake paths, all landing in one queue:

1. **Planned** — approved `leave_requests` overlapping the date, synced nightly
   and on-demand ("Sync from approved leaves").
2. **Manual** — manager marks absent in the morning: full day / first half /
   second half / specific periods.
3. **Detected** — the `attention-required` cron (§4) proposes an absence from
   missing check-in; manager confirms with one click.

Materializing an absence creates one `arrangements` row per affected active
timetable period, status `unassigned`.

**Multi-absence solving:** when several teachers are out the same morning, the
queue must be solved *together* so one substitute is not assigned to two absent
teachers' classes in the same period. Assign-time re-validation is mandatory, not
optimistic.

**Ranking ladder** (edut `arrangements.ts`, ported):

```
+100  same-subject capability, priority 1   (+10 if class is in their level range)
 +80  priority 2
 +60  priority 3
 +40  already teaches this section (any subject)
 +30  class teacher of this section
  −2  × arrangements already this month        (fairness)
  −3  × periods already taught today           (protection)
 −10  did an arrangement yesterday             (rotation)
 −15  this would consume their only free period today
−1000 has an active booking in this slot       (#11)
```

Hard filters before ranking: absent today; blocked by availability; at
`max_per_day`; would exceed `max_consecutive`; at `arrangement_cap_day` or
`arrangement_cap_week`; `exempt_from_arrangements`.

Each candidate shows its reasons as chips — *"Free · Maths (primary) · 2
arrangements this month · 6 periods today"* — with one-click assign and manual
override always available.

**Long absence** (> 10 working days): stop generating daily arrangements. Offer a
temporary redistribution of that teacher's periods with an effective date range
that auto-reverts on return.

### #15 Teacher returns / cancels the arrangement

The absent teacher becomes available and cancels the cover.

- Teacher hits "I'm back" on the arrangement (or the absence).
- System marks remaining arrangements `cancelled`, restores the master timetable
  as the live view, and notifies the substitute ("cover cancelled — Mrs. Sharma
  is back"), the manager, and the class teacher.
- **Guardrail:** cancellation is blocked once the period has started, and
  requires manager confirmation if the substitute already acknowledged, so a
  substitute doesn't walk into a class that no longer needs them. Past periods
  stay in the register as delivered.

---

## 9. Importing `New Time table (1).xlsx`

This is the critical path for go-live and deserves its own phase.

**Pipeline:**

1. **Parse** — 6 sheets → 912 rows of `(day, section, period, subject, teacher)`.
   Structure is regular: header row of roman numerals, a times row, then
   alternating subject/teacher row pairs keyed by the section label in column A.
2. **Canonicalize with review** — fuzzy-group the 35 subject strings and 28
   teacher strings, present proposed merges to the manager for confirmation:
   - `Gk → GK`, `SSt → SST`, `Computer LAB`/`Computer  LAB` → `Computer Lab`
   - `emedial- Science → Remedial-Science`, `medial- English → Remedial-English`
   - `SST              Re` and `Sanskrit           Re` → flag for manual repair
     (truncated merged cells)
   - `Krishana → Krishna`
   - `Vishnu/ Preeti` → co-taught; v1 assigns the primary teacher and records
     the second in a note
   - `Zero` / `Zero/ READING` → decide with the school whether these are one
     subject
3. **Map sections** — `I A`, `IB`, `IIA`… → `classes` + `sections`, normalizing
   the inconsistent spacing.
4. **Derive setup data** — this is where the importer earns its keep:
   - two day templates (9-period Junior, 10-period Senior) from the times row
   - `subjects` rows from the canonical map
   - `class_subject_plan` rows by counting each section+subject's weekly periods
     and reading off the single teacher
   - `teacher_capabilities` at priority 1 for every subject a teacher actually
     teaches, with min/max class level from the classes they teach
   - `teacher_constraints` seeded from observed maxima (§D4)
5. **Validate** — run `detectConflicts` and show the report. It will surface
   Pooja Rai's two Thursday/Friday P-IX double-bookings (§2.4). The school
   resolves them, or accepts them as known.
6. **Commit** — write `timetable_periods` inside one transaction as an `active`
   version.

**Deliverables:** a `backend/src/modules/timetable/import/` parser with unit
tests over this exact file, and an import review screen. Round-trip requirement:
export → re-import must be a no-op.

---

## 10. Phases

Each phase ends shippable. Nothing after Phase 2 blocks go-live.

### Phase 0 — Foundations
Migrations (§6), permission registry rows, `Timetable Manager` role in
`rbac/seed.ts`, module-flag so this tenant sees only Timetable + HR, engine
copied to `backend/src/modules/timetable/engine/` with edut's 690-line test
suite green.
**DoD:** `subject_id` backfilled, engine tests pass, new role can log in and see
exactly the right sidebar.

### Phase 1 — Import & truth *(go-live blocker)*
XLSX parser, canonicalization review screen, setup-data derivation, conflict
report, transactional commit.
**DoD:** the spreadsheet round-trips; all 16 sections render correctly; the two
known conflicts are reported; setup tabs are pre-filled.

### Phase 2 — Operate *(go-live blocker)*
Setup page (5 tabs), all views (§3, §8), live conflict validation on edit, absence
intake (3 paths), arrangement queue with the ranking ladder, assign/unassign,
notifications, acknowledgement + reminder + escalation cron, arrangement register.
**DoD:** a full simulated day — two teachers absent, one detected from missing
check-in, all periods covered, acknowledged, one escalation fired, register
printable.

### Phase 3 — Watch & protect
Workload dashboard + heatmap + breach list + redistribution assist; free-period
booking with guardrails; early-leave (#13); return/cancel (#15); fairness
dashboard.
**DoD:** the workload page reproduces §2.5 from live data; a protected booking
survives a manager's assignment attempt and requires principal override.

### Phase 4 — Export & bulk
Bulk PDF (sections, teachers, master, matrix, slips, register), Excel round-trip,
image export, print CSS.
**DoD:** one click produces 16 class PDFs and 27 teacher PDFs, correctly
paginated.

### Phase 5 — Generate
Feasibility pre-check, generation, drafts, versions, publish workflow, partial
regeneration, safe-swap suggestions.
**DoD:** generation reproduces a *valid* timetable for all 16 sections in under
2 seconds with a reported score, and the school compares it against their own.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Defaults fire on everyone.** edut's `maxConsecutive = 3` vs this school's observed 8. | §D4 — seed from measured data; make the workload page the place thresholds get set. |
| **Import canonicalization guesses wrong.** 35 subject strings, truncated cells. | Human review screen. Never auto-merge silently. |
| **Free-period booking starves the substitute pool.** Six teachers hold most slack. | §8.11 guardrails: advance-notice window, weekly cap, soft block on arrangements, principal-only override. |
| **The engine gets forked.** Two divergent copies of 2,170 lines. | §D2 — pure directory, no Supabase import, CI check. Fix bugs in both. |
| **Generation is attempted too early**, before `class_subject_plan` is trustworthy. | Phase 5, behind feasibility gating that refuses with named bottlenecks. |
| **Existing 1362-line page becomes unmaintainable** as views multiply. | Split into view components during Phase 2 rather than after. |
| **Teachers don't acknowledge**, so escalation becomes noise. | Track acknowledgement rate per teacher; make it visible; tune N/M with the school in week one. |
| **No RLS on new tables.** airtecv2 gates in the app layer. | Match the existing pattern consistently; every handler filters on `school_id` from the JWT. |
| **`subject_name` → `subject_id` migration breaks `/academics/my-classes`** and homework/syllabus scoping. | Keep both columns; migrate readers incrementally; regression-test the teacher's homework flow. |

---

## 12. Open questions for the school

1. Is P-XI (14:00–14:35) genuinely unused, or is it used for something not on
   this sheet (remedial, clubs, staff meeting)?
2. Is the 10:10–10:30 slot labelled "LUNCH" the only break in a 6.5-hour day?
3. Are `Zero` and `Zero/ READING` one subject or two?
4. `Vishnu/ Preeti` — co-teaching, or a rotation?
5. Are Pooja Rai's Thursday/Friday P-IX remedial slots a real merged III-A + III-B
   group, or an error? (If merged, we need the combined-class model.)
6. Should `max_consecutive` block or only warn? Current practice runs to 8.
7. Are arrangements compensated? If so, the register must feed payroll later.
8. Who is the Timetable Manager, and should they be able to publish, or only the
   principal?
9. Do teachers have devices for push notifications, or is email/SMS the realistic
   channel?
10. Saturday: is it a full day? The sheet shows a full 9/10-period Saturday.

---

## 13. Sources

**Codebase**
- `/Users/kartik/Developer/Personal/edut/timetable.md` — 393-line sourced
  requirements study (Indian school context)
- `/Users/kartik/Developer/Personal/edut/timetable-design.md` — implementation
  contract
- `/Users/kartik/Developer/Personal/edut/packages/modules/academics/src/services/engine/` — the engine
- `airtecv2` — `supabase/migrations/`, `backend/src/modules/sis/routes.ts`,
  `frontend/app/(app)/timetable/`

**External**
- [Wikipedia — School timetable / timetabling problem (NP-hard)](https://en.wikipedia.org/wiki/School_timetable)
- [Constructing School Timetables Using Simulated Annealing (Management Science)](https://pubsonline.informs.org/doi/10.1287/mnsc.37.1.98)
- [Simulated Annealing-Based Algorithm for a Real-World High School Timetabling Problem (IEEE)](https://ieeexplore.ieee.org/document/5632136)
- [Tabu Search Techniques for Large High-School Timetabling Problems](https://www.researchgate.net/publication/3411974_Tabu_Search_Techniques_for_Large_High-School_Timetabling_Problems)
- [An Efficient Tabu Search Heuristic for the School Timetabling Problem (Springer)](https://link.springer.com/chapter/10.1007/978-3-540-24838-5_35)
- [TimetableMaster — Auto-Substitute Systems Explained](https://www.timetablemaster.com/blogs/auto-substitute-systems-explained)
- [TimetableMaster — Teacher Substitution Software](https://www.timetablemaster.com/teacher-substitution-software)
- [TimetableMaster — Best Timetabling Software India](https://www.timetablemaster.com/best-timetabling-software-india)
- [OpenEduCat — Substitute Teacher Management guide](https://openeducat.org/articles/substitute-teacher-management-software-guide/)
- [MyLeadingCampus — Timetable & Substitution Management (India)](https://www.myleadingcampus.com/school-erp-features/best-timetable-substitution-management-school-india)
- [MySchoolOne — Timetable Management](https://myschoolone.com/timetable.php)
- [ESS — Managing Substitute Teacher Scheduling](https://ess.com/blog/articles-managing-substitute-teacher-scheduling/)
- [NYC Public Schools — Handbook for Substitute Teachers (acknowledgement & escalation)](https://pwsblobprd.schools.nyc/prd-pws/docs/default-source/default-document-library/handbook-for-substitute-teachers.pdf)
- [TASB — Are Teacher Planning Periods Untouchable?](https://www.tasb.org/news-insights/are-teacher-planning-periods-untouchable) (protected-time precedent for #11)
- [UFT — Preparation periods](https://www.uft.org/news/you-should-know/know-your-rights/preparation-periods)
