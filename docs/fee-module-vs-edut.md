# What airtecv2's fee module has that edut's doesn't

Compared against `/Users/kartik/Developer/Personal/edut` — specifically
`packages/modules/fees/`, `packages/db/prisma/sql/003*–004*_fee*.sql` and
`apps/web/src/app/(app)/fees/`.

Both modules cover the same ground at a similar size (edut ~49 fee routes,
airtecv2 52). The differences are not about scope — they are about **where
correctness is enforced** and **which failure modes are made visible**.

A closing section lists what edut has that we don't, because half a comparison
is a misleading one.

---

## 1. The balance is a fact of the database, not a convention

**airtecv2:** `fee_invoices.amount_paid` is a real column maintained by an
`AFTER INSERT/UPDATE/DELETE` trigger on `fee_payments`, and `status`
(`unpaid`/`partial`/`paid`) is *derived* from it by
`fee_invoice_derive_status()`. Application code never writes either.

**edut:** no triggers on any fee table
(`grep -l "CREATE TRIGGER" packages/db/prisma/sql/*fee*.sql` → no matches).
Balances are computed in the service layer and written back by the caller.

This is the single largest structural difference, and it removes four classes of
bug at once:

- **The two-cashier race.** Recording a payment used to be
  insert → read-all-payments → update-status across three un-transactioned
  round-trips. Two people recording simultaneously both read the pre-insert total
  and both wrote `partial`, leaving a fully paid invoice open. The trigger runs
  inside the payment's own transaction, so the second insert cannot read a stale
  total.
- **Nine handlers, nine answers.** "How much is still owed" was re-derived in
  every route that needed it, and they disagreed. There is now one definition.
- **Pagination became possible.** `/dues`, `/aging-report` and `/defaulters` used
  to fetch every open invoice and then sum `fee_payments` in 150-id chunks before
  returning a single row. They are now ordinary indexed queries.
- **A self-checking invariant.** `amount_paid` must equal the sum of effective
  payments for every invoice — verifiable in one query, and verified after every
  migration in this codebase.

## 2. Overpayment is refused by the database

The trigger raises `check_violation` when payments exceed `total_amount`, so it
holds for *every* path that inserts a payment — the invoice endpoint, the
installment endpoint, the seed script, a manual fix in the SQL editor.

Verified live: paying ₹11,645 against a ₹1,645 balance is rejected. Before, that
insert was accepted and flipped the invoice to `paid`.

> **edut handles this differently rather than not at all** — it posts the excess
> to an `advance` liability account (`2100`). That is arguably the better
> *product* behaviour and airtecv2 does not have it (see §11). The distinction is
> that airtecv2 makes the wrong state *impossible*, where edut makes it *handled*.

## 3. Aging and defaulter tracking

**airtecv2:** `GET /fees/aging-report` buckets open invoices by days overdue
(`current`, `1–30`, `31–60`, `61–90`, `90+`) with counts and totals;
`GET /fees/defaulters?min_days_overdue=` groups by student with total
outstanding, worst-overdue days, and **parent contact numbers for chasing**.

**edut:** neither exists. `grep -rn "aging\|defaulter"` across its fee services,
handlers and web client returns nothing. The `buckets` in its `reports.ts` are
class-section groupings, not aging bands.

edut's `arrears` table is a per-student **snapshot** (`outstanding`, `overdue`,
`as_of`, unique per student) — a cached current position, not an aging analysis.

## 4. Year-over-year arrears carry-forward

**airtecv2:** `POST /fees/arrears/carry-forward` moves each unpaid invoice's
remaining balance from one academic year into the next as a tracked
`fee_arrears` row, idempotently, and **retires the source invoice** to a terminal
`carried_forward` status.

That last part is the substance. Without it the same rupees appear in `/dues`,
`/aging-report`, `/defaulters` and `stats.total_due` *and* in `/arrears` —
every outstanding figure in the product inflates the moment a school rolls over a
year. Fixing that double-count was one of this module's headline bugs.

**edut:** `arrears` has no `from`/`to` academic year, no source invoice link and
no carry-forward operation. It is a different concept sharing a name.

## 5. Optional fees that are actually optional

**airtecv2:** `fee_structures.is_optional` is honoured by the billing resolver,
backed by `fee_optional_opt_ins` (student × structure). A transport fee priced
for a class bills **only the students who take the bus** — currently 22 of 55 in
Class 1, 42 of 116 in Class 11.

**edut:** no optional-fee concept. `grep -rn "optional\|opt_in"` across its fee
services and schemas matches only Zod `.optional()` calls.

edut's nearest equivalent is `feeCategory` on the student (`general`, `rte`,
`staff_ward`, `sibling`, `scholarship`), which segments *who is billed what* —
useful, but it cannot express "this specific extra, for these specific children".

## 6. Per-role discount ceilings with auto-approval

**airtecv2:** `fee_discount_limits` gives each role a `max_single_discount` and
`max_monthly_total`. A concession inside the ceiling is approved the moment it is
granted; anything above routes to the Principal. The Setup screen lists **only
roles that hold `fee.discount`** (4 of your 16) and flags any without a ceiling,
since an unset ceiling silently means zero.

**edut:** has discount approval (`discount_approval_logs`, an approvals queue)
but no configurable per-role ceiling — `grep "max_single\|threshold"` across
`discounts.ts` and `approvals.ts` returns nothing. Approval routing is not
amount-driven.

## 7. Idempotent bulk billing with a real identity

**airtecv2:** every generated invoice carries `period_key`
(`quarterly:Q2`, `monthly:2026-07`) under a partial unique index on
`(school_id, student_id, academic_year_id, period_key)`.

Both products preview before billing and skip already-billed students. The
difference is that airtecv2's guarantee is a **database constraint** rather than
a service-layer check: a double-submitted run, two admins clicking at once, or a
retry after a timeout cannot double-bill anyone. edut's `alreadyAssigned` count
is computed in application code, so a concurrent run can slip past it.

The period is also derived from the academic year's own start date, so an
April–March school gets Q1 = Apr–Jun with no configuration.

## 8. A billing form driven by the data, not by the schema

The generate screen offers **only cadences and categories that actually have
amounts configured**. With this school's data — 36 annual, 24 monthly, 19
quarterly, 4 half-yearly — choosing "Quarterly" and ticking an annual-only
category used to produce zero invoices with no explanation until preview.

Skipped students are always reported with a reason
(`already_billed`, `no_fee_structure`, `no_class`, `optional_not_taken`) rather
than silently dropped — a class that goes unbilled for a term because nobody
priced it is exactly the failure the list exists to surface.

## 9. Fee reads are scoped by ownership, uniformly

One helper — `resolveFeeScope()` — returns `school` / `section` / `student` and
every read applies it. A parent sees their child, a class teacher their homeroom,
staff with `fee.view` the school.

This closed a live hole: `GET /fees/invoices`, `/defaulters` (which includes
parents' phone numbers), `/aging-report`, `/discounts` (with reasons like
"financial hardship"), `/arrears` and `/stats` were readable by **any**
authenticated account, including the parents of the families listed.

edut is not weaker here in principle — it enforces tenancy with Postgres RLS,
which is stronger isolation than application-layer scoping. What it does not have
is the *intra-tenant* narrowing: parent-sees-own-child, teacher-sees-own-section.

## 10. Money arithmetic extracted and tested

`shared/utils/feeMoney.ts`, `billingPeriod.ts` and `amountInWords.ts` are pure,
database-free modules with **68 tests at 100% statement/branch/function
coverage**, following the repo's own documented convention that real logic moves
to `shared/` where the 90% threshold applies.

Coverage includes the cases that actually broke: late fines surviving a discount
recompute, multiple concessions capping at the line amount, lakh/crore grouping
(₹1,50,000 = "One Lakh Fifty Thousand", not "One Hundred Fifty Thousand"), and
period windows cut from a non-January academic year.

edut has integration tests for its fee flows
(`apps/api/tests/integration/fees-*.test.ts`, six files) — good coverage of
behaviour, but the arithmetic is not isolated as independently testable units.

## 11. Smaller things

| | airtecv2 | edut |
|---|---|---|
| Per-school document numbering | `UNIQUE (school_id, invoice_number)` | global unique — two schools collide on `INV202500001` |
| Payment status lifecycle | `captured` / `cancelled` / `refunded` + `refunded_amount`, all netted by the trigger | cancellation exists; no partial-refund column |
| One-off charges | raised as a real invoice line, so collectable and receiptable | `ad_hoc_fees` settled separately |
| Late-fine sweep | school-scoped, bounded concurrency, rebases off the fee portion so a discount isn't undone | per-structure late-fee rules (richer config, see below) |
| Fee-position browse | class × section → student → collect, plus student search | class × section → student → collect |

---

## What edut has that we don't

Stated plainly, because these are real gaps:

1. **Double-entry accounting.** Payments post to a chart of accounts
   (`1200` cash, `1210` bank, `2100` advance, `4100` fee income, `4110` late fee)
   via `fee_transactions`. airtecv2 has no ledger at all. This is the biggest
   structural thing we lack.
2. **Payment gateways.** Razorpay and Cashfree adapters behind a registry, with
   `payment_gateway_requests` and `payment_reconciliation`. airtecv2 is
   counter-only — no online collection.
3. **Advance payments.** Overpayment becomes a liability balance rather than
   being refused. Better product behaviour than our hard rejection.
4. **Scholarships.** A first-class `scholarship_records` concept with funding
   source, distinct from discounts.
5. **Full refunds.** `fee_refunds` + `refund_requests` with their own workflow.
   Ours are requests that adjust a payment, not a tracked refund ledger.
6. **Structure versioning.** Named, coded structures with version / clone /
   archive / supersede. Ours are flat `(class, head, year)` rows with no history.
7. **Richer late-fee rules.** Per-structure mode
   (`fixed` / `per_day` / `percent_monthly`) with grace days. Ours is a flat
   per-day rate on the class amount.
8. **Payment allocation records.** `fee_payment_allocations` explicitly records
   how one payment was split. We infer it from the receipt-number group.
9. **Tax codes** on fee heads.
10. **RLS.** Row-level security enforced in the database, not just the app.

---

## Summary

The honest framing: **edut is the more complete financial product; airtecv2 is
the more defensively built one.**

edut has the ledger, the gateways, the scholarships and the versioning — the
things a school finance office eventually needs, and which we would have to build.

What airtecv2 has instead is a fee module where the money cannot silently go
wrong: the balance is enforced by the database, overpayment is impossible,
carry-forward can't double-count, optional means optional, and the arithmetic is
unit-tested. Most of that came from fixing bugs that were live in this codebase,
which is why the list reads the way it does — each item is a failure that
actually happened here, closed at the lowest level it could be.

The two lists are complementary rather than competing. Items 1, 2 and 3 from
edut's column are the ones worth taking next.
