# AIRTEC Marketing Site — Plan

A public website that introduces AIRTEC to schools: what it does, module by
module, what sets it apart, and a way for a school to ask a question or book a
demo. It uses the same visual language as the staff app, so the site and the
product look like one product.

> **Status: plan only, nothing built.** Written 2026-10-11 against the code on
> `main` (`d66bccd4`). Every capability in §6 and §7 was traced to a route, a
> page, a scheduled job or a module doc, and the source is named so the claim
> can be re-checked before it goes live. §8 lists what the site must **not**
> claim yet.
>
> **Why this file is in `docs/marketing-site/`, not the repo root:** the root
> `plan.md` is the fee-category plan. Also, on Windows `plan.md` and `PLAN.md`
> are the same file (see the note at the top of
> `backend/src/modules/admission/plan.md`), so a new plan must never be written
> next to an existing one.

---

## 1. Goal and audience

**Goal:** a school leader who has never heard of AIRTEC lands on the site,
understands within one scroll what it replaces, can dig into any module they
care about, and leaves a query or demo request that reaches us.

**Who reads it:**

| Visitor | What they want to find | Where we answer it |
|---|---|---|
| Owner / Director / Trustee | Does this run my whole school? What does it cost? Is my data safe? | Home, `/why-airtec`, `/security`, `/pricing` |
| Principal | Will it give me visibility and fix the daily chaos (cover periods, results, attendance)? | Home, module pages |
| Admin / Accountant / Office staff | Fees, receipts, admissions, certificates: does it fit how we work? | Module pages |
| IT person / Tech-savvy trustee | Hosting, integrations, mobile apps, export | `/security`, `/platform` |

**Positioning in one line (draft):** *"One system for the entire school, from
admissions to alumni. Built for how Indian schools actually work, with every
rule configurable instead of hardcoded."*

**Success criteria (measurable after launch):**
- Lighthouse ≥ 95 for Performance, Accessibility, Best Practices and SEO on the home page (mobile).
- A demo request reaches us within one minute of submission.
- Every claim on the site maps to an entry in §6 or §7 with a named source.
- A staff user who sees the site and then logs in does not feel they have switched products (§3.7 checklist).

---

## 2. Architecture decision — a separate app, not a route group

**Recommendation: a new Next.js 14 app, `frontend-site/`, deployed as a fourth
Compose service `site` on the apex domain (e.g. `airtec.in`).**

Why not put it inside `frontend/` at `/`:

1. **The staff app's root layout is built for logged-in users.** It registers a
   service worker (`ServiceWorkerRegister`), ships a PWA manifest, and wraps
   everything in `Providers` (React Query, auth). A visitor to a sales page
   should not be offered "Install AIRTEC" or download auth code.
2. **The repo already made this call once.** `frontend-portal/` is "a separate
   app with its own login and domain, not a route group inside the staff app"
   (CLAUDE.md). The marketing site has yet another audience, anonymous
   prospects, so the same reasoning applies.
3. **Independent deploys.** Fixing a typo in a headline should not rebuild or
   restart the app teachers are using mid-period.
4. **Rendering model.** The site should be fully static (SSG) for speed and SEO.
   The staff app is client-heavy. Putting both in one app forces one set of
   compromises onto two different jobs.

**Rejected alternatives:**
- *Route group `(marketing)` in `frontend/`.* Cheaper to start, but it brings in
  the PWA, service-worker and auth issues above and couples deploys.
- *External site builder (Webflow/Framer).* Fastest to launch, but it loses the
  shared theme tokens and puts the lead form outside our backend. Acceptable as
  a stopgap only if the launch date is very close.

**What it talks to:** only the lead-capture endpoint in §9. It proxies `/api/*`
to `backend` over the internal Docker network, exactly like the other two apps,
so there is still no public backend domain and no CORS.

**Staff app root (`frontend/app/page.tsx`)** keeps redirecting to `/dashboard`.
The site links to the staff app (`app.<domain>`) and the family portal from a
"Log in" menu in its header.

---

## 3. Visual language — making the site look like the product

The site should feel like the product. A school that books a demo after reading
it should recognise the same colours, shapes, type and motion when we open the
staff app in front of them. This section is the spec for that. Anything not
covered here is decided by the rule *"what would the staff app do?"*

### 3.1 Colour tokens — copied verbatim

Source: `frontend/app/globals.css`. Copy both blocks, **including the comments**.
The comments record contrast measurements that someone will otherwise "fix" back
to failing values.

| Token | Light | Dark | Role on the site |
|---|---|---|---|
| `--primary` | `243 75% 59%` (indigo, `#4f46e5` family) | `243 75% 69%` | CTAs, links, active nav, key numbers |
| `--background` | `248 60% 98.5%` (barely-violet white) | `224 71% 4%` (near-black navy, `#030711`) | Page background |
| `--card` | white | `222 47% 8%` | Feature tiles, pricing cards, form panel |
| `--accent` | `243 60% 95%` | `222 47% 13%` | Hero gradient end, hover fills, section tints |
| `--muted-foreground` | `240 4% 42%` | `215 16% 57%` | Sub-heads, captions |
| `--border` | `240 6% 88%` | `216 34% 17%` | Card edges, dividers |
| `--input` | `240 6% 60%` | `216 34% 42%` | Form field edges (kept at 3:1 for WCAG 1.4.11) |
| `--success` / `--warning` / `--destructive` | `152 62% 30%` / `38 92% 30%` / `0 84% 45%` | `152 62% 37%` / `38 92% 37%` / `0 84% 59%` | Status pills in product mock-ups |

Browser `theme-color` matches the app: `#4f46e5` (light) and `#030711` (dark),
from `frontend/app/layout.tsx`.

**Colour discipline:** indigo is the only brand colour. The green/amber/red trio
appears **only inside product mock-ups** (status pills, dues, attendance), never
as decoration. That is how the app uses them, and it keeps them meaning
something.

### 3.2 Type

- **Inter** (300–800) as `--font-sans`, **JetBrains Mono** (400/500) as
  `--font-mono`, loaded with `next/font/google` exactly as `frontend/app/layout.tsx` does.
- Keep the app's body settings: `font-feature-settings: "rlig" 1, "calt" 1,
  "cv11", "ss01"` and `letter-spacing: -0.01em`. `cv11`/`ss01` give Inter its
  single-storey `a` and the alternate digits, which are a large part of why the
  app looks the way it does. Skip them and the site will look "close but off".
- **New for marketing only**, because the app never needed sizes this large:

| Use | Size | Weight | Tracking |
|---|---|---|---|
| Hero headline | `text-4xl` mobile → `text-6xl` desktop | 800 | `-0.03em` |
| Section heading | `text-3xl` → `text-4xl` | 700 | `-0.02em` |
| Eyebrow above headings ("ADMISSIONS") | `text-xs` | 600 | `0.08em`, uppercase, `text-primary` |
| Lead paragraph | `text-lg` → `text-xl` | 400 | default, `text-muted-foreground` |
| Body | `text-base` | 400 | default |
| Numbers in stats / mock-ups | `font-mono` or Inter `tabular-nums` | 600 | default |

- The hero headline may use the app's existing `.text-gradient-primary`
  (indigo `243` → violet `262`) on **one phrase only**, e.g. "*every rule
  configurable*". It is in the app already, so it is on-brand. Using it once
  keeps it an accent rather than a style.

### 3.3 Shape, depth and surfaces

All of these already exist in the app. Copy them, don't approximate them.

- **Radius:** `--radius: 0.75rem`. Cards are `rounded-xl`, buttons and inputs
  `rounded-md` (radius − 2px), badges `rounded-full`. This rounded-but-not-bubbly
  shape is the app's most recognisable trait.
- **Cards:** white or `--card` background, 1px `--border`, little or no shadow.
  The app uses borders for structure rather than drop shadows, and the site
  should do the same.
- **Glow, used sparingly:** `.shadow-glow-indigo` on the primary CTA only, as on
  the app's primary actions.
- **Glass:** the app's `.glass` utility (`bg-white/80 backdrop-blur-md`, white/5
  in dark) for the sticky header once the page scrolls.
- **Status pills:** the app's signature pattern is `bg-X/10 text-X` (used about
  275 times). Every product mock-up on the site uses the same pills with the
  same labels the app shows: *Paid*, *Partial*, *Overdue*, *Reserved*,
  *Waitlisted*, *Present*, *Absent*.
- **Rupee:** use the app's `.rupee` utility for every amount so the ₹ glyph
  renders identically.

### 3.4 Layout and backgrounds

- Content max-width `max-w-6xl`, 16px side gutter on mobile, no horizontal
  scroll at 360px.
- Section rhythm `py-20 md:py-28`. Alternate `--background` and a faint
  `--accent`-tinted band so long pages have visible chapters.
- **Hero background:** radial gradient from `--accent` (top-right) to
  `--background`, plus a 24px dot or line grid at ~4% opacity in `--border`.
  This is new, but it is built only from existing tokens.
- **No stock photography of children.** Visuals are product UI (screenshots and
  live mock-ups, see §3.6), icons and simple diagrams.

### 3.5 Motion

- Copy the motion vocabulary verbatim: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`,
  `--ease-in-out`, `--ease-drawer`, `--duration-press: 120ms`,
  `--duration-fast: 180ms`, `--duration-base: 240ms`. This is already "shared
  verbatim with the family portal". The site becomes the third app to use it.
- Copy the `prefers-reduced-motion` block verbatim. Its rule, "gentler, not
  none", keeps fades and drops travel and scale.
- Marketing-specific motion is limited to fade-and-rise on scroll (12px,
  `--duration-base`, `--ease-out`, once per element) and the "day at school"
  timeline filling in (§5). No parallax and no autoplaying carousels.

### 3.6 Components — reuse the product's own

- Copy `frontend/components/ui/` primitives the site needs: `button`, `card`,
  `badge`, `input`, `textarea`, `select`, `label`, `checkbox`, `tabs`,
  `tooltip`, `separator`, `alert`, `progress`, `table`, `avatar`.
- **Icons:** `lucide-react`, the same library and version the app pins
  (0.400.0). Per project memory, verify every new icon with a real `next build`.
  An invalid name passes esbuild, renders `undefined` and crashes the page
  (commit `bbe1fb3c`).
- **Live mock-ups instead of only screenshots.** For the 6 standout tiles, build
  small static mock-ups from the same primitives, for example:
  - a seat-ledger bar (Confirmed / Reserved / Frozen / Available) with real-looking numbers
  - a fee-hold countdown pill: "Seat held · 3 days left"
  - a cover-arrangement card: "P-III · VII-A · Maths, suggested: Ms. Rao (free, same subject)"
  - a results rule chip row: "Best of 5 · Grace up to 5 · Practical 30%"

  These look like the app because they are made of the app's components. They
  are crisp at any size, theme-switch with the page, and don't go stale every
  time a screen changes. Screenshots (§12) are still used for full-screen views.
- Sidebar look: the app's active-nav style (`--sidebar-accent` fill +
  `--sidebar-accent-foreground` text) is reused for the active item in the
  site's module sub-navigation, so module pages echo the app's navigation.

### 3.7 Similarity checklist (review before launch)

Open the site and the staff app side by side, in both themes:
- [ ] Same indigo on primary buttons. Same button height, radius and focus ring.
- [ ] Same card radius, border colour and (absent) shadow.
- [ ] Inter renders with `cv11`/`ss01`: single-storey `a` in both.
- [ ] Status pills identical in shape, tint and label.
- [ ] Dark mode backgrounds are the same navy, not a generic `#111`.
- [ ] Hover and press timing feels the same (motion vars, not Tailwind defaults).
- [ ] Reduced-motion setting is respected the same way.

### 3.8 Keeping three copies in sync

For now, copy the files and put a header comment in the site's `globals.css` and
`tailwind.config.js` naming the source file and commit. If tokens drift between
the three apps, extract a shared `packages/theme` workspace later. That is not
in scope here.

---

## 4. Sitemap

```
/                         Home: the pitch
/modules                  All modules, grid
/modules/[slug]           One page per module (§6), statically generated
/why-airtec               Cross-cutting standout features (§7)
/platform                 Mobile apps, notifications, integrations, hosting
/security                 Data, access control, hosting, backups (true claims only)
/pricing                  Plans or "Talk to us" (see open question Q1)
/contact                  Query / demo request form (§9)
/about                    Team, story
/privacy, /terms          Required, because the form collects personal data
/sitemap.xml, /robots.txt Generated
```

Header: Logo · Modules (mega-menu, grouped as in §6) · Why AIRTEC · Pricing ·
Contact · **Log in ▾** (Staff / Parents & Students) · **Book a demo** (primary button).

Footer: module links, company links, legal, theme toggle, contact email/phone.

---

## 5. Home page — section by section

The order follows problem → proof → depth → trust → action.

1. **Hero.** Headline (positioning line from §1), one-sentence sub-head and two
   CTAs: *Book a demo* (primary) and *Explore modules* (secondary). On the right,
   a framed screenshot of the staff dashboard in browser chrome, overlapped by a
   phone frame showing the family portal. Light and dark screenshots swap with
   the theme.
2. **"Replaces" strip.** A short line naming what schools juggle today
   (registers, Excel timetables, fee receipt books, WhatsApp groups, separate
   biometric software) and replacing it with "one system".
3. **Module grid.** 12 cards (one per §6 module), each with an icon, name and one
   line, linking to `/modules/[slug]`. Grouped visually:
   - *Front office:* Admissions, Students, Fees, Certificates
   - *Academics:* Timetable, Exams & Results, Attendance, Homework & Syllabus, Library
   - *Operations:* Transport, HR & Payroll
   - *Everyone:* Family Portal & Notifications
4. **Standout features: six deep tiles** (detail in §7), each with a live mock-up (§3.6).
5. **"A day at school" timeline.** Every entry is a real scheduled job in
   `backend/src/index.ts`. This section is strong because it is concrete and true:

   | Time (IST) | What AIRTEC does without being asked |
   |---|---|
   | 00:05 | Starts any exam scheduled for today |
   | 06:45 (Mon–Sat) | Syncs approved staff leave into today's absences and proposes absences from biometric attendance |
   | 07:00 | Sends fee reminders to families with dues (RTE seats excluded) |
   | 07:00–15:00, every 15 min | Watches for teachers who haven't checked in before their period starts |
   | 06:00–16:00, every 5 min | Reminds substitutes who haven't acknowledged a cover, then escalates |
   | 07:30 Monday | Flags teachers over their workload limit |
   | 08:00 | HR alerts: probation ending, documents expiring, work anniversaries |
   | 08:00 and 11:00 | Alerts the manager to periods still without cover |
   | 08:15 | Flags staff with long unexplained absence (absconding check) |
   | 08:30 | Transport compliance: vehicle and driver documents near expiry |
   | 08:45 | Library: due-soon reminders, overdue marking, fine updates |
   | Every hour | Releases unpaid admission seat holds, re-offers expired waitlist offers, expires abandoned online payments |
   | Every minute | Delivers queued notifications to phones and browsers |
   | 1st of month | Credits leave accrual |
   | 1 January | Runs leave year-end carry-forward |

6. **Role tabs.** "For the Principal / Admin / Accountant / Teacher / Parent".
   Each tab switches a screenshot and three bullets, showing the same system from
   each seat.
7. **Trust band.** Role-based access with per-school custom roles, approval
   workflows, publicly verifiable certificates and accessibility-tuned colours.
   Links to `/security`.
8. **Testimonials / pilot school.** Only once there is a real, consenting quote.
   Until then, omit the section rather than invent one.
9. **FAQ** (accordion, also emitted as FAQ structured data): pricing model,
   migration from Excel or an old ERP, onboarding time, mobile apps, data
   ownership, biometric devices, boards supported.
10. **Final CTA band** with a short inline form (name, school, phone, *Book a
    demo*) linking to the full form at `/contact`.

---

## 6. Module catalogue — features in detail

Each `/modules/[slug]` page uses one template:
**Hero line → 3 headline outcomes → "How it works" (grouped capabilities) →
"What makes it different" (standouts, each with the problem it solves) →
screenshots / mock-ups → related modules → CTA.**

Content lives in one typed file, `frontend-site/content/modules.ts`, so the grid,
mega-menu, module pages and the optional assistant (§10) all read the same
source. Each entry has a non-rendered `source` field pointing at the code that
proves it.

In each module below, **Features** is what goes in "How it works" and
**Standouts** is what goes in "What makes it different". Standouts are written as
*problem → what AIRTEC does → why it matters*, which is how the page should
present them.

---

### 6.1 Admissions — `admissions`

**Line:** *From first enquiry to admitted student, with seats that can't be oversold.*

**Headline outcomes:** no overbooked classes · no seat blocked forever by a
family who never paid · parents track their own application.

**Features**
- **Enquiry pipeline.** Every enquiry has a source (walk-in, website, QR,
  referral…), an assigned counsellor, follow-up history and a stage (new →
  contacted → visited → applied → admitted / waitlisted / rejected). An enquiry
  converts to an application in one click.
- **Public apply page and QR code.** Each school gets an online form at
  `/apply/<school>` and a printable QR poster. Parents apply without an account,
  upload documents, check status and **book their own entrance-test or interview
  slot**. Protected by rate limiting and a spam trap.
- **Documents.** Upload, verify and list per application, with a per-class
  mandatory checklist (birth certificate, TC, photographs…).
- **Approval workflow.** Multi-step approval (e.g. counsellor → admin →
  principal). On final approval the student record is created and placed in a
  section automatically.
- **Admission cycles.** Open and close admission per academic year, plus
  per-class locking.
- **Slots.** Entrance exam, interview and campus-tour slots with capacity,
  bookings and recorded results. Each class has an entrance mode: interview,
  written MCQ, written subjective or observation.
- **Admission fee and offer letters.** Fee collection is recorded on the
  application. Offer letters are numbered and printable, and are issued only to
  admitted applicants.
- **Funnel analytics.** Enquiries by source, conversion at each stage and
  pipeline charts.

**Standouts**
1. **Seat ledger.** *Problem:* most systems count seats on the fly, so two
   offices can both admit "the last seat". *AIRTEC:* every class has a stored
   ledger showing Capacity, Confirmed, Reserved, Frozen and Available. Creating
   an application reserves a seat, admission confirms it, and rejection releases
   it. Principals can freeze buffer seats, and admins can lock a class outright.
   *Why it matters:* the number on screen is the truth, and a class cannot be
   oversold.
2. **Fee-hold clock.** *Problem:* reserved seats stay blocked for weeks by
   families who never pay. *AIRTEC:* each reservation gets a deadline (default 7
   days, configurable, with an optional grace period). An hourly job releases
   expired holds automatically and records why. Principals can extend a hold,
   and every extension is logged.
3. **Waitlist auto-promotion.** *Problem:* when a seat frees up, someone has to
   remember who was next. *AIRTEC:* waitlisted applicants are ranked. The moment
   any seat is released, for any reason, the next-ranked family is offered it
   with a response deadline (default 3 days). If the deadline passes, the offer
   moves to the next rank. Nobody is admitted automatically; staff confirm.
4. **Document gate with principal override.** The final approval is blocked
   until the class's mandatory documents are verified. Only the principal can
   override, and must give a written reason. This is enforced on the server, not
   just hidden in the screen.
5. **Policy Assistant (AI).** Staff ask in plain English, e.g. *"what if we cut
   the fee hold to 5 days?"*, and get an answer worked out by running simulations
   on the school's own data rather than a generic guess. It can only see the
   asking user's school. *(Code is in `admission/policyCopilot.ts`, not yet
   committed. Publish this claim only after it lands on `main`; see §8.)*

**Source:** `backend/src/modules/admission/plan.md`, `remaining-work-plan.md`,
`modules/public/routes.ts`, `shared/utils/admissionSeatLedger.ts`.

---

### 6.2 Students (SIS) — `students`

**Line:** *Every student record, one place, from admission to TC.*

**Features**
- Student profiles with guardians, class/section, house, photo and documents.
- Add a single student or many: bulk add, **bulk edit** in a grid.
- **Year-end promotion in bulk**, class by class, with a promotion history.
- Classes and sections, class-teacher assignment, academic calendar.
- Transfer certificates, student ID cards (single or bulk) and printable profiles.
- Complaints with a comment thread and status, plus a Resource Centre for shared files.

**Standouts**
1. **Admission flows straight in.** A student admitted through Admissions is
   created and sectioned by the approval itself. Nobody re-types the record.
2. **Clearance before a TC or promotion.** Outstanding fees and unreturned
   library books are checked before a TC is approved. Bulk promotion **skips**
   affected students rather than blocking the whole class.

**Source:** `modules/sis/routes.ts`, `documents/routes.ts`, `library/lib/gates.ts`.

---

### 6.3 Fees — `fees`

**Line:** *Collect faster, chase less, and never file a payment in the wrong year.*

**Features**
- **Setup:** fee heads, fee structures per class, assignment to students,
  ad-hoc charges.
- **Collection:** counter collection (cash, cheque, UPI, card, bank transfer),
  instalments, numbered receipts and a day book (including by category).
- **Online payment:** parents pay from the family portal through **Razorpay**.
  The payment is confirmed by a signed webhook from the gateway, not by the
  browser, and abandoned payments are cleaned up hourly.
- **Concessions:** discounts, sibling order, staff-ward and scholarship rules
  that actually reduce the bill. Discount and fee requests go through approvals.
- **RTE:** RTE students are recorded as such, kept off defaulter lists and
  reminders, and **reimbursement claims are generated** at the state rate.
- **Recovery:** dues, an **aging report** (0–30 / 31–60 / 61–90 / 90+ days),
  defaulters, late fees, arrears carried forward to the next year, and arrears
  collection or waiver.
- **Reminders:** an automatic 07:00 reminder to families who owe, delivered as
  push notifications.

**Standouts**
1. **Balances the database guarantees.** *Problem:* in many systems, two
   cashiers recording payments on the same invoice at the same moment can leave
   it wrongly "partial" or "paid". *AIRTEC:* the amount paid and the
   paid/partial/unpaid status are maintained by the database itself, inside the
   payment's own transaction. **Overpayment is refused outright**, whichever
   screen or import it comes from. *Why it matters:* the accounts team can trust
   every balance they see. (`docs/fee-module-vs-edut.md` §1–2)
2. **Right financial year, every time.** The system runs on Indian time
   end-to-end. An evening collection on 31 March lands in the closing year, not
   the next one, which happens in systems running on server (UTC) time.
3. **RTE handled properly.** RTE children aren't chased for fees they don't owe,
   and the school's reimbursement claim is generated, not built in a
   spreadsheet.
4. **Library fines flow into fees.** Fines from the library are billed through
   the same fee ledger as any other charge (§6.8), so a family sees one balance.

**Source:** `modules/fee/*`, `fee/lib/providers.ts`, root `plan.md`, `docs/fee-module-*.md`.

---

### 6.4 Examinations & Results — `exams`

**Line:** *Your school's result rules, not a vendor's guess at them.*

**Features**
- **Planning:** yearly exam structure, exam templates, time slots, datesheets
  and exam announcements. Exams **start automatically** on their date.
- **Marks entry** per class and subject, with theory and practical components.
- **Documents:** admit cards (single or bulk) and report cards, including
  term-only report cards.
- **Result settings, configurable at every level:**
  - grade scales and remarks rules (automatic remarks by band)
  - class rules and per-subject overrides
  - pass criteria, best-of-N subjects, compartment, grace marks
  - attendance eligibility
  - no-detention up to a chosen class
  - subject groups and additional-subject substitution
  - composite terms (e.g. Term 1 + Term 2 weighted) and term templates applied across many classes
- **Board presets:** apply a CBSE, ICSE or generic preset once, then edit
  anything.
- **Publish workflow:** results go through approval before families see them.

**Standouts**
1. **A rules engine, not a hardcoded formula.** *Problem:* every Indian school's
   result rules differ, between boards and also between classes and subjects in
   the same school. Most ERPs ship one grading function and leave you to work
   around it. *AIRTEC:* each rule is resolved in order: school, then class, then
   exam type, then subject, then (where needed) student. The engine never
   branches on board name. Presets are a starting point, not a cage.
2. **Edge cases are first-class.** Grace marks, compartment, best-of-N,
   no-detention and attendance eligibility are settings, not support tickets.

**Source:** `backend/src/modules/exam/plan.md`, `exam/*.routes.ts`.

---

### 6.5 Timetable — `timetable`

**Line:** *Generate the timetable once. Handle today's absences every morning.*

**Features**
- **Setup:** day templates (e.g. Junior with 9 periods, Senior with 10), subjects,
  rooms, and teacher capabilities (subjects, priority, class range) and limits
  (max per day/week, max consecutive, blocked slots, exempt from cover). There is
  also a per-class subject plan with live checks that weekly periods add up.
- **Excel import** of the school's existing timetable. It copes with messy
  real-world sheets, previews before committing and **pre-fills the setup** from
  the sheet. **Excel export** in the same format, so the file round-trips.
- **Views:** class, teacher, block, a master grid of all sections, a
  **free-teacher matrix** (who's free in each period) and "My Week" for teachers.
- **Automatic generation:** a feasibility check first, then a generated **draft**
  that honours locked cells, double periods and teacher limits, and optimises
  soft preferences (spread across the week, avoid heavy last periods…). Drafts
  are edited, validated, **published** and can be **rolled back**.
- **Conflict detection:** teacher double-booked, room clash, weekly quota
  missed, over a daily limit, a double period spanning a break and similar. It
  runs live while moving a cell, and suggests a swap that fixes the conflict.
- **Daily cover (arrangements):** absences come in from approved leave, from
  biometric non-check-in, or are entered by hand. Each uncovered period gets
  **ranked substitute suggestions**. The substitute acknowledges or declines
  and is reminded, then escalated, if they don't respond. There is also an
  arrangement register and a monthly fairness view.
- **Workload:** per-teacher load, consecutive runs, free periods, a breach list
  and a validated **"reassign this period"** to a colleague with spare capacity.
- **Teacher self-service:** book a free period for a purpose, report leaving
  early, see cover duties.

**Standouts**
1. **Operates the timetable you already have, from day one.** *Problem:*
   timetable software usually wants you to rebuild everything before it's
   useful. *AIRTEC:* import your current Excel sheet and run the school on it
   tomorrow. Generation is there for next session or a mid-year repair.
2. **The 7 AM substitute scramble, automated.** The absence list builds itself
   from leave and biometric attendance at 06:45. Suggestions only include
   teachers who are actually free, not absent, not already covering, not
   blocked and under their daily limit. Unacknowledged covers are chased
   automatically. Unfilled periods are flagged at 08:00 and 11:00.
3. **Fair cover.** Monthly arrangement counts per teacher are tracked, so cover
   duty doesn't always fall on the same three people.

**Careful wording:** export is Excel today. Do not claim PDF or image export (§8).

**Source:** `timetable-progress.md` (phases 0–5 done),
`modules/timetable/{engine,import,services}`, `timetable/routes.ts`.

---

### 6.6 Attendance — `attendance`

**Line:** *Mark in seconds, spot the pattern before it's a problem.*

**Features**
- Class-wise student attendance marking, attendance reports and today's school-wide summary.
- Principal view of **low-attendance students**.
- Attendance feeds **exam eligibility** rules (§6.4) and the **early-warning** view (§6.7).
- Parents see their child's attendance in the family portal.
- Staff attendance and biometric sync are in HR (§6.10).

**Standout:** attendance is connected to the rest of the system. The same
numbers drive exam eligibility, early warning and the principal's dashboard, with
no exporting and re-importing.

**Source:** `modules/sis/routes.ts`, `modules/principal/routes.ts`.

---

### 6.7 Homework & Syllabus — `homework-syllabus`

**Line:** *Assigned, submitted, graded, and tied to where the syllabus actually is.*

**Features**
- **Homework:** teachers assign work with attachments to a class or section.
  Students or parents **submit online** from the portal. Teachers grade with
  marks and written feedback, and can edit an assignment after posting.
- **Policies as settings:** whether late submission and resubmission are
  allowed, decided per school.
- **Completion dashboard:** live view of who has submitted, with bulk reminders
  to those who haven't.
- **Syllabus:** set up per class/section/subject (import from Excel, type it in
  or upload), set chapter due dates, and log teaching progress. Chapters can be
  linked to an exam or exam template.
- **Early warning:** missed homework is one of the signals that flags a
  struggling student.

**Standout:** **homework, syllabus and exams in one thread.** A principal can
see whether the chapter that's in next week's exam has actually been taught, and
whether the homework on it was done.

**Source:** `backend/src/modules/academics/plan.md`.

---

### 6.8 Library — `library`

**Line:** *A full library system, connected to fees, TCs and exams.*

**Features**
- **Catalogue:** titles and individual copies, with cost recorded per copy.
- **Circulation:** issue, return, renew, reservations, borrowing policies (by
  default, by member category or by role: max books, loan days, renewals, fine
  rate), and the class's scheduled library period surfaced on the day.
- **Fines:** overdue fines accrue daily (one running fine per loan, never
  stacked duplicates). Lost or damaged books are charged as a percentage of the
  book's cost. There are waiver workflows for each type.
- **Textbook distribution** for RTE and state schemes, recorded as a give rather
  than a loan, with a CSV audit trail.
- **Acquisition:** book requests go through a librarian → principal approval;
  receiving an approved order creates the catalogue copy.
- **Periodicals:** subscriptions and expected issues.
- **Stock verification:** snapshot every copy, scan them back in, and anything
  unscanned is recorded missing.
- **Reports:** defaulters, most-borrowed titles, collection value, RTE distribution.

**Standouts**
1. **Scan-and-go circulation.** *Problem:* a whole class hits the desk in one
   period, and switching between "issue" and "return" modes slows it down and
   causes errors. *AIRTEC:* one scan; the system works out from the copy's state
   whether it's an issue or a return. A returned book with a waiting reservation
   is held for that reader automatically.
2. **Every student can borrow.** Students without their own portal login (most
   of them in Indian schools) are still full library members.
3. **Fines land in the fee ledger.** Fines are billed through the same pipeline
   as every other fee, with an **automatic RTE waiver**, so families see one balance.
4. **Books are a clearance item.** An unreturned book blocks a TC and a staff
   exit settlement, just like unpaid fees, and is skipped in promotions.
5. **Mass recall before exams.** One action shortens due dates and notifies
   borrowers, with the next exam date suggested.

**Source:** commits `c67a9d5a`, `ac429977` and earlier Library phases; `modules/library/*`.

---

### 6.9 Transport — `transport`

**Line:** *Know which child is on which bus.*

**Features**
- **Fleet:** vehicles and drivers (bulk import from Excel), their documents,
  vehicle service records, and driver absences with **substitute driver
  assignment**.
- **Compliance alerts:** a daily alert for vehicle and driver documents nearing
  expiry (fitness, insurance, permit, licence…).
- **Network:** stops (bulk import), routes with ordered stops, and student
  assignment to a route and stop.
- **Transport fee slabs** (e.g. by distance), importable.
- **Trips:** daily trips with a **boarding roster** (mark who boarded), location
  updates during the trip, and incident reporting with resolution.
- **Parents:** see their own child's route, today's trip and its latest location
  in the portal. Parents see only their own child, never the fleet or other
  families.
- **Configurable approval workflows** for transport requests.

**Standout:** **safety records and compliance in one place.** Who boarded, when,
what went wrong and how it was resolved, plus alerts before a document lapses.
This is the record a school needs when a parent or inspector asks.

**Careful wording:** say "trip location updates" and "boarding roster", not
"live GPS tracking" (§8).

**Source:** `modules/transport/*.routes.ts`.

---

### 6.10 HR & Payroll — `hr-payroll`

**Line:** *Every staff member, from job post to payslip to relieving letter.*

**Features**
- **Directory:** staff profiles (one-pass Add Staff page), org chart, documents
  with **expiry alerts**, position history and promotions, probation
  (confirm or extend, with alerts before it ends).
- **Recruitment:** job postings, a **public careers page and QR code** where
  candidates apply with a CV, a hiring pipeline, and offer-sent and joined
  stages.
- **Attendance:** staff attendance with **biometric sync** (SchoolKnot, with
  device-to-staff mapping), shifts, a duty log with approval, and **absconding
  detection** (flags long unexplained absence).
- **Leave:** configurable leave types, requests with approval workflow, balances,
  **monthly accrual** and **year-end carry-forward**, run automatically, plus
  comp-off.
- **Payroll:** generate payslips → approve → **bank export file**, payroll
  settings, salary arrears with approval, payslip correction requests with a
  decision step.
- **Self-service ("My Space"):** every staff member sees their own attendance,
  leave, payslips and documents.
- **Exits:** exit checklist, settlement (blocked by unreturned library books or
  other dues), approval and relieving letter.

**Standouts**
1. **Biometric to timetable in one chain.** A teacher who hasn't checked in on
   the biometric device becomes a proposed absence, and their periods become
   cover requests (§6.5). There is no separate attendance software and no phone
   calls to work out who's missing.
2. **The full lifecycle.** QR application → hiring pipeline → probation →
   payroll → exit and relieving letter, all in one system with one record per person.
3. **Payroll with checks.** Payslips are approved before export, and corrections
   and arrears go through a decision step, so there are no silent edits to pay.

**Source:** `modules/hrms/routes.ts`, `hrms/schoolknot.ts`, commits `d66bccd4`, `73a69944`.

---

### 6.11 Certificates & Documents — `certificates`

**Line:** *Every certificate printable, numbered, and verifiable.*

**Features**
- Transfer certificates, ID cards (bulk), admit cards (bulk), report cards,
  admission offer letters, staff offer letters, payslips, relieving letters and
  student profiles.
- **Custom certificate templates** (bonafide, character, sports…) and an
  issued-certificates register.
- **Public verification page:** anyone can check a TC or certificate number.

**Standout:** **verifiable by the receiving school.** A school receiving a TC can
confirm it's genuine online, which helps with forged certificates.

**Source:** `modules/documents/routes.ts`.

---

### 6.12 Family Portal & Notifications — `family-portal`

**Line:** *Parents see what you see, on their phone.*

**Features**
- **Separate parent and student portal,** on its own login and address:
  - attendance
  - fees, with online payment
  - homework (submit and see feedback)
  - exams and results
  - timetable
  - transport status
- **Push notifications** to browsers (Web Push) and to the mobile app (Android
  and iOS via OneSignal), from one delivery queue.
- **Mute controls:** each person can mute notification types. Everything is on
  by default, so new notification types reach people without setup.
- No duplicates: the same event never notifies the same person twice on the
  same day.
- In-app notification bell with unread counts for staff.

**Standout:** **one queue, every device.** A single notification reaches a
parent's phone app and their browser. Deep links open the right page inside the
app, signed in, rather than in an external browser.

**Source:** `frontend-portal/app/(portal)`, `modules/notifications/routes.ts`,
`design.md`, CLAUDE.md "Push has two transports".

---

### 6.13 Principal & Leadership — folded into home "Role tabs"

No separate page unless content grows. Principal dashboard with staff
attendance, low-attendance students and syllabus progress across classes, plus
override authority where the rules give it (document gaps, fee-hold extensions,
seat freezes).

### 6.14 Access Control — folded into `/security`

- **Roles and permissions** (RBAC v2): built-in roles plus **school-defined
  custom roles** (e.g. Timetable Manager, Transport Manager, Librarian), with
  per-permission control.
- **Server-side scoping:** a teacher sees only their own classes and a parent
  sees only their own child, enforced on the server rather than just hidden in
  the screen.
- **One approval engine** shared by admissions, TCs, leave, comp-off, HR exits,
  fines and library acquisitions.

---

## 7. Cross-cutting standouts — `/why-airtec`

Modules are table stakes; every ERP lists "Fees" and "Exams". These are the
reasons to choose AIRTEC, and they lead the home page (§5.4) and `/why-airtec`.
Each gets a heading, the problem it solves, how AIRTEC handles it, proof (what
we can show in a demo) and a visual.

### 7.1 Every rule is a setting, not code
- **Problem:** schools bend their process to fit the software, or pay for custom changes.
- **How:**
  - result rules (§6.4) and fee concessions (§6.3)
  - admission hold days, waitlist response time and document checklists (§6.1)
  - homework late and resubmission policy (§6.7)
  - library borrowing policies (§6.8)
  - teacher workload limits (§6.5)
  - transport workflows (§6.9)

  All are school settings, each with a safe default, so nothing breaks before
  anyone configures it.
- **Proof in demo:** apply the CBSE preset, then change one subject's pass mark
  and show the report card change.
- **Visual:** a settings panel mock-up with toggles and the resulting rule chips.

### 7.2 It runs while you're not looking
- **Problem:** reminders, alerts and sweeps rely on someone remembering.
- **How:** 17 scheduled jobs (the full list is in §5.5) cover fees, admissions,
  timetable cover, HR, transport, library, exams and notification delivery. Each
  has a manual "run now" fallback for administrators.
- **Visual:** the "day at school" timeline.

### 7.3 Built for Indian schools
- **Problem:** global products treat India as a currency setting.
- **How:**
  - Indian time end-to-end and the April–March financial year
  - RTE: fee exclusion, reimbursement claims, textbook distribution, fine waivers
  - CBSE and ICSE presets; INR with Razorpay and UPI
  - students without their own login supported everywhere
  - **Excel import** for timetables, syllabus, vehicles, drivers, stops and fee
    slabs, because that's where a school's data is today
- **Visual:** a strip of these as icon chips.

### 7.4 One connected system
- **Problem:** separate tools for library, transport and fees mean dues and
  records that don't talk to each other.
- **How:**
  - library fines are billed into fees
  - unreturned books and unpaid fees block a TC
  - biometric check-ins create cover requests
  - attendance drives exam eligibility
  - homework feeds early warning
  - admission approval creates the student record
  - seat release triggers waitlist offers
- **Visual:** a small connection diagram, modules as nodes and these flows as
  labelled arrows.

### 7.5 Parents included, on their phones
- **Problem:** parent apps are often a separate product with a separate bill.
- **How:** the family portal (§6.12) and push notifications to the mobile app and
  browser come with the system.

### 7.6 AI where it earns its place
- **Problem:** "AI-powered" usually means a chatbot that guesses.
- **How:** the admission Policy Assistant answers by running simulations on the
  school's real data. It is scoped so it can only ever see the asking user's
  school, and it is optional (it runs only when switched on).
- **Gate:** only claim this after `policyCopilot.ts` is committed (§8).

### 7.7 Trustworthy numbers
- **Problem:** fee balances that drift and seat counts that lie.
- **How:**
  - fee balances maintained by the database, with overpayment refused (§6.3)
  - a stored seat ledger (§6.1)
  - approvals with a recorded actor and reason for overrides, extensions and waivers
  - publicly verifiable certificates

### 7.8 Accessible by design
- **How:** status colours measured to WCAG AA contrast in light and dark, form
  fields with visible edges, and reduced-motion respected throughout. Rare among
  school software, and the site itself demonstrates it.

**Comparisons:** internal benchmarks exist (Fedena, Teachmint, Entab, Meritto,
OpenApply; see admission `remaining-work-plan.md` and `docs/fee-module-vs-edut.md`).
**Do not name competitors on the site.** Use a "Typical school ERP vs AIRTEC"
table with generic rows instead, e.g. *"Result rules: one fixed formula vs.
configurable per class and subject, with board presets"*.

---

## 8. Claims guardrail — do not say these yet

| Don't claim | Because | Say instead |
|---|---|---|
| WhatsApp / SMS / email notifications | Blocked on provider choice (admission Phase 8) | "Push notifications to phones and browsers" |
| Automatic entrance-test evaluation | Blocked (admission Phase 6b-ii) | "Entrance slots and modes per class" |
| Live GPS bus tracking | Location is updated per trip; there is no continuous tracking client | "Trip location updates and boarding roster" |
| Timetable PDF / image export | Export is Excel only (`exportGrid.ts`) | "Excel export that re-imports cleanly" |
| ISO 27001 / SOC 2 / "bank-grade security" | No certification exists | Concrete facts: role-based access, per-school data scoping, approval records |
| DPDP Act compliant | Not assessed | Leave out until legal review (Q5) |
| "Used by N schools" / testimonials | Need real numbers and consent | Omit |
| Any uncommitted feature (Policy Assistant today) | Not on `main` | Add when merged |

Before launch, re-walk §6 and §7 against `main` and tick each line.

---

## 9. Taking queries — demo request / contact form

### 9.1 Form
`/contact` (full) and the inline home CTA (short version).

| Field | Required | Notes |
|---|---|---|
| Name | yes | |
| Role | yes | Select: Owner/Trustee, Principal, Administrator, Accountant, Teacher, Other |
| School name | yes | |
| City / State | yes | |
| Phone | yes | Indian mobile validation, `+91` default |
| Email | no | |
| Student strength | no | Select bands: <300, 300–800, 800–1500, 1500+ |
| Board | no | CBSE, ICSE, State, IB/Cambridge, Other |
| Modules of interest | no | Multi-select chips from `content/modules.ts` |
| Message / question | no | Textarea, 2000 chars |
| Consent | yes | "We may contact you about AIRTEC." Links to `/privacy`. |

Module pages pre-select their module (`/contact?module=fees`).
Success state: inline confirmation and "we'll call you within one working day".
Built with `react-hook-form` + `zod` (zod is already a backend dependency, so
the schema shape can be shared).

### 9.2 Backend
New route in `backend/src/modules/public/routes.ts`:

```
POST /api/public/leads
```
- Already covered by the `/api/public` limiter (15 requests / 15 min / IP, `backend/src/index.ts:160`).
- zod validation. Reject on a filled **honeypot** field, the same guard the
  admission and careers forms already use, and on submissions faster than about
  3 s after page render. No CAPTCHA at launch; add Cloudflare Turnstile only if
  spam appears.
- Stores to a new table and returns only `201 { ok: true }`. It never echoes data back.

### 9.3 Table
Migration `supabase/migrations/<timestamp>_marketing_leads.sql`:

```sql
create table marketing_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  school_name text not null,
  city text not null,
  state text,
  phone text not null,
  email text,
  student_strength text,
  board text,
  modules text[] not null default '{}',
  message text,
  source_path text,          -- page the form was submitted from
  utm jsonb,                 -- utm_source/medium/campaign if present
  consent_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new','contacted','demo_booked','won','lost','spam')),
  created_at timestamptz not null default now()
);
alter table marketing_leads enable row level security;   -- no policies: service role only
```
No `school_id`: these are prospects, not tenants. Nothing in the tenant-scoped
code paths touches this table.

### 9.4 Getting the lead to a human
There is no platform-level admin in the app (`super_admin` maps to "School
Admin" in `20260905050000_users_primary_role_id.sql`), and no email provider.
So, at launch:
1. **Webhook ping.** On insert, POST a short message to `LEADS_WEBHOOK_URL` (a
   Slack, Google Chat or Discord incoming webhook). Fire-and-forget with a
   timeout. A failed ping must not fail the submission, but **log the error**;
   the OneSignal incident in CLAUDE.md shows what a silently discarded error costs.
2. **Read and triage** in the Supabase table editor, updating `status`.

Later (Phase 5): an internal leads page if volume justifies it.

### 9.5 Env vars — two edits each (CLAUDE.md)
| Var | Service | Where |
|---|---|---|
| `LEADS_WEBHOOK_URL` | backend | `docker-compose.yml` `environment:` **and** `backend/.env.example` |
| `NEXT_PUBLIC_STAFF_APP_URL`, `NEXT_PUBLIC_PORTAL_URL`, `NEXT_PUBLIC_SITE_URL` | site | `build.args` (build-time; needs a rebuild) |
| `BACKEND_URL` | site | `build.args`, default `http://backend:4000` |

---

## 10. Optional: "Ask AIRTEC" assistant (Phase 5, only if wanted)

If "take user queries" should also mean answering questions live:
- A small chat widget on the site that answers questions like *"Does AIRTEC
  handle RTE?"*. It is grounded **only** in `content/modules.ts` and the FAQ, and
  has a "talk to a person" button that opens the lead form pre-filled with the
  conversation.
- Backend route `POST /api/public/ask`, using the Anthropic SDK already present
  for the Policy Assistant (`ANTHROPIC_API_KEY` is already in Compose). Use a
  small, fast current model (e.g. `claude-haiku-5-5`). Check the `claude-api`
  skill for current model IDs and caching before building.
- Hard limits: a tighter rate limit than `/api/public`, a maximum message length,
  a maximum number of turns per session and no tools. The system prompt forbids
  pricing promises and anything not in the content file.
- Log questions (no PII). They are free research on what schools ask.

Skip this at launch if it risks delaying the form. The form is the must-have.

---

## 11. SEO, performance, accessibility, analytics

- **SSG everything.** `generateStaticParams` for module pages; `next/image` for screenshots (AVIF/WebP).
- Per-page `metadata` (title template `%s · AIRTEC`, description) and Open Graph images per module, generated with `next/og` in the site's theme.
- Structured data: `Organization`, `SoftwareApplication`, `FAQPage`.
- Target keywords: "school ERP India", "school management software CBSE", "school fee management software", "timetable generator for schools", "school admission management system", "school library software", "school transport management".
- No layout shift from fonts (`next/font`); JS budget under 120 KB on the home page.
- Keyboard-navigable mega-menu, visible focus ring (`--ring`), `prefers-reduced-motion` respected (§3.5) and alt text on every screenshot.
- Analytics: privacy-friendly (Plausible or Umami; either can be self-hosted as another container). Track CTA clicks, form start, form submit and module page views. Add a cookie banner only if the chosen tool sets cookies.

---

## 12. Screenshots and visuals

- Capture from a **seeded demo school only** (`cd backend && npm run seed`),
  never production data, because student names and photos are personal data.
- Both themes, desktop (1440×900) and mobile (390×844), for:
  - dashboard, admission pipeline, seats
  - fee collect, recovery aging, result settings
  - timetable generate and arrangements
  - library circulation, transport trip roster, HR staff
  - family portal home
- Frame in browser or phone chrome. Lightly blur any field that looks like real data.
- Store under `frontend-site/public/shots/{light,dark}/`.
- Standout tiles use live mock-ups (§3.6) rather than screenshots.

---

## 13. Deployment

New Compose service, mirroring `portal`:

```yaml
  site:
    build:
      context: ./frontend-site
      args:
        BACKEND_URL: ${BACKEND_URL:-http://backend:4000}
        NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL:-}
        NEXT_PUBLIC_STAFF_APP_URL: ${NEXT_PUBLIC_STAFF_APP_URL:-}
        NEXT_PUBLIC_PORTAL_URL: ${NEXT_PUBLIC_PORTAL_URL:-}
    restart: unless-stopped
    depends_on: [backend]
    ports:
      - "127.0.0.1:${SITE_HOST_PORT:-3012}:3002"
```
- `frontend-site/package.json` pins `next dev -p 3002` and `next start -p 3002`.
- Dockerfile copied from `frontend-portal/Dockerfile`.
- Dokploy: assign the apex domain (and a `www` redirect) to `site`:3002. Staff
  and portal keep their subdomains.
- Update CLAUDE.md's Layout and Deployment sections ("Three services" becomes four).

---

## 14. Phases

### Phase 0 — Decide (½ day)
Answer the open questions in §15, especially Q1 (pricing) and Q2 (domain).
**Done when:** §15 has answers written into this file.

### Phase 1 — Skeleton and visual language (1–2 days)
Scaffold `frontend-site/`. Copy the tokens, fonts, motion, utilities and UI
primitives (§3). Build the header, footer, theme toggle, empty routes for the
full sitemap, the Compose service and the Dockerfile.
**Done when:** `docker compose up site` serves a themed, empty site at
`localhost:3012` in both light and dark, `next build` passes, and the §3.7
checklist passes against the staff app.

### Phase 2 — Content and pages (4–6 days)
Write `content/modules.ts` with all of §6. Build:
- home page sections 1–7, 9 and 10, with the live mock-ups for the standout tiles
- the module page template and 12 module pages
- `/why-airtec` (§7), `/platform`, `/security`, `/about` and the legal pages

Take screenshots from seeded data.
**Done when:** every page renders from the content file, every claim is ticked
against §6, §7 and §8 on current `main`, and the Lighthouse targets in §1 are met
on the home page.

### Phase 3 — Lead capture (1–2 days)
Build:
- the migration and `POST /api/public/leads`
- the honeypot and timing check
- the webhook ping
- the form on `/contact` and the home CTA, with success and error states
- the env vars in both places

Add a vitest backend test for validation, honeypot rejection, and that a webhook
failure still returns 201.
**Done when:** a real submission from the deployed site lands in
`marketing_leads` and in the team chat within a minute, and a honeypot
submission is stored nowhere.

### Phase 4 — Launch hardening (1 day)
SEO metadata, OG images, sitemap and robots, structured data, analytics, a 404
page in the site theme, the domain and HTTPS in Dokploy, and the `www` redirect.
**Done when:** Google Search Console verifies the domain and accepts the sitemap.

### Phase 5 — Optional extras (after launch)
"Ask AIRTEC" assistant (§10); internal leads page; testimonials and a case study
from the pilot school; per-module demo videos; a Hindi version of key pages.

---

## 15. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Show pricing publicly, or "Contact us for pricing"? Per-student, per-module, or flat? | A `/pricing` page showing plan *shapes* and "Talk to us", with no numbers |
| Q2 | Final domain? Apex for the site, `app.` for staff, `parents.` for the portal? | As stated |
| Q3 | Are the brand name and logo final ("AIRTEC" as-is)? Tagline? | Current name, icons from `frontend/public` |
| Q4 | Where should leads be pinged: Slack, Google Chat, Discord, or WhatsApp-to-self? | A webhook URL for the chat app of your choice |
| Q5 | Who drafts and reviews the privacy policy and terms? What is our DPDP Act position? | Placeholder pages marked draft; **do not launch the form without a real privacy page** |
| Q6 | Is there a pilot school willing to be named or quoted? | Omit social proof |
| Q7 | Is self-hosted / on-premise a selling point, or is the messaging cloud-only? | Cloud-only messaging |
| Q8 | Build the "Ask AIRTEC" assistant at all? | Not at launch |
| Q9 | Hindi or regional-language pages? | English at launch |
