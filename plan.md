# Making `fee_category` do something

A plan for turning the inert category label into the thing it is mistaken for.

> **Status: all four phases built and applied.** Migrations `20260813` (rules),
> `20260814` (families + sibling order) and `20260815` (RTE claims) have been run
> against the development database. The rules table starts EMPTY, so nothing a
> school is billed changes until somebody answers the questions in §7 and fills
> it in. What already changed without configuration: RTE seats are off the
> defaulters list and off the 7 AM reminder sweep, and scholarships now reduce a
> bill instead of being decorative.
>
> Verified end to end against the live data — see "What was checked" at the foot
> of this file.

Written against the code as it stands on `fee-overhaul`. Every claim about the
current behaviour below was checked against the source or the database, and the
check is named so it can be re-run.

---

## 1. Where we actually are

`fee_assignments.fee_category` is one of `general | rte | staff_ward | sibling |
scholarship`, `NOT NULL DEFAULT 'general'`, on a table with `UNIQUE (student_id,
academic_year_id)` — so it is one value per student per year, attached to the
plan they are on, not to the student.

What reads it:

| Consumer | Reads it? | Evidence |
|---|---|---|
| Billing (`lib/resolve.ts`) | Selects it, branches on nothing | `resolve.ts:88` — it is in the `select` string and appears nowhere else in the function |
| `/fees/daybook/by-category` | Yes — the only real consumer | `daybook.ts:303` |
| Student fee profile | One word of grey text | `collect/student/[id]/page.tsx:128` |
| Defaulters / recovery | **No** | `grep -c category recovery.ts` → 0 |
| Reminder sweep | **No** | `grep -c category feeReminders.ts` → 0 |
| Invoices, receipts, portal | **No** | — |

So an admin tags forty children "RTE", and the system bills them the full plan,
invoices them, marks them overdue, and has the 7 AM sweep text their parents
demanding money the state is supposed to pay. Nothing warns anybody. The tag
changed a number on one report.

**The second-order damage** is that the report built on it is not trustworthy
either. Because the category never reduces anything, `concession_on_invoices`
is filled from `fee_invoices.discount_total` while `students_with_concession`
counts `fee_discounts` rows — two different tables that routinely disagree. The
current data shows 16 approved concessions and **₹0** ever discounted off an
invoice, because every concession was created after its invoices were raised.
That is now surfaced as a warning (`daybook.ts:359`, added this week), but
surfacing it is triage, not a fix.

---

## 2. The thing the model gets wrong

The five values are not five flavours of the same thing. They are **three
different financial shapes** wearing one column:

**a. A discount the school chooses to give.** `sibling`, `staff_ward`.
Revenue forgone, funded by nobody. The school's own decision, reversible,
and the amount is a school policy (10% for the second child, 50% for a staff
child).

**b. A receivable from a third party.** `rte`. This is the one the current
model gets most wrong. Under RTE §12(1)(c) the school admits the child, charges
them nothing, and claims reimbursement from the state **at a rate the state
sets, not the rate the school charges** — ₹2,242 per child per month for
classes I–V in Madhya Pradesh, plus a ₹1,100/annum uniform subsidy, with
comparable state-by-state schedules elsewhere. Reimbursement is routinely late.

So an RTE seat is simultaneously:
- ₹0 owed by the family — not a debt, not a default, must never appear on a
  chase list or in a reminder;
- ₹X owed to the school **by the state**, at a different rate, ageing, and worth
  reporting on separately from parent dues.

Modelling that as "a student with a 100% discount" throws away the receivable
entirely. Modelling it as "outstanding" — what happens today — defames the
family.

**c. Funded by a named third party.** `scholarship`. `fee_scholarships`
already exists with a `funding_source` (`government | trust | school |
corporate | other`) and an `amount`, and is not connected to billing at all.
This is nearly the right shape already; it is just orphaned.

`general` is the absence of all three.

---

## 3. How this is built elsewhere

Three consistent patterns across the systems I looked at:

**The family is a first-class record, and the billing unit.** PowerSchool
identifies siblings through shared guardian records; Blackbaud makes the family
the payer with a head of household. Siblings are *derived from membership*, not
typed in.

**`sibling_order` is derived and self-maintaining.** Finalsite numbers siblings
from the highest grade down, counting only actively enrolled students, and
**recalculates whenever any sibling enrols or withdraws**. Half- and
step-siblings are excluded unless the relationship is set explicitly. Fee rules
then read the number:

```
sibling_order = 1  →  full tuition
sibling_order = 2  →  5% off
sibling_order = 3  →  10% off
```

A useful corollary: a **per-family** charge (one registration fee per household,
not per child) is expressed as a line that applies only when `sibling_order = 1`.
That is the same shape as the `period_tokens` work just shipped, in the family
dimension rather than the time dimension.

**The concession is produced by a rule, not typed by a human.** The category (or
the derived order) is an *input*; the discount row is an *output*. Nobody hand-
grants forty RTE concessions and nobody forgets to.

### What we cannot copy yet

`parents` is a per-student blob of text columns — `father_name`, `father_phone`,
`mother_name`, no family key. Checked against the live database:

```
parent rows:                                     841
distinct father_phone values:                    841
phones shared by more than one student:            0
```

There is no household in this schema. "Sibling" is not currently a
representable fact, which is exactly why it degenerated into a label somebody
types. **Phase 2 below is the precondition for automatic sibling anything.**

---

## 4. The design

Four layers, of which we currently have half of one.

```
  student → family                      (Phase 2)
              ↓ derives
          sibling_order                  (Phase 2)
              ↓ feeds
  fee_concession_rules  ←  fee_category  (Phase 1)
              ↓ produces
      fee_discounts  →  buildLineItems   (exists)
              ↓
          invoice line
```

Two principles worth stating because they are the ones easy to violate:

1. **Rules produce discount rows; they do not bypass them.** The rule engine
   writes (or resolves) a `fee_discounts`-shaped concession and the existing
   `buildLineItems` applies it. This keeps one path to money off a bill, keeps
   the approval workflow meaningful, and keeps every concession explainable on a
   receipt. A rule that silently reduced a line without a discount row would be
   unauditable.

2. **An invoice already raised is never rewritten.** That is a deliberate
   property of this module and it should stay. The rule fires at invoice-build
   time. What changes is that grants stop arriving *after* the bill, because
   nobody is hand-granting them any more.

---

## 5. Phases

Ordered so each one is independently useful and shippable. Phase 1 delivers most
of the value and touches one function.

### Phase 1 — Category drives a concession rule

**The point:** a student tagged `sibling` gets the school's sibling concession
automatically, at billing time. `fee_category` stops being a label.

**Schema**

```sql
CREATE TABLE public.fee_concession_rules (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

    -- What triggers it. Exactly one category per rule per year keeps
    -- "which rule applied?" answerable without a precedence table.
    fee_category     text NOT NULL CHECK (fee_category = ANY (
                       ARRAY['rte','staff_ward','sibling','scholarship'])),

    -- What it does. Same vocabulary as fee_discounts, deliberately, so the
    -- rule and a hand-granted concession are the same kind of thing.
    discount_type    text NOT NULL CHECK (discount_type IN ('percentage','fixed')),
    discount_value   numeric(12,2) NOT NULL CHECK (discount_value >= 0),
    -- NULL = every head. Otherwise this head only (tuition-only is the
    -- common real policy — schools rarely waive exam or transport).
    fee_head_id      uuid REFERENCES fee_heads(id) ON DELETE RESTRICT,

    is_active        boolean NOT NULL DEFAULT true,
    note             text,
    created_by       uuid REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, academic_year_id, fee_category, fee_head_id)
);
```

**Code**

- `lib/resolve.ts` — load the year's active rules once per run; for each
  student, match on `assignment.fee_category` and append to the
  `ApplicableDiscount[]` already passed into `buildLineItems`. This is a ~15
  line change to a function that already does exactly this for hand-granted
  concessions.
- Mark rule-derived concessions distinctly in the line item (`source: 'rule'`
  vs `'granted'`) so a receipt can say *why* — "Sibling concession (policy)"
  reads better than an unexplained deduction, and a parent will ask.
- **Precedence must be decided, not discovered.** Proposal: a rule and a
  hand-granted concession both apply, hand-granted first, and the total is
  capped at the line amount. `feeMoney.buildLineItems` already clamps; verify it
  does under two stacked discounts before relying on it.

**UI** — a Rules panel under Concessions → Approval authority (that tab is
already "the policy tab"). Five rows, one per category, each "no rule" or a
type/value/head.

**Also fix in this phase**, because they are the same defect:
- `recovery.ts` — add a category filter to defaulters, and **exclude `rte` from
  the chase list by default**. This is the single highest-value line in the
  whole plan: it stops the school dunning families for state money.
- `feeReminders.ts` — same exclusion for the 7 AM sweep.

**Effort:** ~1 day. **Unblocks:** the category means something; the
"16 granted, ₹0 applied" gap closes on its own because rules fire at build time.

---

### Phase 2 — Families and `sibling_order`

**The point:** stop hand-identifying siblings.

**Schema**

```sql
CREATE TABLE public.families (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name       text,                    -- "Yadav (Rakesh)" — for humans only
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.students ADD COLUMN family_id uuid REFERENCES families(id);
CREATE INDEX idx_students_family ON students(family_id);
```

**Backfill** — a script, not a migration, because it must be reviewable:
group `parents` rows by normalised `father_phone`, then `mother_phone`, then
`father_aadhaar`. Current data yields **zero** groups, so on this database the
backfill is a no-op and every student starts in a family of one. That is the
honest outcome and it must not be disguised: real sibling data has to be
entered or imported. Ship a review screen showing proposed groupings before
writing anything.

**`sibling_order`** — derived, never hand-edited. Computed as: among active
students sharing a `family_id`, order by class `numeric_level` descending, then
`created_at` ascending; number from 1. Recomputed on admission, withdrawal,
status change and promotion. Start as a plain function called by those four
paths; promote to a maintained column only if a report needs to filter on it.

**Rule engine gains a second condition type** — `sibling_order >= 2` alongside
`fee_category = 'sibling'`. Once this works, `fee_category = 'sibling'` becomes
redundant and should be *deprecated rather than deleted*: keep accepting it,
stop offering it in the UI.

**Effort:** ~2–3 days including the review screen. **Unblocks:** sibling
concessions maintain themselves; per-family one-off charges (`sibling_order = 1`)
become expressible.

---

### Phase 3 — RTE as a receivable, not a discount

**The point:** an RTE seat is ₹0 from the family **and** ₹X from the state. The
second half does not exist anywhere today.

```sql
CREATE TABLE public.rte_reimbursement_claims (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    period_key        text NOT NULL,        -- same tokens as fee_invoices
    -- The STATE's rate, which is not the school's fee. Storing the school's
    -- figure here is the mistake this table exists to prevent.
    claim_amount      numeric(12,2) NOT NULL,
    status            text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','submitted','received','rejected')),
    submitted_on      date,
    received_on       date,
    received_amount   numeric(12,2),
    reference         text,
    UNIQUE (student_id, academic_year_id, period_key)
);
```

Plus a per-class state rate table (`rte_rates`: class range → ₹/month →
year), because the rate is set per state per year and differs by class band.

**Report:** RTE ageing, separate from parent dues — claimed / received /
outstanding, by period. This is the number the trust board actually wants and
the reason the category exists at all.

**Effort:** ~2 days. **Unblocks:** the school can see what the state owes it,
which no amount of tagging currently reveals.

---

### Phase 4 — Retire the tail

- Connect `fee_scholarships` to billing as a funded concession (it has
  `funding_source` and `amount` already and is used by nothing).
- CSV export on the by-category report — it is screen-only today, so it cannot
  go into a board pack or an RTE claim without retyping.
- Drop `fee_category = 'sibling'` from the UI once Phase 2 is trusted.

---

## 6. What not to build

- **Do not auto-apply concessions to invoices already raised.** The module's
  guarantee that issued paper matches what was billed is worth more than the
  convenience. Rules firing at build time make the problem go away from the
  front instead.
- **Do not invent RTE or staff-ward percentages.** They are school and state
  policy. Phase 1 gives the school a place to enter theirs; guessing 100% for
  RTE would be wrong in every state where the reimbursement rate is below the
  school's fee and the school may charge the difference.
- **Do not make `fee_category` multi-valued.** A child who is both a staff ward
  and a second sibling is a real case, but it is a precedence question, and
  precedence is better handled by stacking explicit concessions with a cap than
  by a set-valued category nobody can report on.

---

## 7. Decisions needed from the school before Phase 1

1. Sibling concession: what percentage, on which heads, from which child?
2. Staff ward: percentage, and does it differ for teaching vs non-teaching?
3. RTE: does the school charge the family the gap between the state rate and
   its own fee, or nothing at all? This changes whether the rule is 100% or
   a computed remainder.
4. Do concessions stack, and is there a floor?

Phase 1 is buildable without these — the rules table starts empty and the
system behaves exactly as it does today until somebody fills it in. But it
delivers nothing until they are answered.

---

## 8. Recommended order

Phase 1, then stop and look. It is a day's work, it converts the label into a
lever, and the two lines that exclude RTE from the chase list and the reminder
sweep fix a live harm on their own. Phases 2 and 3 are worth doing but are
weeks-scale in aggregate and should be chosen deliberately, not slid into.

---

## Sources

- [Sibling Discounts & Family-Based Fees — Finalsite Enrollment](https://schooladmin.zendesk.com/hc/en-us/articles/6219084851725-Sibling-Discounts-Family-Based-Fees)
- [Family Management — PowerSchool SIS](https://ps.powerschool-docs.com/pssis-admin/latest/family-management)
- [Family — Blackbaud Tuition Management](https://webfiles-sc1.blackbaud.com/files/support/helpfiles/tuition-management/content/st-family.html)
- [RTE: Process and rules for reimbursement of fee — MP Education Portal](http://educationportal.mp.gov.in/RTE/PrivateSchools/ProcessRulesForReimbursementOfFees.aspx)
- [RTE fee reimbursement — Government of Karnataka](https://schooleducation.karnataka.gov.in/19/rte-fee-reimbursement/en)
- [Reimbursements under RTE Section 12(2) — RightToEducation.in](https://righttoeducation.in/reimbursements-under-rte-section-122-too-little-too-late)
- [School Billing and Tuition Management Software — Classter](https://www.classter.com/blog/edtech/school-billing-and-tuition-management-software-a-complete-guide-for-administrators/)

---

## What was checked

Run against the development database, with every fixture cleaned up afterwards.

**Rules turn a category into money** — one RTE student and one general student on
the same quarter:

```
BEFORE any rule            RTE      subtotal 6900  discount    0  net 6900
AFTER  RTE = 100% off      RTE      subtotal 6900  discount 6900  net    0   [RTE concession]
AFTER  RTE = 25% off       RTE      subtotal 6900  discount 1725  net 5175   [RTE concession]
```

The general student showed `discount 5000 [State Merit Scholarship]` throughout —
a scholarship that had been sitting in `fee_scholarships` reducing nothing since
the model rewrite.

**A rule with no condition is refused** by the check constraint, so nobody can
discount the whole school by leaving a field blank.

**Sibling order derives and re-tiers itself**, senior child first:

```
#1 of 3  Hrithik Chopra (Class 4)   subtotal 5000  discount    0  net 5000   [no concession]
#2 of 3  Rahul Singh    (Class 2)   subtotal 8100  discount 1620  net 6480   [Concession from the second child]
#3 of 3  Dhruv Verma    (Class 1)   subtotal 5000  discount 5000  net    0   [Concession from the second child, State Merit Scholarship]

after withdrawing the eldest → orders are now 1, 2
```

No backfill and no trigger: the view recomputes, so an admission or a withdrawal
re-tiers the discount the same day.

**RTE claims price from the state's rate, not the school's fee:**

```
Q1 2026-04-01 → 2026-06-30
₹2,242/month × 3 months = ₹6,726 per child
re-running the same period: refused (idempotent, per the unique index)
claimed ₹20,178 · received ₹5,000 · still owed ₹15,178
```

**Tests:** 325 passing, 19 files, no failures. That includes 16 new assertions on
the concession arithmetic and 4 on the reminder exclusion — and the three
`feeReminders` tests that had been red on this branch, which turned out to be
fixtures still stubbing a `fee_payments` sum that `fetchPaidByInvoice` stopped
doing at the model rewrite.

**Typecheck:** backend, frontend and portal produce no new errors.

## Still to do

- `npm run backfill:families` is written but has only ever been run in dry mode.
  On this data it groups nobody — 841 parent rows, 841 distinct phones — so real
  sibling data has to be imported before Phase 2 does any work here.
- The rules table is empty. Until §7 is answered it changes nothing.
- `fee_category = 'sibling'` is still offered in the UI, marked as the legacy
  path. Retire it once the derived order is trusted.
