# Fee Module — Production Readiness Assessment

**Date:** 9 August 2026
**Scope:** `backend/src/modules/fee/**` (17 files, ~5,600 lines, 73 routes), 19 `fee_*` tables, staff UI, parent portal
**Method:** four parallel specialist audits (security, money correctness, reliability, frontend) plus direct verification against the running system and live database. Every CRITICAL below was re-verified by hand before being written down.

---

## Verdict

**Not production ready. Do not connect a real payment provider or take real money.**

There are **seven CRITICAL defects**. Three are directly exploitable, two lose money silently under concurrency, and **one is reporting wrong figures on screen right now** — not at some future scale, today, on this database.

Two findings are not subtle:

- **A parent can zero their own fee bill with two HTTP requests.**
- **The finance dashboard is understating what the school has billed by 46%.**

| | |
|---|---|
| CRITICAL | 7 |
| HIGH | 15 |
| MEDIUM | 14 |
| Routes with no auth guard | **0** ✓ |
| Fee tables with RLS | **0 of 19** |
| Money paths inside a transaction | **0** |
| Tests covering money movement | **0** |

**Estimated effort to production-ready: 4–5 focused weeks.**

---

## The seven blockers

### C0 — The finance dashboard is wrong by 46%, today

`reports.ts:22` and ~15 other reads · **verified live on this database**

PostgREST caps a single response at **1,000 rows**. Exactly one place in the module respects that — `allOpenDatedInvoices` in `recovery.ts`, whose comment explains the cap and slices around it. Every other bulk read assumes it does not exist.

`fee_invoices` currently holds **1,760** non-cancelled rows. Measured just now:

| `GET /fees/stats` | Database truth | Error |
|---|---:|---:|
| Billed ₹99,26,925.47 | ₹1,83,10,961.50 | **−₹83,84,036 (46% understated)** |
| Collected ₹17,40,003.00 | ₹94,18,793.00 | **−₹76,78,790 (82% understated)** |
| Invoices 1,000 | 1,760 | capped |

No error is raised. The number simply arrives short, and every screen built on it repeats it confidently.

**This threshold is ~1,000 invoices, which is about 250 students on quarterly billing.** Any real school is already past it.

Same defect, same silence, in roughly fifteen more places — the ones that matter most:

| Endpoint | Consequence past 1,000 rows |
|---|---|
| `/aging-report` | The school's entire receivables position, silently short |
| `/classes` | Per-class billed/collected/outstanding all understated |
| `/collection-trend` | Trend chart shows a fraction of real collections |
| `/apply-late-fees` | Fines an **arbitrary** 1,000 invoices — no `ORDER BY`, so a re-run fines a different 1,000 |
| `/arrears/carry-forward` | Carries 1,000, **reports success**, leaves the rest owing in a retired year |
| `categoryOfStudents` (recovery) | Students past #1,000 default to `general` → **RTE families reappear on the chase list with their parents' phone numbers** |
| `feeReminders` invoice scan | Everyone past invoice #1,000 **never receives a reminder, ever** — and the log prints `checked: 1000` and looks healthy |
| `/rte/claims/generate` | Claims raised for only 1,000 seats — **money the state owes, never claimed** |
| `/forecast`, `/by-category` | Headcounts capped → forecast is a fraction of reality |

**Fix.** Extract the existing slice loop from `recovery.ts` into `lib/db.ts` as a `selectAll()` helper that pages **and throws above a hard ceiling rather than truncating**, then route every read above through it. Better still for the four pure aggregates (`/stats`, `/classes`, `/by-category`, `/collection-trend`): move the `SUM`/`GROUP BY` into Postgres RPCs — `/stats` becomes one round trip returning six numbers instead of streaming 20,000 rows.

> Note the existing slice loop is itself fragile: its page size must exactly equal the server cap. Lower `max-rows` to 500 and the loop terminates after one batch, silently halving the defaulters list.

### C1 — Any parent can mark their own fees paid, in production

`gateway.ts:284` · `lib/providers.ts:189` · `render.yaml`

`POST /fees/gateway/orders/:id/simulate` is guarded only by `if (!provider.isSimulated)`. `activeProvider()` returns the **mock** driver whenever `PAYMENT_PROVIDER !== 'razorpay'` — and **neither `render.yaml` nor `.env.example` declares `PAYMENT_PROVIDER` at all** (verified). A deploy from this repo therefore runs simulated, and the route is wide open. There is no `NODE_ENV` check anywhere in the file (verified).

The route requires only `attachFeeScope` — **not** `fee.collect` — so a parent passes it for their own child. The portal already calls it (`PayDialog.tsx:67`).

**Exploit — two requests, no special tooling:**
```
POST /api/fees/gateway/orders            {}                    → amount defaults to full outstanding
POST /api/fees/gateway/orders/<id>/simulate {"outcome":"paid"}
```
`capture()` then runs the *identical* path as a real webhook: a real `fee_payments` row with a sequential receipt number, real allocations, real ledger entries (Dr cash, Cr fee_income), invoices flipped to `paid`, and a `PAYMENT_ONLINE_CAPTURED` audit row. **Nothing downstream can distinguish it from money.** A class teacher (section scope) can do it for every child in their homeroom.

**Fix.** Require `NODE_ENV !== 'production'` *and* `fee.collect`. Make `activeProvider()` **throw at boot** in production when `PAYMENT_PROVIDER` is unset rather than silently defaulting to mock. Declare both vars in `render.yaml` and `.env.example`.

> This is my code and I got it wrong. I previously reported this route as "verified safe — it refuses when a real provider is configured." That statement was true and useless: no provider is configured, so it never refuses.

### C2 — The webhook signing key is a public constant in this repo

`lib/providers.ts:66` (verified) · `gateway.ts:259` (verified)

```ts
private secret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-mock-secret'
const providerName = String(req.query.provider ?? process.env.PAYMENT_PROVIDER ?? 'mock')
```

`PAYMENT_WEBHOOK_SECRET` is not declared anywhere in deployment config, so the mock signs with the literal string above — which is in version control. The webhook is deliberately unauthenticated.

**Exploit, with no login at all:** forge `{"order_id":"mock_order_<hex>","payment_id":"x","status":"paid","amount":<paise>}`, sign it `HMAC-SHA256(body,'dev-mock-secret')`, POST it. Order ids are *deterministic* — `mock_order_${orderId.replace(/-/g,'').slice(0,18)}` — so anyone who has ever created one order can forge captures.

Independently: the driver is chosen from an **attacker-supplied query parameter**, so even a correctly configured Razorpay deployment can be addressed as `?provider=mock`.

**Fix.** Delete the `?? 'dev-mock-secret'` fallback — throw if unset. Ignore `req.query.provider` entirely. Add a random nonce to the mock order id.

### C3 — The overpayment guard doesn't hold: the trigger aggregates before it locks

`20260809000000_fee_model_rewrite.sql` → live function verified in the database

```
line  4:  SELECT COALESCE(sum(...)) INTO v_paid FROM fee_payment_allocations …   ← no lock
line 14:  SELECT total_amount … FROM fee_invoices WHERE id = … FOR UPDATE;        ← lock, too late
line 17:  RAISE EXCEPTION (overpayment guard)
```

Under READ COMMITTED the aggregate runs *before* the row lock, so two concurrent transactions each compute a stale `v_paid`. `FOR UPDATE` serialises the write but both have already decided what to write.

**Worked scenario.** Invoice total ₹5,000, unpaid. Two cashiers each take ₹5,000 at the same moment.
- A: sums ₹5,000 → locks → writes `amount_paid = 5000` → commits.
- B: sums ₹5,000 (A uncommitted) → blocks → A commits → B checks `5000 > 5000.01`, false → writes `amount_paid = 5000`.

**Result: ₹10,000 in the drawer, two receipts, allocations summing ₹10,000, `amount_paid` = ₹5,000.** ₹5,000 is collected, receipted, and in no invoice, no advance and no arrear. It is simply gone from the books.

**Fix — three lines:** lock first, then aggregate.
```sql
PERFORM 1 FROM public.fee_invoices WHERE id = p_invoice_id FOR UPDATE;
SELECT COALESCE(sum(...)) INTO v_paid FROM public.fee_payment_allocations …
```
Same defect in `fee_sync_unallocated`, which takes no lock at all.

> **Correcting my earlier assessment.** I previously wrote that trigger-maintained money columns were "race-safe under concurrency" and called it "the single best structural decision in the module." The *design* is right; the *implementation* is not. The lock ordering defeats it. I should have read the function body rather than inferring safety from the presence of a trigger.

### C4 — A redelivered webhook double-charges

`gateway.ts:187` (guard is a read) · `gateway.ts:230` (claim is a write, after the money row exists, error unchecked)

Providers retry aggressively; Razorpay fires `payment.captured` more than once as normal behaviour. Both deliveries read `status='created'`, both pass the guard, both call `collectPayment()`.

**Result: ₹18,000 charged once by the provider, ₹36,000 recorded**, two receipts, one an orphan. The unique index that exists is on the *orders* table and both writers target the same order row, so it never fires.

**Fix.** Claim atomically before doing any work:
```sql
UPDATE fee_payment_orders SET status='capturing'
 WHERE id=$1 AND status='created' AND payment_id IS NULL RETURNING *;
```
Zero rows → return 200 "already". Add `'capturing'` to the status CHECK.

### C5 — Arrears carry-forward can double-count permanently, and a retry cannot fix it

`recovery.ts:302–317` — the invoice-retirement updates have **no error check**

Upsert arrears succeeds; one chunk of invoice updates fails. Now 512 arrears rows exist while 150 source invoices are still `unpaid` — **₹1,80,000 counted twice**, in `fee_arrears` *and* in `/dues`, `/aging-report`, `/defaulters`. This is precisely the double-count the design exists to prevent.

**It does not self-heal.** The upsert uses `ignoreDuplicates: true`, so a re-run returns only *new* rows, and `closed` is derived from that result — the 150 stranded invoices are never closed by any retry. Permanent until someone writes SQL by hand.

### C6 — No transactions on any money path

Verified: not one fee write path uses `.rpc()` except `next_document_number`. Every money operation is a chain of independent HTTP calls to PostgREST.

`collectPayment()` — which runs on **every** payment, counter and online — is five separate transactions. Failure between the payment insert and the allocation insert leaves a ₹10,000 payment settling nothing, which `fee_sync_unallocated` then converts into a **₹10,000 advance credit that does not exist**. The same ₹10,000 is simultaneously reported as `advance_held` and as outstanding.

The bounce path is worse: it deletes allocations *before* updating status, with **no error check on the status update**. A failure between them leaves a payment still marked `captured` with no allocations → a phantom advance credit a cashier can spend.

**Fix.** Move each to a Postgres function: `fee_collect_payment` (with an idempotency key), `fee_bounce_payment`, `fee_generate_period_invoices`, `fee_carry_forward_arrears`, `fee_decide_request`.

---

## High severity

| # | Finding | Location |
|---|---|---|
| H1 | **The printed receipt's part-payment banner always prints ₹0.** `printReceipt.ts` reads `r.invoice.outstanding_after`, `r.invoice.session`, `r.invoice.invoice_number` — the backend returns none of them (verified). A parent paying ₹2,000 of ₹10,000 gets paper saying nothing remains unpaid. This is the exact dispute the banner exists to prevent. | `printReceipt.ts:117,122,130` |
| H2 | **Every fee screen but one renders API failure as ₹0 / "all clear."** The parent portal tells a family owing ₹40,000 that they are "all paid up." The defaulter list shows "Nobody is behind." The double-charge warning card removes itself. 21 instances; only `structures/page.tsx` handles `isError`. | 21 sites |
| H3 | **The parent pay flow breaks the day you connect a real gateway.** `PayDialog.confirm()` *always* calls `/simulate`, which returns 400 once a provider is configured. The `checkout` object the backend already returns is never read. Also, a **"Simulate failure" button renders to parents right now** — it sits outside the `order.simulated` guard. | `PayDialog.tsx:63–84,192` |
| H4 | **`percent_monthly` late fee is charged on the gross invoice, not the overdue balance.** ₹500 outstanding on a ₹10,000 invoice, 60 days late, 2%/month → charges **₹400 instead of ₹20. A 20× overcharge**, compounding as the balance shrinks. `amount_paid` is selected and never used. | `recovery.ts:246–252` |
| H5 | **The late-fee sweep silently reverses approved waivers.** Nothing records that a fine was forgiven, so the next sweep recomputes and re-applies it. A family is chased for money the school formally waived, and the ledger disagrees with the invoice. | `recovery.ts:225` vs `requests.ts:157` |
| H6 | **Silent 1,000-row truncation.** PostgREST caps responses at 1,000 rows. `/stats` computes school-wide `total_billed`, `total_collected` and `collection_rate` from at most 1,000 invoices — a school with 1,600 invoices **reports its finances ~40% short**. Also hits `apply-late-fees`, `carry-forward`, `aging-report`. | `reports.ts:22`, `recovery.ts:229,288` |
| H7 | **Late-fee income is double-counted across instalments.** `invoice.late_fee` is the *total* fine, not the unrecovered remainder, so every payment re-claims it. Two payments on one ₹500 fine post ₹1,000 of late-fee income. Debits still equal credits, so nothing looks wrong. | `lib/collect.ts:130` |
| H8 | **Scholarships list ignores section scope.** The one route that reads `req.feeScope` and fails to apply it. A class teacher — needing no `fee.view` — gets every scholarship in the school: names, amounts, funding source. | `discounts.ts:452` |
| H9 | **The webhook is mounted ahead of the rate limiter.** The only unauthenticated money-moving endpoint has no rate limit — unbounded HMAC guessing. | `index.ts:83` vs `:99` |
| H10 | **Arrears can be waived but never collected.** `POST /arrears/:id/payment` exists; **nothing in the UI calls it.** The portal tells parents to "settle that at the office," where no such control exists. The only way to clear an arrear in the product is to write it off. | `recovery.ts:352`, UI absent |
| H12 | **Four indexes were destroyed by migration ordering and never recreated.** `fee_model_rewrite.sql` `DROP TABLE … CASCADE`s tables the previous migration had just indexed. Verified live: **`fee_discounts`, `fee_adhoc_charges` and `fee_scholarships` now have *only* a primary key — no query index at all**, and `fee_assignments` (the module's hottest lookup table, seq-scanned by the nightly sweep and every `/defaulters` load) has only a PK and one unique. | live DB |
| H13 | **No timezone is configured anywhere.** No `TZ` env, no `Asia/Kolkata` string. `toLocalDateStr` uses the process timezone, which on any container is UTC — so "local" means UTC throughout, and several comments claiming IST-correctness describe an intent the code does not implement. **A ₹8 lakh collection taken on the evening of 31 March files into April** — the one date an Indian school cannot get wrong. Setting `TZ` alone makes the day book *worse*; the offsets must be fixed in the same change. | module-wide |
| H14 | **Webhook signature failures are never logged.** Rotate `PAYMENT_WEBHOOK_SECRET` or misconfigure the provider dashboard and every payment in the school silently 400s — no log, no counter, no alert. Orders sit at `created` forever with no reaper. This is the exact failure mode behind "a parent says they paid and it isn't showing," and it is unobservable. | `gateway.ts:272` |
| H15 | **`resolve.ts` ignores the error on `fee_concession_rules`.** On any transient DB error `rules = []` → **every RTE, sibling, staff-ward and scholarship student on the run is billed the full plan amount**, invoices are issued, and nothing says so. | `lib/resolve.ts:195` |
| H11 | **Double-click on approve posts twice.** `apply()` runs before the request is marked decided and nothing claims it. A refund approved twice posts ₹6,000 to the ledger against a ₹3,000 payment. Write-offs also use a stale snapshot amount. | `requests.ts:133–209` |

---

## Medium severity — summary

- **No RLS on any of the 19 fee tables.** Worse than never having it: the baseline migration *did* enable RLS with a `school_isolation` policy on `fee_heads`, `fee_invoices`, `fee_payments`, `fee_structures`. The model rewrite `DROP TABLE … CASCADE`d all four and recreated them without it. Not currently exploitable — verified no `NEXT_PUBLIC_SUPABASE_*` and no client-side Supabase import — so this is defence-in-depth. One future browser-side Supabase client turns it into a full breach.
- **40 unchecked database error returns** in the fee module. Each silently yields `undefined` and produces a confidently wrong number. This has already caused a live outage: a helper querying a dropped column made **every fee reminder fail silently** for weeks.
- **Zero tests on money movement.** 325 tests exist and 323 pass, but no test imports anything from `modules/fee` beyond two pure helpers. `collect.ts`, `ledger.ts`, `gateway.ts`, the bounce reversal and invoice generation have never been executed by a test.
- **The ledger is write-only.** Nothing reads `fee_ledger_entries`. No trial balance, no Dr=Cr assertion, no reconciliation. Invoices are never posted at all, so `receivable` is only ever credited and runs permanently negative. Arrear payments take cash with no payment row, no receipt, no ledger entry and no audit log.
- **`ON DELETE CASCADE` on `fee_invoices.student_id` and `fee_payments.student_id`.** Deleting one student erases every invoice, payment and receipt number for that child. Financial records must be `RESTRICT`.
- **`money()` mis-rounds above ~2.0.** `Number.EPSILON` is the ULP at 1.0 and is a no-op at larger magnitudes: `money(4.475)` → `4.47`, should be `4.48`.
- **Concession ceilings are enforced on creation but not on approval.** A Counselor holding only `fee.discount` can approve an unbounded concession raised by someone else.
- **Eight money-moving actions write no audit log** — including the auto-approved concession path, so the only concessions with a trail are the ones that needed review.
- **Migrations are applied by hand.** No runner, no applied-state tracking, no rollback.
- **No observability.** No metrics, no alerting, no reconciliation report. The "captured at provider but not recorded" case — a family charged for nothing — only writes to stdout.
- **One-click concession approve/reject** from a table row, no confirmation, while the identical decision elsewhere requires a dialog and a note.
- **School-wide late-fee sweep has no preview and no confirmation**, unlike every other bulk write in the module.
- **Day Book defaults to the wrong day for the first 5½ hours of IST** — uses UTC where the rest of the codebase correctly uses `todayLocalISO()`.
- **Receipt prints figures at 0 dp but words at full precision** — ₹1,234.50 prints as "₹1,235" alongside "…and fifty paise". A self-contradicting receipt on the one field meant to be tamper-proof.

---

## What is genuinely strong

Listed because it should not be rebuilt, and because it is why the estimate is weeks not months.

- **The allocation model.** One payment → N allocations → one receipt. Verified live: ₹3,200 settling three invoices, one receipt number.
- **Authorization coverage.** All 73 routes carry a guard; **zero unguarded routes**. Scope helpers are applied correctly at every site but one (H8). Parent scoping verified under adversarial test — a forged `student_id` in the body yields an order for the caller's *own* child.
- **`next_document_number` is genuinely race-free** — a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
- **Billing idempotency is correct** — `fee_invoices_period_uniq` plus a 409 translation. The one multi-write path that is safe.
- **Discount proration is exact.** Verified: a ₹4,000 scholarship across lines of ₹3,333.33 / ₹500 / ₹166.67 spends down to precisely ₹4,000.00.
- **Webhook signature handling is correct in shape** — HMAC over the raw body, `timingSafeEqual`, mounted ahead of the JSON parser, terse failure message. It is the *key management* (C2) that fails, not the crypto.
- **Amount re-derived server-side** and capped at outstanding — a tampered amount cannot underpay.
- **Period keys deliberately exclude the academic year's renameable name**, so renaming "2025-26" cannot unlock re-billing.
- **RTE modelled as a debtor rather than a 100% discount** — correct, and excluded from defaulters while *tallying* the exclusion rather than dropping it silently.
- **Four-eyes on both approval paths**, with the School Admin escape hatch explicitly audited.
- **No SQL string concatenation anywhere**; every column name passed to a filter is a hardcoded literal.

---

## Recommended sequence

**Before anything else — one afternoon, closes both exploitable holes**
1. C1 + C2 together: fail closed on missing `PAYMENT_PROVIDER` / `PAYMENT_WEBHOOK_SECRET`, delete the `'dev-mock-secret'` fallback, ignore `?provider=`, gate `/simulate` on non-production **and** `fee.collect`.

**Week 1 — stop losing money**
2. **C0 row cap** — the `selectAll()` helper, applied first to `/stats`, `/aging-report`, `categoryOfStudents` and the reminder sweep. Your dashboard is wrong by 46% until this lands.
3. **H12 indexes** — pure SQL, no code change, ~20 lines. Recreate the four lost ones and add indexes to `fee_assignments`, `fee_discounts`, `fee_adhoc_charges`, `fee_scholarships`.
4. C3 lock ordering (three lines, highest value per character in this document)
5. C4 atomic order claim
6. H4 late-fee base, H5 waiver reversal, H15 concession-rules error check — all single-line, all directly overcharge families
7. Fix the 40 unchecked error returns; add an ESLint rule

**Week 2 — make failure survivable**
6. C6: `fee_collect_payment` + idempotency key; `fee_bounce_payment`
7. C5: `fee_carry_forward_arrears`
8. The ~30-test money suite (allocation, ledger balance, bounce restoration, gateway idempotency, access control)

**Week 3 — correctness at scale**
9. H6 pagination sweep on the seven unbounded scans
10. RLS on all 19 tables
11. Trial balance + daily reconciliation job; ledger immutability

**Week 4 — the rest**
12. H1 receipt fields, H2 error states, H3 pay flow, H10 arrears collection
13. Audit-log gaps, `ON DELETE RESTRICT`, `money()` rounding
14. Migration runner; Razorpay sandbox end-to-end

**Ship gate:** C1–C6 closed, money tests passing, reconciliation job live.

---

## Compliance (India) — flag for your lawyer, not legal advice

- **DPDP Act 2023** applies: schools and EdTech are named, and **verifiable parental consent** is required for processing a minor's data. There is no consent record in the schema. Behavioural tracking and targeted advertising toward children are prohibited outright (you do neither — document that). Obligations phase in over 18 months from the Rules.
- **PCI DSS:** Razorpay *hosted* checkout keeps you in **SAQ-A**, the lightest tier. The current redirect + webhook shape is right. Do not move to a self-hosted card form. SAQ-A still requires a script inventory, CSP and SRI on the payment page.
- **GST:** core tuition is exempt; transport, hostel and uniform may not be. No GSTIN/HSN fields exist. One conversation with your accountant settles it — don't build first.

---

## Appendix — re-verify any claim

```bash
# C1/C2: is a provider configured for production? (expect: nothing)
grep -n "PAYMENT_PROVIDER\|PAYMENT_WEBHOOK_SECRET" render.yaml backend/.env.example
grep -n "dev-mock-secret" backend/src/modules/fee/lib/providers.ts
grep -n "req.query.provider" backend/src/modules/fee/gateway.ts

# C3: lock ordering — sum() must come AFTER "FOR UPDATE"
psql "$DATABASE_URL" -tAc "select prosrc from pg_proc where proname='fee_recalc_invoice';" \
  | grep -nE "sum\(|FOR UPDATE"

# RLS (expect: all false, 0 policies)
psql "$DATABASE_URL" -c "select tablename, rowsecurity,
  (select count(*) from pg_policies p where p.tablename=t.tablename)
  from pg_tables t where schemaname='public' and tablename like 'fee_%';"

# Unchecked error returns (expect: 40)
grep -rn "const { data[^}]*} = await supabase" backend/src/modules/fee \
  backend/src/shared/utils/fee*.ts | grep -v error | wc -l

# H1: receipt reads a field the backend never sends
grep -n "r\.invoice" frontend/components/fees/printReceipt.ts

# Integrity invariants (both currently pass)
psql "$DATABASE_URL" -tAc "select round(sum(debit)-sum(credit),2) from fee_ledger_entries;"
psql "$DATABASE_URL" -tAc "select count(*) from fee_invoices i
  left join (select invoice_id, sum(amount) s from fee_payment_allocations group by 1) a
  on a.invoice_id=i.id where round(coalesce(a.s,0),2) <> round(i.amount_paid,2);"
```

Both integrity checks pass **today** — on seeded data with no concurrency. C3 and C6 are precisely the defects that make them start failing under real load.

---

*Companion: `fee-module-ux-improvements.md`*
