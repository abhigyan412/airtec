# Fee Module — Remediation Status

**Date:** 10 August 2026
**Against:** `docs/fee-module-production-readiness.md` (9 Aug 2026)
**Scope:** 7 CRITICAL, 15 HIGH, 14 MEDIUM, plus compliance notes

---

## Where it stands

| | Before | Now |
|---|---:|---:|
| CRITICAL open | 7 | **0** |
| HIGH open | 15 | **0** |
| MEDIUM open | 14 | **3** (partial/deferred) |
| Money paths inside a transaction | 0 | **3 of 3** |
| Tests covering money movement | 0 | **33** |
| Backend tests passing | 323 / 325 | **356 / 358** (same 2 pre-existing RBAC failures) |
| Ledger reconciliation | did not exist | **3 invariants, all passing** |
| Fee tables with RLS | 0 of 19 | **19 of 19** |

**`PAYMENT_PROVIDER` stays `mock`**, declared explicitly in `render.yaml` and `.env.example`. The simulator still runs end to end; what changed is who may drive it and what signs its callbacks.

---

## The seven blockers

| # | Finding | Status | What was done |
|---|---|---|---|
| **C0** | Finance dashboard understated by 46% — PostgREST's silent 1,000-row cap | ✅ **Fixed** | `/stats`, `/classes`, `/collection-trend`, day-book totals moved into Postgres aggregates (`fee_stats`, `fee_class_positions`, `fee_collection_by_day/month`, `fee_daybook_totals`). Everything that genuinely needs the rows uses a new paging helper, `selectAll()` in `shared/db/paged.ts`, which **throws above a ceiling rather than truncating**. Verified live: **₹1,83,18,461 billed across 1,762 invoices**, where the capped read reported ₹99,26,925 / 1,000. |
| **C1** | Any parent could zero their own bill with two HTTP requests | ✅ **Fixed** | `/simulate` now requires `fee.collect` in production (parents keep the flow locally, per your call). `activeProvider()` refuses to default to mock in production. The order response carries `can_complete`, so the portal stops offering a Pay button it cannot honour. |
| **C2** | Webhook signing key was a public constant in the repo | ✅ **Fixed** | `'dev-mock-secret'` deleted. Production requires `PAYMENT_WEBHOOK_SECRET`; development generates a random per-process key. `?provider=` is ignored entirely. Mock order ids are random, not derivable. **Verified**: a callback signed with the old constant is rejected. |
| **C3** | Overpayment guard aggregated *before* it locked | ✅ **Fixed** | `fee_recalc_invoice` locks then aggregates; `fee_sync_unallocated` now locks at all; one global lock order (payments → invoices) removes the deadlock between the two triggers. **Verified with two concurrent sessions**: one receipt written, the second refused with "That is 15050.00 more than the 0.00 outstanding". |
| **C4** | A redelivered webhook double-charged | ✅ **Fixed** | Atomic claim — `UPDATE … WHERE status='created' RETURNING` — with a new `'capturing'` state, plus an idempotency key derived from the provider's own payment id. The claim is released on failure, which is safe *because* collect is now one transaction. |
| **C5** | Arrears carry-forward could double-count permanently | ✅ **Fixed** | `fee_carry_forward_arrears()`: one transaction, and invoices are closed **from the arrears table** rather than from the insert's return value, so a re-run repairs whatever a half-finished run stranded. Pinned by a test that recreates the stranded state. |
| **C6** | No transactions on any money path | ✅ **Fixed** | `fee_collect_payment`, `fee_bounce_payment`, `fee_carry_forward_arrears`. Collect locks the open invoices **before** deciding the split, issues the receipt, writes allocations and posts the ledger in one transaction, with an idempotency key. The hand-rolled "delete the payment again" compensation is gone. |

---

## High severity

| # | Finding | Status | What was done |
|---|---|---|---|
| H1 | Receipt's part-payment banner always printed ₹0 | ✅ Fixed | The template read `r.invoice.*` — an object the backend never sent. Now reads `r.session`, `r.lines[0].invoice_number`, `r.summary.balance_remaining`. Figures print to the paisa (`formatCurrencyExact`), and `amount_in_words` is now computed from the figure printed beside it. |
| H2 | Every fee screen but one rendered API failure as ₹0 / "all clear" | ✅ Fixed | Shared `<QueryError>` in both apps. Applied to the fee dashboard, day book, aging report, defaulters, arrears, approvals, receipts, invoices, analytics, category breakdown, RTE claims, homeroom, both student-fee screens, the online-payment warning card, and the parent portal hero. |
| H3 | Parent pay flow breaks on a real gateway; "Simulate failure" shown to parents | ✅ Fixed | `confirm()` no longer calls `/simulate` unconditionally; the `checkout` object is read; the Simulate-failure button moved inside the `simulated` guard; a "not available yet" state replaces a Pay button the caller cannot complete. |
| H4 | `percent_monthly` late fee charged on gross — a 20× overcharge | ✅ Fixed | Base is now the **unpaid** fee portion (`amount_paid` was selected and never used). ₹500 owing on a ₹10,000 invoice at 2%/month for 60 days is ₹20, not ₹400. |
| H5 | Late-fee sweep silently reversed approved waivers | ✅ Fixed | New `fee_invoices.late_fee_waived` column; the waiver records what it forgave and the sweep deducts it, so a forgiven fine stays forgiven. |
| H6 | Silent 1,000-row truncation across the module | ✅ Fixed | Same work as C0, extended to the reminder sweep, RTE claim generation, billing/assignment targets, `alreadyBilled`, `categoryOfStudents`, forecast and `/by-category`. `selectIn` now pages *within* each chunk. |
| H7 | Late-fee income double-counted across instalments | ✅ Fixed | Removed by construction: income is recognised when the fine is **levied**, once (`postLateFee`), not re-credited on every payment that touches the invoice. |
| H8 | Scholarships list ignored section scope | ✅ Fixed | Now uses `studentsEmbed` + `scopeInvoiceQuery` (an inner join — a left join would hide the name and still leak the amount), and paginates. |
| H9 | Webhook mounted ahead of the rate limiter | ✅ Fixed | Its own limiter, 60/min. **Verified**: 58×400 then 12×429 across 70 rapid posts. |
| H10 | Arrears could be waived but never collected | ✅ Fixed | "Record payment" action + dialog on the arrears tab, gated on `fee.collect`. The endpoint existed and had zero callers. |
| H11 | Double-click on approve posted twice | ✅ Fixed | The request is claimed atomically **before** `apply()` runs, and released if the action fails. Write-off amounts are re-derived rather than taken from a stale snapshot. Concessions got the same treatment. |
| H12 | Four indexes destroyed by migration ordering | ✅ Fixed | Live check found **11** lost, not 4. All recreated plus new ones on `fee_assignments`, `fee_discounts`, `fee_adhoc_charges`, `fee_scholarships`, `fee_arrears`, `fee_payment_allocations`. Fee-table index count: 20 → **67**. |
| H13 | No timezone configured anywhere | ✅ Fixed | `TZ=Asia/Kolkata` pinned at process start (`shared/utils/timezone.ts`, imported before anything reads a date) and declared in `render.yaml`. **Critically, the offsets were fixed in the same change**: `dayStartISO`/`dayEndISO` carry an explicit offset, because naive `${date}T00:00:00` bounds were resolved in the *database's* timezone regardless of the process. Day-book and trend buckets now cut on the school's day. |
| H14 | Webhook signature failures never logged | ✅ Fixed | Rejections logged with provider, signature presence, body size and IP. Plus an hourly reaper for orders stuck at `created`/`capturing` — the silent half of "a parent says they paid and it isn't showing" — which flags mid-capture orders separately as needing a human. |
| H15 | `resolve.ts` ignored the error on `fee_concession_rules` | ✅ Fixed | Now throws. Billing without concession rules charges every RTE, sibling, staff-ward and scholarship student the full amount, on paper, silently — there is no version of "carry on" that beats stopping. |

---

## Medium severity

| Finding | Status | What was done |
|---|---|---|
| No RLS on any of the 19 fee tables | ✅ Fixed | All 19 enabled with the same `school_isolation` policy the 7 baseline tables carry. **Note:** RLS-off is this schema's *documented* convention (three migrations disable it explicitly) and the backend uses the service-role key, so this is defence-in-depth and changes no current behaviour — see the migration comment. |
| 40 unchecked database error returns | ⚠️ **Mostly fixed** | Every one with a money or access consequence is now checked — including the four that failed *dangerously*: the concession monthly cap (read as "nothing spent"), the ad-hoc cancel guard (read as "nothing paid"), the fee-head delete count (read as "unused", hard-deleting a head in use), and the receipt's balance read (printed ₹0 owing). A handful of cosmetic lookups still destructure `data` only. **No ESLint rule was added** — see Not done. |
| Zero tests on money movement | ✅ Fixed | 33 new tests: 9 on the paging helper (with a mock that *enforces* a server cap smaller than the page size, so it can tell correct paging from the old loop), 24 against the real database on collect/bounce/carry-forward/ledger/stats. |
| The ledger is write-only; receivable permanently negative | ✅ Fixed | Completed onto the accrual basis it was always written for (`postWriteOff` has always assumed it): invoices post `Dr receivable / Cr income`, payments credit receivable. 1,762 historical invoices backfilled and 578 payment credits re-pointed, arithmetic-preserving. Added `fee_trial_balance`, `fee_reconciliation()` and `GET /fees/reconciliation`. **Live: all three invariants pass, ledger balances to 0.00 across 5,636 entries.** |
| Ledger not immutable | ✅ Fixed | `UPDATE`/`DELETE` refused by trigger; corrections are reversing entries. |
| `ON DELETE CASCADE` on invoice/payment `student_id` | ✅ Fixed | Changed to `RESTRICT`. Receipt numbers are a gapless sequence a school must be able to produce. |
| `money()` mis-rounds above ~2.0 | ✅ Fixed | `Number.EPSILON` is the ULP at 1.0 and a no-op by 4.475. Now rounds the decimal via `toPrecision(12)`, half-away-from-zero so negatives are symmetrical. `money(4.475)` → **4.48**. |
| Concession ceilings enforced on creation but not approval | ✅ Fixed | The ceiling now applies to the approver (School Admin exempt, as elsewhere). It was previously only a *routing* rule — the escalation went to whoever clicked first. |
| Eight money-moving actions write no audit log | ✅ Fixed | Added on carry-forward and the auto-approved concession path; replays deliberately write none. |
| One-click concession approve/reject from a table row | ✅ Fixed | Confirmation dialog + optional note, matching the Approvals screen — and the note is now actually sent (it was dropped). |
| School-wide late-fee sweep had no preview | ✅ Fixed | `?preview=true` returns what would change with a sample and a net figure; the UI confirms against it. Failures are reported instead of counted out silently. |
| Day Book defaults to the wrong day for 5½ hours | ✅ Fixed | Uses `todayLocalISO()`, which already existed in `frontend/lib/utils.ts` with zero callers. |
| Receipt prints figures at 0 dp, words at full precision | ✅ Fixed | See H1. |
| Migrations applied by hand | ❌ **Not done** | Still no runner. See below. |
| No observability (metrics, alerting) | ⚠️ **Partial** | Reconciliation endpoint, signature-failure logging, the order reaper and the reminder sweep's skip count are all now visible. **No metrics backend or alerting** — nothing pages anyone. |

---

## Not done, and why

| Item | Why |
|---|---|
| **Migration runner** | Deliberately skipped. Adding one now, mid-remediation, means the first thing it does is reconcile 23 previously hand-applied migrations whose `statements` were never recorded — a job that wants its own change and your judgement about the baseline. The four new migrations are idempotent and safe to re-run. |
| **Metrics / alerting** | The invariants and the signals now exist and are queryable; wiring them to a monitor is a deployment decision (which service, who gets paged) rather than a code one. |
| **Razorpay sandbox end-to-end** | Needs credentials I do not have. The driver is still deliberately unimplemented; `openCheckout()` handles a hosted redirect and says so plainly otherwise. |
| **DPDP consent record / GST fields** | Left alone on purpose — your own audit says "one conversation with your accountant settles it, don't build first", and the same is true of consent schema. |
| **ESLint rule for unchecked errors** | The instances were fixed; the rule to stop new ones was not added. |

---

## Two things you should know

**1. Something was running old code against your database.** Four ledger rows in a school named "Test" (timestamps 12:00–12:08 UTC today) credit `fee_income` for a payment — a posting only the *pre-fix* `postPayment` produces, and they appeared **after** the accrual migration ran. Most likely a dev server started before these changes. That school still reconciles cleanly (both sides zero), so I left the data alone rather than bypass the immutability trigger I had just added. Worth confirming no other process is running the old build.

**2. A bug the tests caught that psql could not.** `fee_collect_payment` used an unqualified `DELETE` on a temp table. That works as superuser in psql — which is how I first verified it — and fails with SQLSTATE 21000 on the role PostgREST connects as, because Supabase enables a safe-update guard there. It would have broken **every payment in the product** while my manual verification said it was fine. It is fixed, and it is the reason the money tests go through the app's own client rather than a psql session.

---

## Re-verify any of this

```bash
# C3 — lock ordering: FOR UPDATE must come BEFORE sum()
psql "$DATABASE_URL" -tAc "select prosrc from pg_proc where proname='fee_recalc_invoice'" \
  | grep -nE "sum\(|FOR UPDATE"

# C0 — the true figures, in one round trip
psql "$DATABASE_URL" -c "select jsonb_pretty(fee_stats('<school-id>', null));"

# The ledger, and whether it agrees with the invoices and the cash
psql "$DATABASE_URL" -c "select jsonb_pretty(fee_reconciliation('<school-id>'));"
psql "$DATABASE_URL" -tAc "select round(sum(debit)-sum(credit),2) from fee_ledger_entries;"   # 0.00

# C2 — the old repo constant must no longer sign anything
BODY='{"order_id":"x","payment_id":"y","status":"paid","amount":100000}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac 'dev-mock-secret' -hex | sed 's/.*= //')
curl -s -X POST localhost:4000/api/fees/gateway/webhook \
     -H "x-webhook-signature: $SIG" -d "$BODY"          # {"error":"Invalid signature"}

# H12 — indexes
psql "$DATABASE_URL" -tAc "select count(*) from pg_indexes
  where schemaname='public' and tablename like 'fee_%';"                 # 67

# The money suite
cd backend && npx vitest run src/shared/utils/__tests__/feeMoneyPaths.test.ts \
                            src/shared/db/__tests__/paged.test.ts
```

---

## Ship gate

Your own gate was: **C1–C6 closed, money tests passing, reconciliation job live.** All three are met. The remaining work is the migration runner, alerting, and a Razorpay sandbox run when credentials exist — none of which block taking real money through the counter.

*Companion: `fee-module-production-readiness.md` (the audit), `fee-module-ux-improvements.md`.*
