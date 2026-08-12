# Fee Module — Towards a Superior User Experience

**Date:** 9 August 2026
**Scope:** staff app (`frontend/app/(app)/fees/**`) and parent portal (`frontend-portal/app/(portal)/fees/**`)
**Method:** flow-by-flow walkthrough of the running apps, code inspection, and current external research on payment UX and WCAG 2.2. Claims about the current build were verified against the code.

---

## The premise

This module serves **two users with almost nothing in common**, and the quality bar for each is set by a different competitor.

| | The school clerk | The parent |
|---|---|---|
| Device | Desktop or counter tablet | Phone, one-handed, often on mobile data |
| Session | All day, hundreds of times | 4–8 times a year, under mild irritation |
| Judged against | Excel and a receipt book | Amazon and UPI |
| Failure mode | A queue forms | They give up and phone the office |
| Wants | Speed and certainty | To understand the number, then make it go away |

The current build is **competent for both and delightful for neither**. Everything below is written against that gap.

The single most important external finding, and the one that reshapes the roadmap:

> A reminder with a **direct payment link that completes payment in 2–3 taps without requiring a portal login** drives significantly higher same-day completion than a reminder routing to authentication. Cost transparency and registration friction together account for **over 70% of abandonment that is directly fixable through UX**.

Our current reminder does exactly the thing the research says not to: it links to `/fees`, which requires a login.

---

## Four defects to fix before any of the polish below

A full frontend audit ran alongside this one. Four findings are not UX improvements — they are things currently misleading a user, and they outrank everything else in this document.

### D1 — The printed receipt's part-payment warning always says ₹0

`printReceipt.ts:117,122,130` reads `r.invoice.outstanding_after`, `r.invoice.session`, `r.invoice.invoice_number`. **The backend returns none of them** (verified — `receipts.ts` returns `session`, `lines`, `summary` at the top level; there is no `r.invoice`).

So a parent paying ₹2,000 of a ₹10,000 bill receives **paper** whose warning banner reads *"₹0 remains unpaid."* The file's own header calls this "the single most common fee dispute" — and the banner built to prevent it prints the reassuring opposite. Also: the academic session never prints, and "Against Invoice" never prints on a single-invoice receipt, which is the commonest case.

**Fix:** `r.summary.balance_remaining`, `r.session`, `r.lines[0]?.invoice_number`.

### D2 — Every fee screen but one shows "all clear" when the API fails

Exactly one screen distinguishes a failed read from an empty school (`structures/page.tsx`, which handles `isError`). **21 other places render a reassuring wrong answer.** The worst:

- **The parent portal tells a family owing ₹40,000 that they are "all paid up"** — large green type, on their phone.
- The defaulter list shows *"Nobody is behind."* Nobody gets phoned.
- The Day Book shows *"Cash in drawer ₹0."* A cashier tallies against zero.
- **The money-in-flight card removes itself from the page** — the one control that stops a cashier taking cash a parent is mid-way through paying online.

On a fees screen, falling back to a value is dangerous. **Fix:** a shared `<QueryState>` wrapper (pending → skeleton, error → alert, empty → EmptyState) closes all 21 in one change.

### D3 — The parent pay flow breaks the day you connect a real gateway

`PayDialog.confirm()` *always* calls `/simulate`, which returns **400** once a provider is configured. The `checkout` object the backend already returns is never read. Connect Razorpay and every parent payment lands on "The payment did not go through."

Worse right now: a **"Simulate failure" button is rendering to parents** — it sits outside the `order.simulated` guard.

### D4 — Arrears can be waived but never collected

`POST /fees/arrears/:id/payment` exists and the client method is defined, but **nothing in the UI calls it**. The Arrears tab offers only "Waive". The portal tells parents to *"settle that at the office"* — where no such control exists. **The only way to clear a carried-forward balance in this product is to write it off.**

---

## Part 1 — The parent

### 1.1 Kill the login wall between the reminder and the payment ★ highest impact

**Now:** notification → tap → portal → **sign in** → Fees → Pay → amount → confirm. Seven steps, one of them a password most parents have forgotten since last term.

**Should be:** notification → tap → a page showing *"Aarav — ₹5,400 due 15 Oct"* and one **Pay** button. Three taps, no password.

**How.** Issue a signed, single-purpose, short-lived token in the reminder link (`/pay/<token>`). It grants exactly one capability — view this student's outstanding balance and start a payment for it — and nothing else. It cannot read attendance, results, or another child. Expiry ~7 days, one-time-use for the payment action itself.

This is the highest-leverage change in this document. It converts a fee reminder from *a notification about a task* into *the task itself*.

**Verified gap:** `shared/utils/feeReminders.ts:107` sets `link: '/fees'` — a relative path behind auth.

### 1.2 Collapse the payment sheet to one screen

**Now:** `PayDialog` has three stages — amount → confirm → result.

Research is consistent that **one-page checkout reduces abandonment ~20%**; consolidating steps removes progress anxiety and back-button drop-off. For a payment this simple — one amount, one method — three stages is two too many.

**Should be:** a single sheet showing the amount (pre-filled, editable), what it settles, and one primary button. The provider's own sheet is the only other surface.

### 1.3 Give the receipt back to the parent

**Verified gap:** the portal has **no print, download or share** on any receipt — I checked; there is no `Printer`, `download`, or receipt-URL affordance in the portal fees page.

A fee receipt is a document families actually need: for reimbursement, for tax, for a visa file. The staff app can print one; the parent who paid cannot.

**Should be:** a **Download PDF** and a **Share** action on every receipt row, plus automatic delivery of the receipt link at the moment of payment. This is also the cheapest support-call reduction available — "can you email me the receipt" is a phone call that should not exist.

### 1.4 Answer "why do I owe this" before they ask

Already good: the portal now shows the fee heads on each invoice, and a **Coming up** card lists scheduled installments before they are billed. That is ahead of most competitors — keep it.

**Still missing:**
- **Advance credit is invisible on the headline.** If the school holds ₹299 of a family's money, the amount due should say so inline: *"₹5,101 due — ₹299 credit applied."*
- **No payment plan visibility.** A parent seeing ₹23,000 outstanding has no idea it is four instalments. Show the schedule as a timeline, with paid instalments ticked.
- **Concessions are not shown.** If a sibling discount reduced the bill, say so on the invoice. An unexplained reduction generates as many calls as an unexplained increase.

### 1.5 Make failure recoverable

When a payment fails, the current sheet says so and offers "Try again". It should also say **what to do next**: try a different method, or pay at the office — and it should tell the parent explicitly that **nothing was charged.** That sentence prevents the single most common panicked phone call.

---

## Part 2 — The clerk

### 2.1 Cut the counter flow from three screens to one ★ highest impact

**Verified now:** Collect → search a student → lands on `/collect/student/[id]` (the full profile) → click **Collect payment** → `/payment` → type an amount. **Three navigations before the cashier can type a number**, with a queue forming.

`frontend/app/(app)/fees/collect/page.tsx:54` pushes to the profile unconditionally; there is no search-to-pay shortcut.

**Should be:** searching a student opens a **counter sheet** in place — name, class, outstanding, an amount field already focused, method buttons, and **Collect**. The full profile stays one click away for when a parent asks a question, but it is not on the critical path.

Target: **search → type → Enter.** One screen, no page loads.

### 2.2 Make it keyboard-driven

A fee counter is a keyboard job. Right now every action needs the mouse.

- `/` focuses search from anywhere
- Enter on a search result opens the counter sheet with the amount focused
- `Alt+1..6` selects payment method
- `Ctrl+Enter` collects
- `Ctrl+P` prints the receipt just issued

This is a day-one request from anyone who has worked a counter, and it is a few hours of work.

### 2.3 Bulk actions on defaulters

**Verified gap:** the Recovery defaulters list has **no row selection and no bulk action** — no checkbox, no selection state.

Chasing dues is inherently a bulk job. A clerk wants to select thirty families and send one reminder, or export just those thirty for a phone-call list.

**Should be:** row selection with a sticky action bar — *Send reminder · Export selected · Create payment requests*. The last one is now possible because payment requests exist.

### 2.4 Show the day's takings without leaving the counter

The day book lives under Receipts, which is correct, but a cashier wants a persistent glance at *what I have taken today* while they work. A small always-visible strip on Collect — *"Today: ₹1,24,500 · 34 receipts · ₹13,200 cash"* — linking to the full day book would close that loop.

### 2.5 Make the money-in-flight warning impossible to miss

The "Pay from phone" card on a student's profile warns when a family has an unfinished online payment — good, and it prevents double-collection. But a cashier who goes **search → counter sheet** (per §2.1) may never open the profile.

**The warning must appear on the counter sheet itself**, above the amount field, in amber: *"₹1,200 started online 4 minutes ago — check before taking cash."*

---

## Part 3 — Accessibility

Current state is decent — semantic tables, real labels, a native checkbox with proper label association, focus-visible rings. Against **WCAG 2.2 AA**, the gaps are:

| Criterion | Gap | Fix |
|---|---|---|
| **2.4.3 / 2.1.2 Focus** | **The parent payment sheet is a hand-rolled modal** — `role="dialog"` is on the *backdrop*, and there is no focus trap, no focus restore, no Escape handler, no scroll lock. A keyboard or screen-reader parent can tab straight out of the payment sheet. This is the only payment UI a parent has. | Use the Radix `Dialog` the staff app already uses |
| **2.1.1 Keyboard** | **The entire staff Collect drill-down is mouse-only.** Clickable `<TableRow onClick>` with no `role`, no `tabIndex`, no key handler — opening a class, opening a student and expanding a defaulter are all unreachable by keyboard. | Wrap the primary cell in a real link/button |
| **4.1.2 Name, Role, Value** | `StudentSearch` — the entry point to the whole Collect flow — declares `role="combobox"` but has no `aria-controls`, no `aria-activedescendant` and no live region. Arrow-key movement is never announced. | Add the missing ARIA wiring |
| **1.4.1 Use of Colour** | Invoice and payment status rely on colour + text; the *tone* (destructive/success) is colour-only | Ensure the text alone carries the meaning |
| **1.4.11 Non-Text Contrast** | Status pills use `/10` background tints — likely below 3:1 against the card | Measure and adjust the tint tokens |
| **2.4.11 Focus Not Obscured** | Long tables scroll under sticky headers | Add `scroll-margin-top` |
| **1.3.1 Info and Relationships** | Tables lack `<caption>` and `scope` on `<th>` | Add both — cheap, and these are financial tables that will be audited |
| **3.3.1 Error Identification** | Errors surface as toasts, which vanish and are not tied to the field | Inline field errors as well as the toast |

---

## Part 4 — Language

Terminology is the quietest cause of support calls, and there is one genuine collision.

**"Fee category" means two different things in this product:**
1. A **fee head** — Tuition, Transport, Exam (Structures → Fee categories tab)
2. An **assignment category** — General, RTE, Staff ward (the dropdown when assigning a plan)

A clerk who learns one meaning will misread the other. **Rename (1) to "Fee heads" or "Charge types"** and keep "category" for the seat type — or vice versa. Pick one; the current state is a trap.

Other copy fixes:

| Instead of | Say |
|---|---|
| "Structures" | "Fee plans" — nobody outside this codebase calls it a structure |
| "period_key: quarterly:Q2" *(leaks in some views)* | "Quarter 2 (Jul–Sep)" |
| "Unallocated amount" | "Advance credit" |
| "Assignment" | "On a plan" |
| "not_assigned" *(a raw skip reason)* | "Not on a fee plan" |

Also: **Indian number formatting.** Confirm every figure uses the lakh/crore grouping (`₹1,24,500`, not `₹124,500`). A finance screen that groups Western-style reads as foreign software to an Indian accountant.

---

## Part 5 — What would make it genuinely superior

The items above close gaps. These three would put it ahead of anything in the Indian school ERP market.

### 5.1 UPI AutoPay
The clearest market differentiator available. An e-mandate auto-debits each instalment on its due date — up to ₹15,000 without an OTP. The plan **already carries a schedule with due dates**, which is exactly the input a mandate needs. For a school this converts fee collection from a chase into a background process.

### 5.2 A collection cockpit
One screen answering *"where are we this term?"* — expected vs collected vs outstanding, worst classes, the ten biggest debtors, unbilled instalments whose date has passed, and one-click actions on each. The forecast and by-category reports built this month are the data layer; they currently sit in separate tabs. Assemble them.

### 5.3 A conversational payment thread per family
Every reminder, receipt, concession and promise-to-pay against one family, in one timeline, visible to both the school and the parent. It ends "I already paid" disputes permanently, because both sides read the same record.

---

## Prioritised roadmap

**Fix first — these are defects, not improvements**

| # | Change | Why | Effort |
|---|---|---|---|
| 0a | **D1** receipt prints ₹0 remaining | Wrong information, on paper, in a parent's hand | 1 h |
| 0b | **D2** 21 screens show "all clear" on error | A family owing ₹40,000 is told they owe nothing | 1 d |
| 0c | **D3** pay flow breaks on a real gateway; "Simulate failure" is live to parents | Blocks go-live | 0.5 d |
| 0d | **D4** arrears are uncollectable | The only way to clear one is to write it off | 1 d |

**Then — highest impact per unit of work**

| # | Change | Why | Effort |
|---|---|---|---|
| 1 | Tokenised pay link in reminders (§1.1) | Removes the login wall; the single biggest conversion lever | 2–3 d |
| 2 | Counter sheet: search → type → Enter (§2.1) | Cuts the queue; the clerk's daily pain | 3–4 d |
| 3 | Receipt download/share for parents (§1.3) | Kills the commonest support call | 1–2 d |
| 4 | 11 missing `aria-label`s + table semantics (§3) | Legal exposure, hours of work | 0.5 d |
| 5 | Resolve the "fee category" collision (§4) | Prevents a whole class of user error | 0.5 d |

**Then**

| # | Change | Effort |
|---|---|---|
| 6 | One-page payment sheet (§1.2) | 2 d |
| 7 | Keyboard shortcuts at the counter (§2.2) | 1–2 d |
| 8 | Bulk actions on defaulters (§2.3) | 3 d |
| 9 | Money-in-flight warning on the counter sheet (§2.5) | 0.5 d |
| 10 | Advance credit + concessions shown to parents (§1.4) | 2 d |

**Then, as differentiators**

| # | Change | Effort |
|---|---|---|
| 11 | Collection cockpit (§5.2) | 1 wk |
| 12 | UPI AutoPay (§5.1) | 2 wk + provider onboarding |
| 13 | Family payment thread (§5.3) | 2 wk |

---

## A caution

**None of this should ship before the blockers in `fee-module-production-readiness.md` are closed.** A faster, prettier payment flow that occasionally loses a payment to a partial write is worse than a slow one that never does. Fix the transactions, the 40 unchecked errors, and the missing money tests first — then make it fast.

---

## Sources

- [Baymard — reducing cart abandonment](https://baymard.com/learn/reduce-cart-abandonment)
- [Checkout optimisation, 2026 UX guide](https://www.digitalapplied.com/blog/ecommerce-checkout-optimization-2026-ux-guide)
- [Parent portal strategy for K-12](https://cubecreative.design/blog/private-school-marketing/k12-private-parent-portal-strategy)
- [School fee management must-haves, 2026](https://newagesysit.com/blog/school-fee-management-software-features-must-haves-for-a-us-tuition-collection-payment-tracking-and-parent-portal-platform/)
- [WCAG 2.2 specification](https://www.w3.org/TR/WCAG22/)
- [Accessible data tables — WCAG 2.2](https://botmonster.com/web-dev/accessible-data-table-sorting-filtering-keyboard-navigation/)
- [UPI AutoPay in Indian school ERPs](https://axoneura.in/blog/best-school-management-software-india)
- [eduTinker — digital fee management in India, 2026](https://edutinker.com/why-every-indian-school-needs-a-digital-fee-management-system-in-2026/)

---

*Companion document: `fee-module-production-readiness.md`.*
