# Module Feature Sections — Design & Content Plan

How every module page presents its features: the layout, the card designs, a
**visual for every feature**, and the exact copy, one line per feature,
describing what it gives a school in practice.

> Companion to `plan.md` in this folder. That file decides *what* the site says
> (§6 module catalogue, §8 claims guardrail). This file decides *how each
> module's features look and read*. Where the two disagree on a capability,
> `plan.md` §6/§8 wins, because it is the code-verified one.

---

## 1. What's wrong with the current section

Screenshot reviewed: **"What Exams & Results covers"**, a 3×2 grid of equal cards.

| Problem | Example on the page | Effect |
|---|---|---|
| Paragraphs, not points | "Result settings at every level" is one 70-word run-on list separated by semicolons | Nobody reads it, and the best feature is buried |
| Every card looks identical | Six same-size dark boxes, title plus grey text | Nothing tells the eye where to land first |
| Describes the software, not the benefit | "Per class and subject, with theory and practical components" | A principal can't tell what changes for them |
| No visual anchor | No icon, number, chip or mock-up anywhere | Reads like a document, not a product |
| Low contrast body text | Small grey text on near-black | Tiring to read, and weak on mobile |
| Uneven card heights | The long card stretches its whole row; the others sit half empty | Looks unfinished |

## 2. The rules every module section follows

1. **One line per feature.** Each feature is a short **title** (2–5 words) plus
   **one benefit line** of at most about 90 characters, saying what the school
   gets in daily life. No semicolon lists, and no second sentence.
2. **Benefit first, mechanism second.** Write "Report cards with no Excel
   formulas" rather than "Automated computation of results".
   Use the test *"so what does the principal / clerk / parent get?"*
3. **Every feature has a picture.** Each feature card carries a small product
   visual (a "micro-visual", §4.4) that *shows* what the line *says*. A visitor
   who only looks at the pictures should still understand the module.
4. **Four levels of emphasis per module,** never one flat grid:
   - **Hero standout:** one big card with a full mock-up. This is the module's best feature.
   - **Spotlights:** 2 features per module shown as large alternating rows with a bigger mock-up.
   - **Feature cards:** every other feature, each with its micro-visual, icon, title and one-liner.
   - **Detail list:** compact checkmark bullets for the long tail (e.g. every result rule).
5. **The page itself is visual, not just its cards.** Every module page also
   carries **9 page-level visual blocks** (§4.8): a layered product hero, a facts
   band, a "how it works" diagram, a product tour, a before/after comparison, a
   day timeline, a connected-modules diagram, a roles strip and a mobile view.
   Between them, a visitor sees the product's real screens about every second
   scroll.
6. **Group features by when they happen** (e.g. *Before / During / After the
   exam*). Groups give the eye a path through the page.
7. **Only claim what's built.** Copy below comes from `plan.md` §6. Re-check §8
   before publishing; items marked ⚠ are gated.

---

## 3. Section layout (desktop → mobile)

Full page order. `P1`–`P9` are the page-level blocks in §4.8; the others are
the feature blocks from earlier versions of this plan.

```
┌──────────────────────────────────────────────────────────────────────┐
│ P1 LAYERED PRODUCT HERO                                              │
│   Eyebrow · Headline · Lead · [chip][chip][chip] · [Book a demo]     │
│   ┌─────────────── browser frame: module's main screen ───────────┐  │
│   │  real screenshot                         ┌──────────────┐     │  │
│   │                    ┌────────────┐        │ floating card│     │  │
│   │                    │floating card│       └──────────────┘     │  │
│   └────────────────────┴────────────┴───────────────────────────────┘│
├──────────────────────────────────────────────────────────────────────┤
│ P2 FACTS BAND   [ 19 ] checks   [ 06:45 ] absences ready   [ 9 ] …  │
├──────────────────────────────────────────────────────────────────────┤
│ HERO STANDOUT CARD (bento, 2×2) + 2 feature cards                    │
├──────────────────────────────────────────────────────────────────────┤
│ P3 HOW IT WORKS   ①──▶②──▶③──▶④──▶⑤  (icons, "Auto" badges)         │
├──────────────────────────────────────────────────────────────────────┤
│ SPOTLIGHT 1   [ text + 3 bullets ]      [ large mock-up        ]     │
├──────────────────────────────────────────────────────────────────────┤
│ P4 PRODUCT TOUR   [Tab][Tab][Tab][Tab]                               │
│   ┌──────────── large screenshot for the active tab ───────────┐     │
│   └─────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────┤
│ FEATURE GROUPS (cards with micro-visuals)                            │
├──────────────────────────────────────────────────────────────────────┤
│ P5 BEFORE / AFTER   [ Without: paper, Excel ] → [ With AIRTEC ]      │
├──────────────────────────────────────────────────────────────────────┤
│ SPOTLIGHT 2   [ large mock-up        ]  [ text + 3 bullets ]         │
├──────────────────────────────────────────────────────────────────────┤
│ P6 A DAY WITH THIS MODULE   07:00 ● ─ 08:45 ● ─ 11:00 ● ─ 15:00 ●    │
├──────────────────────────────────────────────────────────────────────┤
│ P7 CONNECTED MODULES   [Fees]←─[ MODULE ]─→[Students] …              │
├──────────────────────────────────────────────────────────────────────┤
│ P8 WHO USES IT   [Principal] [Clerk] [Teacher] [Parent] cropped views │
├──────────────────────────────────────────────────────────────────────┤
│ P9 ON THE PHONE (where relevant)   phone mock-ups ×2                 │
├──────────────────────────────────────────────────────────────────────┤
│ DETAIL LIST CARD  ✓ ✓ ✓                                              │
├──────────────────────────────────────────────────────────────────────┤
│ CTA strip: "See it on your own data → Book a demo"                   │
└──────────────────────────────────────────────────────────────────────┘
```

**Pacing rule:** never put two text-heavy blocks next to each other. The order
above alternates *big picture* (P1, P4, spotlights, P7) with *dense content*
(feature groups, P5, detail list), so the page has a rhythm rather than a
wall of cards.

- **Desktop (≥1024px):** a 3-column grid. The hero spans 2 columns and 2 rows
  (bento layout), with two feature cards beside it. Spotlights are full-width
  two-column rows, with text and visual swapping sides each time.
- **Tablet (640–1023px):** 2 columns. Hero and spotlights are full width.
- **Mobile (<640px):** 1 column. Spotlights stack text over visual. Each feature
  group becomes a **horizontal swipe row** (cards 80% of the screen wide, snap
  scrolling, a "1 / 4" counter), so visuals stay readable without a very long page.
- All cards in a row are equal height (`grid` + `h-full`). The micro-visual area
  is a fixed height, so nothing stretches.

---

## 4. Card and visual designs

All built from the staff app's tokens and primitives (`plan.md` §3), in both
light and dark.

### 4.1 Outcome chips (under the headline)
- `rounded-full`, `bg-primary/10 text-primary`, `text-sm font-medium`, with a lucide icon at 14px.
- Three per module, each one a result rather than a feature: "No overbooked classes".

### 4.2 Hero standout card
- Spans 2×2. `rounded-xl`, 1px `--border`, background
  `linear-gradient(135deg, hsl(var(--primary)/0.10), transparent 60%)` over `--card`.
- Content:
  - a "★ Standout" badge (`bg-primary text-primary-foreground`, `rounded-full`, `text-xs`)
  - a title (`text-2xl font-bold`)
  - **two** lines of copy: the problem, then what AIRTEC does
  - a **full mock-up** at the bottom (spec per module in §5)

### 4.3 Spotlight row
- Full-width, two columns (text 5/12, visual 7/12), `py-12`, sides alternating.
- Text side:
  - an eyebrow (the feature's group)
  - a title (`text-2xl font-bold`)
  - the one-liner
  - **3 checkmark bullets** with concrete details
- Visual side: a large mock-up (~320px tall) inside a framed panel
  (`rounded-xl`, `--border`, `bg-accent/40`, faint grid background), built from
  real UI primitives.
- Two spotlights per module. Which two is named in §5.

### 4.4 Feature card with micro-visual
```
┌───────────────────────────────┐
│ ┌───────────────────────────┐ │   micro-visual panel: h-28 (112px), rounded-lg,
│ │   [ small product visual ]│ │   bg-accent/40, 1px border, p-3, overflow-hidden
│ └───────────────────────────┘ │
│ [■ icon]  Title       [chip]  │   icon tile 32px, bg-primary/10 text-primary
│ One line: what you get.       │   text-[15px] leading-6 text-muted-foreground
└───────────────────────────────┘
```
- Padding `p-4`, `rounded-xl`, 1px `--border`, `--card` background.
- The micro-visual is **decorative to screen readers** (`aria-hidden`). The
  title and line carry the meaning, so nothing important lives only in the picture.
- **Optional chip** for a hard fact: `Auto`, `Daily 07:00`, `Bulk`, `RTE`,
  `Excel`, `Parent-facing`, in the `bg-X/10 text-X` pill style, at most one per
  card.
- **Hover** (pointer devices only): border becomes `primary/40`, the card lifts
  2px, and the micro-visual **plays its small animation** (§4.6).

### 4.5 The visual vocabulary — 14 micro-visual types

Every feature visual below is one of these 14 types, filled with that feature's
own demo data. Building 14 components gives about 150 distinct visuals that
all look like one family, and like the product.

| # | Type | What it draws | Built from | Best for |
|---|---|---|---|---|
| V1 | `pills` | A row or stack of 2–4 status pills | `badge` | States: Paid / Partial / Overdue |
| V2 | `bar` | A labelled progress or segmented bar | `progress` + legend | Capacity, completion, balances |
| V3 | `rows` | 2–3 mini list rows: avatar or initials, name, value, pill | `avatar`, `badge` | People, records, rosters |
| V4 | `flow` | 2–3 small step boxes joined by arrows | `card` + lucide `ArrowRight` | Automations, approvals, chains |
| V5 | `stat` | One big number, a caption and a small trend or tag | text + `badge` | Counts, times, money |
| V6 | `settings` | 2–3 setting rows with a switch or value field | `checkbox`/switch, `input` | Configurable rules |
| V7 | `grid` | A mini timetable or calendar grid with highlighted cells | CSS grid | Timetables, datesheets, schedules |
| V8 | `phone` | A small phone outline with one notification or screen | `card` in a rounded frame | Parent-facing features |
| V9 | `doc` | A mini document thumbnail: header, lines, a stamp or number | `card` + skeleton lines | Certificates, receipts, letters |
| V10 | `chart` | A tiny bar chart or sparkline, 5–7 points, one colour | inline SVG | Trends, aging, workload |
| V11 | `scan` | A barcode or QR with a scan line and a result pill | inline SVG + `badge` | Library, QR apply, verification |
| V12 | `compare` | A crossed-out "before" next to an "after" | text + `badge` | Errors prevented, time saved |
| V13 | `clock` | A countdown or time chip with an icon | `badge` + `Clock`/`Timer` | Deadlines, scheduled jobs |
| V14 | `form` | A mini input or upload field with a value and a check | `input` + `Check` | Forms, uploads, search |

**Rules for every micro-visual:**
- Maximum **3 data items** (rows, pills, steps). More is unreadable at 112px.
- Real-looking but **invented** data only: names like *Riya M.*, *Kabir*,
  *Greenfield Public School*. No real schools or people.
- Text inside visuals is at least 12px, and mono or `tabular-nums` for numbers.
- Colours come only from tokens. Green/amber/red mean the same as in the app.
- Indian formats: ₹ with the app's `.rupee` utility, `12 Apr`, Indian names,
  classes like `7-B`.
- Charts (V10) use one hue (`--primary`), no axes, at most 7 bars, and the
  value of the last point labelled.

### 4.6 Micro-visual motion

Each type has one small animation that plays **once** when the card scrolls into
view and again on hover. It lasts at most 600ms, using `--ease-out`:

| Type | Animation |
|---|---|
| `pills`, `rows` | Items fade in one after another (60ms apart) |
| `bar`, `chart` | Fill grows from 0 to its value |
| `flow` | Arrows draw left to right, then the last box lights up |
| `stat` | Number counts up to its value |
| `settings` | A switch toggles on |
| `grid` | The highlighted cell pulses once |
| `phone` | The notification slides down from the top |
| `doc` | The stamp or number stamps in (scale 1.1 → 1) |
| `scan` | The scan line sweeps, then the result pill appears |
| `compare` | The strike line draws across "before" |
| `clock` | The countdown ticks down by one |
| `form` | The value types in, then the check appears |

Under `prefers-reduced-motion`, show the **final state** with no movement.

### 4.7 Other elements
- **Group label:** `text-xs font-semibold uppercase tracking-[0.08em] text-primary`
  plus a thin rule (`flex-1 h-px bg-border`) to the right.
- **Detail list card:** `rounded-xl`, `--accent`-tinted background, 2 columns
  (1 on mobile) of `Check` (16px, `text-success`) plus a short phrase, 6–12 items.
- **Contrast:** card body copy is at least 15px in `--muted-foreground`; titles use `--foreground`.
- **Icons:** `lucide-react` at the app's pinned 0.400.0. The names in §5 are
  suggestions. **Verify each with a real `next build`**: a non-existent name
  (e.g. `IdCard` in 0.400.0) builds but crashes the page at runtime.
- **Tabs and labels in a visual** (e.g. view-switcher tabs) don't count toward
  the 3-item limit in §4.5. Only data items do.

### 4.8 Page-level visual blocks (P1–P9)

These make the *page* visual, not just the cards. Each module fills them with
its own content (the "Page visuals" table at the top of every §5 module). All
screenshots come from the **seeded demo school** (`plan.md` §12), never
production data, in both themes.

#### P1 — Layered product hero
- **What:** the module's main screen as a real screenshot in a browser frame
  (traffic-light dots, a URL bar reading `app.airtec…/fees`), tilted 0° on
  mobile and given a slight perspective (`rotateX(4deg)`) on desktop. **Two
  floating cards** overlap its edges. These are micro-visuals (§4.5) at 1.25×
  size with `shadow-lg`, pointing out the module's two best details.
- **Layout:** headline column on the left (5/12), the framed screen on the right
  (7/12), with floating cards breaking the frame's edge. On mobile, the screen
  goes under the text and the floating cards shrink and stack below it.
- **Motion:** the screen fades up, then the floating cards drift in from
  opposite sides (200ms apart). Reduced motion: static.
- **Background:** the hero gradient and grid from `plan.md` §3.4, plus a soft
  indigo glow (`--primary` at 15%, blur 120px) behind the screen.

#### P2 — Facts band
- **What:** 3–4 large figures in a full-width band, each with a short caption
  (e.g. **19** *automatic timetable checks*).
- **Rule: product facts only, never outcome promises.** "19 checks" and "07:00
  reminders" are verifiable in code. "Saves 10 hours a week" is not, so it is
  not allowed until we have measured data from a real school.
- **Design:** `--accent`-tinted band, figures `text-4xl md:text-5xl font-bold`
  in `text-primary` with `tabular-nums`, captions `text-sm text-muted-foreground`.
  Numbers count up once on first view.

#### P3 — How it works
- **What:** the module's lifecycle as a horizontal diagram of 4–6 steps. Each
  step has a numbered circle, a lucide icon, a 2–3 word label and a one-line
  caption. Steps AIRTEC does automatically carry an `Auto` badge (success
  pill); steps a person does carry a role label (`Clerk`, `Principal`).
- **Design:** connectors are dashed lines in `--border` that turn solid
  `--primary` as the diagram scrolls into view, one step at a time. On mobile
  the diagram turns vertical.
- **Rule:** an `Auto` badge only where a scheduled job or system trigger really
  does it (checked against `plan.md` §5.5 and §6).

#### P4 — Product tour
- **What:** 3–5 tabs, each showing a **large real screenshot** (browser frame,
  full content width) with a one-line caption and 2–3 numbered **hotspots**
  (small indigo dots). Hovering or tapping a hotspot shows a tooltip explaining
  that part of the screen.
- **Behaviour:** click-to-switch only, never auto-advancing. Keyboard: arrow keys
  between tabs (`tabs` primitive). Screenshots crossfade over `--duration-base`.
- **Mobile:** tabs become a horizontal chip scroller; the screenshot is the
  mobile-width capture of the same screen, not a shrunk desktop one.

#### P5 — Before / After
- **What:** two columns. **"Without AIRTEC"** has a muted, slightly desaturated
  panel with simple line illustrations of the old way (a paper register, an Excel
  grid, a phone with missed calls, a receipt book). **"With AIRTEC"** has a
  bright panel with the equivalent micro-visuals. 3 paired rows, each pair joined
  by an arrow.
- **Rule:** describe old *practices*, never competitors. No brand names, no
  "other ERPs".
- **Illustrations:** single-colour line icons (lucide or simple inline SVG in
  `--muted-foreground`), not stock images.

#### P6 — A day with this module
- **What:** a timeline of 4–6 moments from a typical school day for this module.
  Each has a time, an icon, one line and either an `Auto` badge (a real
  scheduled job, from `plan.md` §5.5) or a role (a person doing it with AIRTEC).
- **Design:** horizontal on desktop with a moving "now" marker that runs along
  it once on scroll; vertical on mobile. Times in `font-mono`.
- **Rule:** an `Auto` badge goes only on a real scheduled job (its time must
  match `backend/src/index.ts`) or on something the system does immediately in
  response to an action (e.g. a returned book held for a reservation). Human
  moments are illustrative and are labelled with a role, not an `Auto` badge.

#### P7 — Connected modules
- **What:** the module as a centre node with 3–5 connected module nodes around
  it. Each arrow carries a short label describing what flows
  (`fines → Fees`, `absence → Timetable cover`). Clicking a node goes to that
  module's page.
- **Design:** inline SVG with nodes as `rounded-xl` cards (icon + name) and arrows
  in `--primary` with labels in `text-xs` pills. The centre node gets the
  hero gradient. On mobile it becomes a vertical list of "→ Module · what flows" rows.
- **Rule:** only real connections (from `plan.md` §7.4 and §6).

#### P8 — Who uses it
- **What:** 3–4 role cards (e.g. Principal, Clerk, Teacher, Parent). Each has a
  role icon, a one-line "what they do here", and a **cropped screenshot** of
  exactly the screen that role uses.
- **Design:** cards in a row (swipe row on mobile). The cropped screenshot sits
  in a `rounded-lg` frame and zooms slightly (1.03) on hover.

#### P9 — On the phone
- **What:** 1–2 phone mock-ups showing the module as a parent, student or
  teacher sees it on a phone (family portal or staff app on mobile), with real
  mobile screenshots inside a simple phone outline.
- **Only for modules with a real mobile-facing view.** Others skip P9 rather
  than fake one.

---

## 5. Module content — with a visual for every feature

Format per module:
- **Page visuals:** the P1–P9 content for this module (§4.8). Screens named by
  their staff-app route, so a screenshot can be captured straight from the seeded app.
- **Headline**, **lead line** and **outcome chips**
- **Hero** with its full mock-up
- **Spotlights** (2), each with bullets and its large mock-up
- **Feature table per group:** icon · title · one-liner · *chip* · **visual** (type from §4.5 + its content)
- **Detail list** where useful

---

### 5.1 Exams & Results

**Headline:** Your school's result rules, not a vendor's guess.
**Lead:** Set your own pass, grade and promotion rules once, and every report card follows them.
**Chips:** `Report cards in minutes` · `CBSE / ICSE presets` · `No Excel formulas`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/exams/result-settings` (Class Rules tab). Floating: V4 `flow` "78/100 → Rule A2 ≥ 71 → A2" · V9 `doc` report card `Term 1 · 87%` |
| P2 Facts | **12** configurable rule types · **3** board presets (CBSE, ICSE, generic) · **5** levels a rule can apply at · **00:05** exams start themselves |
| P3 How it works | ① Plan the year (`Admin`) → ② Announce & admit cards (`Admin`) → ③ Exam starts (`Auto`) → ④ Marks entry (`Teacher`) → ⑤ Results compute (`Auto`) → ⑥ Approve & publish (`Principal`) |
| P4 Tour | Tabs: **Datesheet** (`/exams/datesheet`) · **Marks entry** · **Result settings** (`/exams/result-settings`) · **Results** (`/exams/results`). Hotspots on Result settings: the rule chips, the subject-override row, the preset button |
| P5 Before/After | Excel sheet with broken formulas → results that compute themselves · Retyping marks into report cards → report cards from the marks · One fixed grading formula → your own rules per class and subject |
| P6 Day | 00:05 Half-yearly starts (`Auto`) · 11:30 Teachers enter marks (`Teacher`) · 15:00 Results computed with remarks (as marks are saved) · Next day 10:00 Principal approves and publishes (`Principal`) |
| P7 Connected | Attendance → *eligibility* · Syllabus → *chapters per exam* · Family Portal → *results & datesheet* · Certificates → *admit & report cards* |
| P8 Roles | Principal: approves and publishes · Exam coordinator: sets rules and datesheets · Teacher: enters marks · Parent: sees results |
| P9 Phone | Portal exams page: datesheet, then a published result card |

**Hero: Rules you control, at every level**
- Problem: every school's rules differ, even between classes and subjects.
- AIRTEC: set rules per school, class, exam, subject or student, and results compute themselves.
- **Mock-up:** a "Class 10 · Mathematics" rule panel showing rule chips (`Pass 33%`,
  `Theory 80 / Practical 20`, `Grace up to 5`, `Best of 5`), and below it one
  student row: `Aarav S. · 31 + 2 grace → Pass` with a success pill.

**Spotlight 1: Report cards ready to print**
- Bullets: ✓ Term-wise or full-year · ✓ Remarks filled in by score band · ✓ Whole class in one go
- **Mock-up:** a report card for `Ananya R. · 8-A`. A subject table (Maths 92 A1,
  Science 88 A2, English 79 B1), a total row, and an auto remark *"Consistent
  performer, excellent in Mathematics"* highlighted with a small `Auto` pill. A
  "Print class (38)" button sits behind it.

**Spotlight 2: Start from your board**
- Bullets: ✓ CBSE, ICSE or generic preset · ✓ Applied in one click · ✓ Change any rule afterwards
- **Mock-up:** three preset cards (CBSE selected with a primary border), an arrow,
  then a filled rule list (Grade scale A1–E, Pass 33%, Grace 5) with one row
  being edited (`Pass 33% → 35%`).

**Before the exam**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `CalendarDays` · **Exam calendar in one place** | Structure, datesheets and time slots for the whole year, set up once. | Yearly | V7 `grid`: Mon–Sat × 3 exam days with `Maths`, `Sci`, `Eng` cells, one highlighted |
| `Megaphone` · **Announce to every family** | Publish the exam and families see the datesheet in their portal. | Parent-facing | V8 `phone`: notification "Half-yearly exams · Datesheet published" |
| `Ticket` · **Admit cards in one click** | Print the whole class's admit cards together, not one by one. | Bulk | V9 `doc`: three stacked admit cards fanned out, the top one showing `Roll 14 · 10-A` |
| `PlayCircle` · **Exams start themselves** | Exams open for marks on their date, so nobody has to remember. | Auto | V13 `clock`: `00:05 · Half-yearly started` with a success pill |

**During and after the exam**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `PenLine` · **Fast marks entry** | Teachers enter theory and practical marks per class, in one grid. | — | V3 `rows`: `Kabir · 62 / 18`, `Sana · 71 / 19`, `Dev · 55 / 17`, with Theory / Practical headers |
| `Calculator` · **Results compute themselves** | Totals, grades and pass/fail follow your rules, with no formula errors. | Auto | V4 `flow`: `Marks 78/100` → `Rule: A2 ≥ 71` → `Grade A2` (success) |
| `MessageSquareText` · **Remarks written for you** | Automatic remarks by score band, editable before printing. | Auto | V14 `form`: remark field typing *"Shows steady improvement"* with an `Auto` tag |
| `ShieldCheck` · **Nothing goes out unchecked** | Results go through approval before any parent can see them. | — | V4 `flow`: `Class teacher ✓` → `Principal ✓` → `Published` |
| `FileText` · *(spotlight 1)* | — | — | — |

**Setting up**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Copy` · **Set once, apply to many classes** | Term templates copy the same scheme across classes in one step. | Bulk | V1 `pills`: `6-A ✓` `6-B ✓` `7-A ✓` appearing one by one under "Term 1 + Term 2 (40/60)" |
| `Layers` · *(spotlight 2)* | — | — | — |

**Detail list: "Every rule you can set"**
✓ Grade scales · ✓ Pass marks per subject · ✓ Theory / practical split · ✓ Best-of-N subjects ·
✓ Compartment · ✓ Grace marks · ✓ Attendance eligibility · ✓ No-detention up to a class ·
✓ Subject groups · ✓ Additional-subject substitution · ✓ Weighted composite terms · ✓ Remarks by band

---

### 5.2 Admissions

**Headline:** From first enquiry to admitted student, with no seat sold twice.
**Lead:** Track every enquiry, let parents apply online, and let seats manage themselves.
**Chips:** `No overbooked classes` · `Parents apply by QR` · `Seats free themselves`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/admission` pipeline. Floating: V2 `bar` seat ledger "Class 1 · 6 available" · V13 `clock` "Seat held · 3 days left" |
| P2 Facts | **4** seat states (confirmed, reserved, frozen, available) · **7-day** default fee hold · **3-day** waitlist reply window · **0** logins needed for parents to apply |
| P3 How it works | ① Enquiry (`QR / walk-in`) → ② Application, seat reserved (`Auto`) → ③ Documents & test slot (`Parent`) → ④ Approval (`Counsellor → Principal`) → ⑤ Admitted, student created (`Auto`) |
| P4 Tour | Tabs: **Pipeline** (`/admission`) · **Applications** (`/admission/applications`) · **Seats** (`/admission/seats`) · **Test slots** (`/admission/slots`). Hotspots on Seats: the segmented bar, the freeze control, the lock toggle |
| P5 Before/After | Enquiry register on paper → every enquiry tracked with a follow-up date · Seat count on a whiteboard → a seat ledger that can't be oversold · "Call us for your status" → parents check status themselves |
| P6 Day | 09:30 Parent scans the QR poster and applies (`Parent`) · 11:00 Counsellor follows up (`Counsellor`) · Every hour, unpaid holds past deadline released (`Auto`) · Every hour at :15, freed seat offered to the next waitlisted family (`Auto`) |
| P7 Connected | Students → *record created on admission* · Fees → *admission fee* · Certificates → *offer letters* · Notifications → *status updates* |
| P8 Roles | Counsellor: works the pipeline · Admin: verifies documents · Principal: approves and overrides · Parent: applies and books slots |
| P9 Phone | The public apply form on a phone, then the status tracker |

**Hero: A seat ledger that can't be oversold**
- Problem: two offices admit "the last seat" on the same day.
- AIRTEC: every class shows Confirmed, Reserved, Frozen and Available live, and every action updates it.
- **Mock-up:** "Class 1 · 120 seats" with a segmented bar (Confirmed 96 · Reserved
  14 · Frozen 4 · Available 6) and a row `Riya M. · Seat held · 3 days left`
  (warning pill).

**Spotlight 1: Apply by scanning a QR**
- Bullets: ✓ One printable poster per school · ✓ No parent login needed · ✓ Documents uploaded from the phone
- **Mock-up:** an A4 poster "Admissions open 2027–28" with a large QR, and a
  phone beside it showing the apply form half filled (`Child's name: Aditi`,
  `Class: 1`), then a success screen "Application received · Track status".

**Spotlight 2: Waitlist moves up on its own**
- Bullets: ✓ Ranked waitlist · ✓ Offer goes out the moment a seat frees · ✓ Reply deadline, then the next family
- **Mock-up:** a 3-step animated sequence. A seat released in Class 1 (`Available
  5 → 6`), then waitlist row `#1 Arjun K.` lights up with `Offer sent · reply
  by 14 Oct`, then rows `#2`, `#3` stay greyed below.

**Bring families in**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Inbox` · **Every enquiry tracked** | Source, counsellor and follow-ups in one place, so no lead goes cold. | — | V3 `rows`: `Mehta family · Walk-in · Follow-up today`, `Khan family · QR · Visited`, `Rao family · Referral · Applied` |
| `Search` · **Parents check their own status** | Fewer "what's happening with my application?" calls to the office. | Parent-facing | V8 `phone`: status tracker with 3 dots (Applied ✓, Test ✓, Decision ·) |
| `CalendarCheck` · **Parents book their own test slot** | Families pick an entrance test or interview time themselves. | Parent-facing | V7 `grid`: 2 days × 3 slots, one slot selected `Sat 10:00`, one `Full` |
| `BarChart3` · **Know which source works** | See which channels bring enquiries that actually convert. | — | V10 `chart`: 4 bars (Walk-in, QR, Referral, Website) with QR tallest, labelled `42% convert` |
| `QrCode` · *(spotlight 1)* | — | — | — |

**Decide and admit**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `FileCheck` · **No admission with missing papers** | Final approval waits until the class's required documents are verified. | — | V1 `pills`: `Birth certificate ✓` (success), `TC ✓` (success), `Photo · Missing` (destructive), with a disabled `Approve` button |
| `GitBranch` · **Step-by-step approval** | Counsellor, admin and principal each sign off, and every step is recorded. | — | V4 `flow`: `Counsellor ✓` → `Admin ✓` → `Principal …` |
| `UserPlus` · **Student record created for you** | Approval creates the student and places them in a section, with no retyping. | Auto | V4 `flow`: `Approved` → `Student created · 1-B` (success) |
| `FileSignature` · **Numbered offer letters** | Printable offer letters, issued only to admitted students. | — | V9 `doc`: letter thumbnail with `OL/2027/0031` stamped top-right |

**Seats that manage themselves**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Hourglass` · **Unpaid seats free themselves** | A seat held without fee payment is released after 7 days (you set the number). | Auto | V13 `clock`: `Seat hold · 0 days left` → pill `Released` and `Available +1` |
| `Lock` · **Lock a full class** | Close one class while admission stays open for the rest. | — | V1 `pills`: `Class 1 · Open`, `Class 2 · Locked 🔒` (warning), `Class 3 · Open` |
| `Sparkles` · **Ask your policy a question** ⚠ gated | "What if the fee hold were 5 days?" Answered from your own data. | AI | V14 `form`: question typed in, answer card *"About 9 more seats freed per cycle"* |
| `ListOrdered` · *(spotlight 2)* | — | — | — |

⚠ The Policy Assistant card stays hidden until `policyCopilot.ts` is merged (`plan.md` §8).

---

### 5.3 Students (SIS)

**Headline:** Every student record, one place, from admission to TC.
**Lead:** One profile per child that every other module reads from.
**Chips:** `One record per child` · `Bulk edit like Excel` · `Promote a class in one go`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/students` list. Floating: V3 `rows` profile mini "Meera Joshi · 6-A · Tagore" · V1 `pills` "Fees ✓ · Library ✓ · TC ready" |
| P2 Facts | **1** record per child, shared by every module · **2** clearances checked before a TC (fees, library) · **Whole-class** promotion in one action |
| P3 How it works | ① Admitted or added (`Auto` / `Admin`) → ② Profile & documents (`Admin`) → ③ Daily life: attendance, fees, exams (linked) → ④ Year-end promotion (`Admin`) → ⑤ TC after clearance (`Principal`) |
| P4 Tour | Tabs: **All students** (`/students`) · **Add student** (`/students/new`) · **Bulk edit** (`/students/bulk-edit`) · **Promotions** (`/students/promote`). Hotspots on Bulk edit: the selection column, the bulk action menu, a changed cell |
| P5 Before/After | Admission register and loose files → one profile per child · Editing 40 records one by one → bulk edit in a grid · Chasing fee and library dues before a TC → clearance checked automatically |
| P6 Day | 09:00 New admission arrives already filled in (`Auto`) · 11:00 Section change for 12 students (`Admin`) · 14:00 TC requested, clearances checked (`Principal`) · March: whole-school promotion (`Admin`) |
| P7 Connected | Admissions → *new students* · Fees, Library → *TC clearance* · Exams, Attendance → *linked records* · Certificates → *TC, ID cards* |
| P8 Roles | Admin/office: records and bulk edits · Class teacher: their class list · Principal: TCs and promotion |
| P9 Phone | Skip (staff desk work) |

**Hero: Year-end promotion in minutes**
- Problem: promoting every class at year end takes the office days.
- AIRTEC: promote a whole class at once; students with pending dues or books are flagged, not lost.
- **Mock-up:** "Promote 5-A → 6-A · 38 students" with 36 success pills and 2
  warning pills: `Library book due · skipped`.

**Spotlight 1: Edit many students at once**
- Bullets: ✓ Spreadsheet-style grid · ✓ Change section or house for many at once · ✓ Saved together
- **Mock-up:** a grid of 5 students × columns (Name, Section, House, Phone) with
  3 rows selected, a "Set house → Tagore" action and the changed cells
  highlighted.

**Spotlight 2: Complete student profile**
- Bullets: ✓ Guardians, house, photo and documents · ✓ Fees, attendance and results linked · ✓ Printable profile
- **Mock-up:** a profile card (initials avatar, `Meera Joshi · 6-A · Roll 21`,
  house `Tagore`), with tabs Attendance 94% · Fees `Paid` · Library `1 book out`.

**Features**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `UserPlus` · **Add one or add many** | A single admission form or a bulk import for a new session. | Bulk | V14 `form`: upload field `students-2027.xlsx` → `212 rows ready` |
| `ArrowUpCircle` · **Promote whole classes** | Move everyone up, with a history of who moved where. | Bulk | V4 `flow`: `5-A (38)` → `6-A (36)` with `2 held` pill |
| `ScrollText` · **TC without the chase** | Fee and library clearance checked before a TC is issued. | — | V1 `pills`: `Fees cleared ✓`, `Library cleared ✓`, `TC ready` |
| `CreditCard` · **ID cards for the whole school** | Print ID cards class by class. | Bulk | V9 `doc`: two ID cards side by side with photo placeholders and names |
| `MessageCircleWarning` · **Complaints tracked to closure** | Each complaint has an owner, status and comment thread. | — | V3 `rows`: `Bus late · Transport · Open`, `Water cooler · Admin · Resolved` |
| `FolderOpen` · **Resource centre** | Share files with staff and classes from one place. | — | V3 `rows`: three file rows (PDF, DOCX, PPT icons) with class tags |
| `Table` / `UserRound` · *(spotlights)* | — | — | — |

---

### 5.4 Fees

**Headline:** Collect faster, chase less, and trust every balance.
**Lead:** From fee structure to receipt to reminder, with the numbers kept right by the system itself.
**Chips:** `Online & counter payments` · `Reminders at 7 AM` · `RTE handled`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/fees/collect`. Floating: V9 `doc` receipt "R-2026-1183 · ₹4,500" · V10 `chart` aging bars with "90+ ₹38K" |
| P2 Facts | **8** payment methods at the counter · **4** aging buckets · **07:00** daily reminders · **Overpayment** refused by the database |
| P3 How it works | ① Structure per class (`Accountant`) → ② Assigned with concessions (`Auto`) → ③ Collected at counter or online (`Clerk` / `Parent`) → ④ Receipt & day book (`Auto`) → ⑤ Reminders & recovery (`Auto`) |
| P4 Tour | Tabs: **Overview** (`/fees`) · **Collect** (`/fees/collect`) · **Recovery** (`/fees/recovery`) · **Receipts** (`/fees/receipts`). Hotspots on Recovery: the aging buckets, the defaulter list, the late-fee action |
| P5 Before/After | Receipt book and carbon copies → numbered receipts and a day book · Phoning families with dues → automatic morning reminders · RTE claims in a spreadsheet → claims generated at the state rate |
| P6 Day | 07:00 Reminders sent to families with dues (`Auto`) · 09:30 Counter opens; first payment receipted (`Clerk`) · 13:00 A parent pays by UPI from the portal (`Parent`) · 17:00 Day book closed by category (`Accountant`) · Every hour, abandoned online payments cleared (`Auto`) |
| P7 Connected | Library → *fines on the bill* · Transport → *fee slabs* · Students → *TC clearance* · Family Portal → *pay online* · Admissions → *admission fee* |
| P8 Roles | Accountant: structures and reports · Clerk: counter collection · Principal: approves discounts · Parent: pays online |
| P9 Phone | Portal fees page: dues, then Razorpay payment, then receipt |

**Hero: Balances you never have to double-check**
- Problem: two cashiers, one invoice, and the totals no longer add up.
- AIRTEC: the database keeps every balance correct and refuses an overpayment, from any screen.
- **Mock-up:** invoice `Term 2 · ₹18,500` with two payments (`₹10,000 · Counter`,
  `₹8,500 · UPI`), a `Paid` pill, and a greyed attempted row `₹2,000 · Refused:
  exceeds balance` (destructive).

**Spotlight 1: See how old each due is**
- Bullets: ✓ 0–30, 31–60, 61–90, 90+ days · ✓ Click a bucket to see the families · ✓ RTE students never listed
- **Mock-up:** 4 aging bars with amounts (`₹2.4L`, `₹1.1L`, `₹62K`, `₹38K`),
  the 90+ bar in destructive tint, and below it 3 defaulter rows with a
  `Remind all` button.

**Spotlight 2: Parents pay online**
- Bullets: ✓ From the parent portal · ✓ UPI, cards and net banking via Razorpay · ✓ Confirmed by the gateway, not the browser
- **Mock-up:** a phone showing `Dues · ₹6,200` → Pay → a success screen
  `Paid · Receipt R-2026-1184`, and on the right the staff day book showing the
  same payment arriving as a new row.

**Set up**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Layers` · **Fee structures per class** | Define heads and amounts once, then assign them to every student. | — | V3 `rows`: `Tuition ₹12,000`, `Lab ₹1,500`, `Activity ₹2,000` under "Class 7" |
| `BadgePercent` · **Concessions that really apply** | Sibling, staff-ward and scholarship discounts reduce the actual bill. | — | V12 `compare`: ~~₹15,500~~ → `₹13,950` with `Sibling −10%` pill |
| `CheckSquare` · **Discounts need approval** | Every waiver or discount request is approved and recorded. | — | V4 `flow`: `Request −₹2,000` → `Principal ✓` → `Applied` |

**Collect**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `IndianRupee` · **Counter collection** | Cash, cheque, DD, NEFT, card or UPI, with a numbered receipt. | — | V9 `doc`: receipt thumbnail `R-2026-1183 · ₹4,500 · Cash` |
| `BookOpenCheck` · **Day book by category** | Today's collection, split the way your accounts team reports it. | — | V5 `stat`: `₹3,42,600 today` with small pills `Cash 41%`, `UPI 48%`, `Cheque 11%` |
| `CalendarRange` · **Right financial year, always** | A payment on 31 March evening lands in the right year. | — | V13 `clock`: `31 Mar · 8:40 PM` → pill `FY 2025–26 ✓` |
| `Smartphone` · *(spotlight 2)* | — | — | — |

**Recover**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `BellRing` · **Reminders go out by themselves** | Families with dues get a phone notification every morning. | Daily 07:00 | V8 `phone`: notification `Fee due · ₹6,200 by 10 Oct` at `07:00` |
| `Users` · **Defaulter list that's actually right** | RTE students are never wrongly listed as defaulters. | RTE | V3 `rows`: two defaulters with amounts, one row struck out `Ravi · RTE · not owed` |
| `ArrowRightLeft` · **Arrears carry forward** | Last year's dues move into this year, ready to collect or waive. | — | V4 `flow`: `2025–26 · ₹3,200 due` → `2026–27 arrears` |
| `FileSpreadsheet` · **RTE claims generated** | Reimbursement claims at the state rate, without a separate spreadsheet. | RTE | V9 `doc`: claim sheet `24 students × ₹1,850` with total `₹44,400` |
| `TrendingDown` · *(spotlight 1)* | — | — | — |

---

### 5.5 Timetable

**Headline:** Run today's timetable from day one. Cover absences before the first bell.
**Lead:** Import the timetable you already have; AIRTEC handles the daily cover.
**Chips:** `Import your Excel` · `Cover sorted by 7 AM` · `Conflict-free drafts`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/timetable/arrangements` (today's cover queue). Floating: V3 `rows` ranked substitutes "Ms. Rao · Free · Same subject" · V7 `grid` mini timetable with one clash cell outlined |
| P2 Facts | **19** automatic checks on every timetable (**9** hard clashes) · **06:45** absences ready, Mon–Sat · **Excel** in, Excel out · **Every 5 min** unconfirmed cover chased |
| P3 How it works | ① Import your Excel (`Manager`) → ② Set teacher rules (`Manager`) → ③ Generate or edit a draft, checked live (`Auto`) → ④ Publish (`Principal`) → ⑤ Daily absences & cover (`Auto`) |
| P4 Tour | Tabs: **Generate** (`/timetable/generate`) · **Arrangements** (`/timetable/arrangements`) · **Workload** (`/timetable/workload`) · **Master grid** (`/timetable/block`) · **Import** (`/timetable/import`). Hotspots on Arrangements: the absence list, the ranked candidates, the acknowledgement status |
| P5 Before/After | A paper "free teachers" sheet at 7 AM → ranked substitutes ready by 6:45 · Clashes found when two teachers walk into one class → clashes caught while editing · The same three teachers always covering → fair cover tracked monthly |
| P6 Day | 06:45 Leave and missed check-ins become absences (`Auto`) · 07:10 Manager assigns cover (`Manager`) · 07:25 Unconfirmed substitute reminded, then escalated (`Auto`) · 08:00 & 11:00 Uncovered periods flagged (`Auto`) · Monday 07:30 Overloaded teachers flagged (`Auto`) |
| P7 Connected | HR → *leave & biometric check-ins* · Notifications → *cover alerts* · Exams → *datesheet periods* · Teachers' My Week → *their own timetable* |
| P8 Roles | Timetable manager: builds and runs cover · Teacher: sees My Week, confirms cover · Principal: publishes and overrides |
| P9 Phone | Teacher's My Week on a phone with a "Cover: P-III VII-A · Confirm" card |

**Hero: The morning substitute scramble, done**
- Problem: at 7 AM someone works out who's absent and who's free, on paper.
- AIRTEC: absences come in from leave and biometric check-ins, and each empty period gets ranked substitutes.
- **Mock-up:** card `P-III · VII-A · Maths · Mr. Verma absent` with candidates
  `Ms. Rao · Free · Same subject` (top, success), `Mr. Khan · Free · 4 periods
  today`, `Ms. Iyer · At daily limit` (greyed, warning), and `Assign`.

**Spotlight 1: Generate a timetable**
- Bullets: ✓ A draft in seconds · ✓ Respects teacher limits and double periods · ✓ Never overwrites the live timetable
- **Mock-up:** a master grid (6 sections × 8 periods) filling in cell by cell
  with subject colours, a side panel `Feasibility ✓`, `Conflicts 0`, and
  `Publish` and `Discard` buttons.

**Spotlight 2: Import your existing timetable**
- Bullets: ✓ Your current Excel sheet · ✓ Preview before saving · ✓ Setup filled in from the sheet
- **Mock-up:** an Excel sheet thumbnail (green header, messy cells) → an arrow →
  an AIRTEC review screen `16 sections · 27 teachers · 2 conflicts to review`
  with the two conflicts listed in warning pills.

**Set up fast**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Settings2` · **Rules for every teacher** | Max periods a day, blocked slots and subjects, set once. | — | V6 `settings`: `Max per day 6`, `Max in a row 3`, `Blocked: Sat P-VIII` |
| `Download` · **Export back to Excel** | Download in the same format, so the file goes back in cleanly. | Excel | V4 `flow`: `AIRTEC` → `timetable.xlsx` → `AIRTEC` (round-trip arrows) |
| `FileSpreadsheet` · *(spotlight 2)* | — | — | — |

**Build**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `AlertTriangle` · **Clashes caught as you edit** | Double-booked teachers or rooms are flagged, with a swap suggested. | — | V7 `grid`: one cell in destructive outline `Mr. Das · 2 classes`, a tooltip `Swap with Thu P-5 ✓` |
| `History` · **Publish, or roll back** | Drafts never overwrite the live timetable, and old versions can be restored. | — | V3 `rows`: `v4 · Live` (success), `v3 · 2 Sep`, `v2 · 14 Jul` with a `Restore` link |
| `Wand2` · *(spotlight 1)* | — | — | — |

**Every day**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `UserX` · **Absences found for you** | Approved leave and missed check-ins become absences by 6:45 AM. | Auto | V4 `flow`: `Leave approved` + `No check-in` → `2 absences today` |
| `UserCheck` · **Best substitute first** | Only teachers who are truly free and under their limit are suggested. | — | V3 `rows`: `Ms. Rao · Free ✓`, `Mr. Khan · Free ✓`, `Ms. Iyer · At limit` greyed |
| `BellRing` · **Cover chased automatically** | A substitute who doesn't confirm is reminded, then the manager is alerted. | Auto | V4 `flow`: `Assigned 07:10` → `Reminder 07:25` → `Escalated 07:40` (warning) |
| `Scale` · **Fair cover duty** | See who has covered how often this month, so it isn't always the same people. | — | V10 `chart`: 6 bars of cover counts per teacher, evenly spread, labelled `This month` |
| `Gauge` · **Spot overloaded teachers** | Weekly workload check, with a one-click reassign to a free colleague. | Weekly | V2 `bar`: `Mr. Sen 34 / 30 periods` over-limit in destructive, a `Reassign` button |

**Views**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `LayoutGrid` · **Every view you need** | Class, teacher, whole-school grid and "who's free now". | — | V1 `pills` as tabs: `Class` `Teacher` `Master` `Free now`, with "Free now" active over 3 names |
| `CalendarDays` · **Teachers see their own week** | My Week shows each teacher's periods and cover duties. | — | V7 `grid`: one teacher's week with a cover period tinted `Cover` |

---

### 5.6 Attendance

**Headline:** Mark in seconds, spot the pattern before it's a problem.
**Lead:** Daily attendance that feeds results, alerts and the principal's view.
**Chips:** `Class-wise marking` · `Low-attendance alerts` · `Parents see it too`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/attendance` marking view. Floating: V5 `stat` "94.2% today" · V3 `rows` "Below 75%: Kabir 71%" |
| P2 Facts | **1 tap** per absentee · **1** attendance rule drives exam eligibility · **Same day** visible to parents |
| P3 How it works | ① Teacher marks (`Teacher`) → ② School total updates (`Auto`) → ③ Low attendance surfaced (`Principal`) → ④ Eligibility applied in results (`Auto`) → ⑤ Parents see it (`Parent`) |
| P4 Tour | Tabs: **Mark** (`/attendance`) · **Report** (`/attendance/report`) · **Principal view** (principal dashboard, low-attendance list). Hotspots: the present-by-default toggles, the save bar, the threshold list |
| P5 Before/After | Paper register totalled by hand → school total live · Low attendance noticed at exam time → flagged during the term · Parents learn at PTM → parents see it daily |
| P6 Day | 08:10 Class teachers mark attendance (`Teacher`) · 08:40 Principal sees classes not yet marked (`Principal`) · 09:00 Parents see today's status (`Parent`) · Month end: report printed (`Admin`) |
| P7 Connected | Exams → *eligibility* · Homework → *early warning* · Family Portal → *parents see it* · Principal dashboard → *low attendance* |
| P8 Roles | Class teacher: marks · Principal: watches patterns · Parent: sees their child |
| P9 Phone | Portal attendance calendar for one child |

**Hero: Low attendance spotted early**
- Problem: a child's falling attendance is noticed at exam time, too late.
- AIRTEC: the principal sees students below threshold, and the same data decides exam eligibility.
- **Mock-up:** "Below 75% this term" with `Kabir · 71%`, `Sana · 68%`,
  `Dev · 62%`, each with a pill and a sparkline.

**Spotlight 1: Mark a class in seconds**
- Bullets: ✓ Everyone present by default · ✓ Tap only the absentees · ✓ Saved in one click
- **Mock-up:** a class list of 6 students as tap targets, all `P` (success)
  except two being tapped to `A` (destructive), and a footer `36 present · 2 absent · Save`.

**Spotlight 2: Today's whole-school picture**
- Bullets: ✓ Every class on one screen · ✓ Classes not yet marked stand out · ✓ Drill into any class
- **Mock-up:** a grid of class tiles (`6-A 97%`, `6-B 92%`, `7-A Not marked`
  in warning), with a school total `94.2%` at the top.

**Features**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `FileBarChart` · **Reports by student or class** | Monthly and term reports, ready to print. | — | V10 `chart`: 6 monthly bars for one class, last labelled `95%` |
| `GraduationCap` · **Linked to exam eligibility** | Your attendance rule applies to results automatically. | Auto | V4 `flow`: `Attendance 68%` → `Rule: min 75%` → `Not eligible` (warning) |
| `Smartphone` · **Parents see it daily** | Attendance shows in the family portal without a phone call. | Parent-facing | V8 `phone`: calendar month with one red dot, `Present 21 / 22` |
| `CheckCircle2` / `PieChart` · *(spotlights)* | — | — | — |

---

### 5.7 Homework & Syllabus

**Headline:** Assigned, submitted, graded, and tied to the syllabus.
**Lead:** Homework and teaching progress in one place, visible to teachers, parents and the principal.
**Chips:** `Online submission` · `Who hasn't submitted, live` · `Syllabus on track`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/homework/assigned` (grading and completion). Floating: V2 `bar` "31 / 38 submitted" · V1 `pills` "Ch 5 taught ✓ · Ch 7 not yet" |
| P2 Facts | **Live** completion per assignment · **2** policy switches (late, resubmit) · **Excel** syllabus import · Chapters **linked** to exams |
| P3 How it works | ① Syllabus & due dates (`Coordinator`) → ② Teach & log progress (`Teacher`) → ③ Assign homework (`Teacher`) → ④ Submit from home (`Student / Parent`) → ⑤ Grade with feedback (`Teacher`) |
| P4 Tour | Tabs: **Assign** (`/homework`) · **Grading** (`/homework/assigned`) · **Syllabus progress** (`/syllabus`) · **Log progress** (`/syllabus/log`). Hotspots on Grading: the completion bar, the remind button, a feedback field |
| P5 Before/After | Counting notebooks → live "who hasn't submitted" · Syllabus in a diary → progress by chapter for the principal · "Was this taught before the test?" → chapters linked to exams |
| P6 Day | 08:30 Teacher logs yesterday's chapter (`Teacher`) · 13:00 Homework posted with a worksheet (`Teacher`) · 19:00 Students submit from home (`Student`) · Next morning: missing ones reminded in one tap (`Teacher`) |
| P7 Connected | Exams → *chapters per exam* · Attendance & early warning → *struggling students* · Family Portal → *submission & feedback* |
| P8 Roles | Teacher: assigns, grades, logs · Coordinator: sets syllabus · Principal: sees who's behind · Student/Parent: submits |
| P9 Phone | Portal homework: assignment, upload, graded feedback |

**Hero: Know who hasn't submitted, right now**
- Problem: teachers count notebooks to find out who did the homework.
- AIRTEC: a live completion view per assignment, with one-tap reminders to everyone who's missing.
- **Mock-up:** "Science · Chapter 4 worksheet · 7-B" with a bar `31 / 38
  submitted`, pills `Submitted 28`, `Late 3`, `Missing 7`, and `Remind 7`.

**Spotlight 1: Teaching progress logged**
- Bullets: ✓ Teachers log what they covered · ✓ Planned vs actual by chapter · ✓ The principal sees who's behind
- **Mock-up:** chapter rows for `Maths · 8-A`: Ch 1–4 `Done` (success), Ch 5
  `In progress`, Ch 6 `Due 20 Oct · Behind` (warning), with an overall bar `62% of term plan`.

**Spotlight 2: Submit from home**
- Bullets: ✓ Students or parents upload from the phone · ✓ Late submissions marked automatically · ✓ Feedback comes back to the same place
- **Mock-up:** a phone showing the assignment, a photo upload
  `worksheet.jpg ✓`, then the graded state `18 / 20 · "Neat work, check Q4"`.

**Homework**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `ClipboardList` · **Assign with attachments** | Post work with files to a class or section in a minute. | — | V14 `form`: title `Fractions practice`, attachment `sheet.pdf`, class `6-B`, `Post` |
| `PenLine` · **Grade with feedback** | Marks plus a written comment that the family can read. | — | V3 `rows`: `Aditi · 9/10 · "Great"`, `Rohan · 6/10 · "Revise Q3"` |
| `Clock` · **Your late-work policy** | Allow or block late submissions and resubmissions, school-wide. | — | V6 `settings`: `Allow late ✓`, `Allow resubmit ✗` |
| `BellRing` · **Remind the missing ones** | Nudge everyone who hasn't submitted, in one tap. | Bulk | V5 `stat`: `7 reminded` with a `Sent` success pill |
| `Upload` · *(spotlight 2)* | — | — | — |

**Syllabus**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `BookMarked` · **Syllabus set up in minutes** | Import from Excel, type it in or upload, per class and subject. | Excel | V14 `form`: `syllabus-class8.xlsx` → `14 chapters added` |
| `CalendarClock` · **Chapter due dates** | Know when each chapter should be finished. | — | V7 `grid`: a month with 3 chapter due-date markers |
| `Link2` · **Linked to exams** | See whether the chapters in next week's exam have actually been taught. | — | V1 `pills`: `Ch 5 taught ✓`, `Ch 6 taught ✓`, `Ch 7 not yet` (warning) under "Unit Test 2" |
| `Siren` · **Early warning** | Missed homework helps flag students who are starting to struggle. | — | V3 `rows`: `Dev · 4 missed this month` (warning pill) |
| `TrendingUp` · *(spotlight 1)* | — | — | — |

---

### 5.8 Library

**Headline:** A full library system, connected to fees and TCs.
**Lead:** Fast circulation at the desk, and fines and dues that the rest of the school can see.
**Chips:** `One scan issue / return` · `Fines into fees` · `Stock check by scan`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/library/circulation` scan queue. Floating: V11 `scan` "Issued · due 25 Oct" · V12 `compare` "₹45 → ₹0 RTE waiver" |
| P2 Facts | **1 scan** per book, issue or return · **08:45** daily due and overdue sweep · **2** fine types (overdue, lost/damage) · **3** places a loan is checked (TC, promotion, staff exit) |
| P3 How it works | ① Catalogue copies (`Librarian`) → ② Scan to issue or return (`Librarian`) → ③ Due reminders & fines (`Auto`) → ④ Fines billed to fees (`Auto`) → ⑤ Clearance before TC (`Auto`) |
| P4 Tour | Tabs: **Circulation** (`/library/circulation`) · **Fines** (`/library/fines`) · **Stock verification** (`/library/audit`) · **Reports** (`/library/reports`). Hotspots on Circulation: the scan input, a reserved-copy row, the today's-library-period panel |
| P5 Before/After | Issue register and date stamps → one scan · Fines collected in cash and forgotten → fines on the fee bill · Shelf count with a clipboard → stock check by scanning |
| P6 Day | 08:45 Due-soon reminders, overdue marked, fines updated (`Auto`) · 10:20 Class 6-A library period; 38 books scanned (`Librarian`) · 12:00 Returned book held for a reservation (`Auto`) · Before exams: mass recall (`Librarian`) |
| P7 Connected | Fees → *fines on the bill* · Students → *TC & promotion clearance* · HR → *staff exit clearance* · Exams → *recall suggestion* · Timetable → *library periods* |
| P8 Roles | Librarian: desk, catalogue, audits · Principal: approves acquisitions & waivers · Student: borrows · Parent: sees fines on the bill |
| P9 Phone | Skip (desk-scanner workflow) |

**Hero: One scan. The system knows the rest.**
- Problem: a whole class reaches the desk in one period, and mode-switching causes mistakes.
- AIRTEC: scan a book and AIRTEC knows whether it's going out or coming back.
- **Mock-up:** scan queue: `The Jungle Book · Issued to Meera, 6-A` (primary),
  `Wings of Fire · Returned` (success), `Malgudi Days · Returned → held for
  reservation` (warning).

**Spotlight 1: Fines on the fee bill**
- Bullets: ✓ Overdue fines added daily · ✓ Shown on the family's fee balance · ✓ RTE fines waived automatically
- **Mock-up:** a fine card `Overdue 6 days · ₹30` → an arrow → the parent's fee
  statement with a new line `Library fine ₹30`, and a second fine row `RTE ·
  waived` with a success pill.

**Spotlight 2: Stock check by scanning**
- Bullets: ✓ Snapshot every copy · ✓ Scan shelves back in · ✓ Unscanned copies marked missing
- **Mock-up:** a progress ring `4,812 / 5,000 scanned`, and a list of 3 missing
  copies with accession numbers in warning pills.

**At the desk**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `ScanLine` · **Scan-and-go circulation** | One scan issues or returns, with no mode switching. | — | V11 `scan`: barcode with a sweep, result pill `Issued · due 25 Oct` |
| `BookmarkCheck` · **Reservations held for the right reader** | A returned book goes to the next person waiting. | Auto | V4 `flow`: `Returned` → `Held for Aarav` (warning) |
| `Users` · **Every student can borrow** | Students without a portal login are still full members. | — | V3 `rows`: `Meera · no login · Member ✓`, `Kabir · no login · Member ✓` |
| `CalendarDays` · **Library period ready** | Today's scheduled library classes are shown at the desk. | — | V3 `rows`: `P-II · 6-A`, `P-V · 7-C` under "Today" |

**Fines and dues**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Coins` · **Fines calculated daily** | Overdue fines add up automatically, never charged twice. | Auto | V5 `stat`: `₹30` with caption `6 days × ₹5`, counting up |
| `HeartHandshake` · **RTE fine waiver** | RTE students' fines are waived automatically. | RTE | V12 `compare`: ~~₹45~~ → `₹0 · RTE waiver` |
| `ShieldAlert` · **No TC with a book out** | Unreturned books block a TC and staff exit, just like unpaid fees. | — | V1 `pills`: `Fees ✓`, `Library · 1 book out` (destructive), disabled `Issue TC` |
| `Undo2` · **Recall before exams** | Shorten all due dates and notify borrowers in one action. | Bulk | V4 `flow`: `Recall 214 books` → `Due by 28 Oct` → `Borrowers notified` |
| `Receipt` · *(spotlight 1)* | — | — | — |

**Collection**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `ShoppingCart` · **Book requests with approval** | Librarian and principal approve, and receiving adds the copy. | — | V4 `flow`: `Request` → `Librarian ✓ · Principal ✓` → `In catalogue` |
| `Newspaper` · **Periodicals tracked** | Subscriptions and expected issues in one list. | — | V3 `rows`: `Science Reporter · Oct · Received ✓`, `Tinkle · Oct · Expected` |
| `BookCopy` · **Textbook distribution records** | RTE and scheme textbook hand-outs, with an exportable audit trail. | RTE | V9 `doc`: register sheet `Class 3 · 42 sets given` with an `Export CSV` tag |
| `ScanBarcode` · *(spotlight 2)* | — | — | — |

---

### 5.9 Transport

**Headline:** Know which child is on which bus.
**Lead:** Fleet, routes, boarding and compliance in one place, with parents kept informed.
**Chips:** `Boarding roster` · `Document expiry alerts` · `Parents see their bus`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/transport/trips` with a trip's boarding roster open. Floating: V5 `stat` "38 / 40 boarded" · V1 `pills` "Insurance · 12 days" (warning) |
| P2 Facts | **08:30** daily document-expiry check · **Vehicles + drivers** both covered · **1 child**, the only data a parent sees · **Excel** import for fleet, drivers and stops |
| P3 How it works | ① Fleet & drivers (`Transport manager`) → ② Routes & stops (`Manager`) → ③ Students assigned (`Manager`) → ④ Trip boarding marked (`Attendant`) → ⑤ Parents see status (`Parent`) |
| P4 Tour | Tabs: **Fleet** (`/transport/fleet`) · **Routes & stops** (`/transport/routes`) · **Trips & boarding** (`/transport/trips`) · **Settings** (`/transport/settings`). Hotspots on Trips: the roster, the incident button, the last-update time |
| P5 Before/After | A paper list on the bus → a boarding roster per trip · Insurance found expired at a check → alerts before expiry · "Is my child on the bus?" calls → parents see trip status |
| P6 Day | 06:50 Morning trip starts; attendant marks boarding (`Attendant`) · 07:18 Location updated during the trip (`Attendant`) · 08:30 Expiring vehicle and driver documents flagged (`Auto`) · 14:30 Incident logged and resolved (`Manager`) |
| P7 Connected | Fees → *transport fee slabs* · Students → *stop assignment* · Family Portal → *bus status* · Notifications → *compliance alerts* |
| P8 Roles | Transport manager: fleet, routes, compliance · Attendant: boarding · Parent: their child's status |
| P9 Phone | Portal transport status: route, "Boarded 07:12", last update. **No map** (`plan.md` §8) |

**Hero: Every boarding recorded**
- Problem: when a parent calls, nobody can say for sure whether their child got on.
- AIRTEC: the attendant marks boarding on the trip, and parents see their child's trip status.
- **Mock-up:** "Route 4 · Morning trip" roster: `Ishaan · Boarded 07:12`
  (success), `Ananya · Boarded 07:15` (success), `Rohan · Not boarded`
  (warning), and `Last location update · 07:18`.

**Spotlight 1: Routes and stops**
- Bullets: ✓ Build routes stop by stop · ✓ Import stops from Excel · ✓ Every child linked to a stop
- **Mock-up:** a vertical route line with 4 stops (`Sector 9 · 07:05 · 6
  students`, …, `School · 07:45`). It is a schematic, **not a map**, so it
  doesn't suggest live GPS.

**Spotlight 2: Expiry alerts before it's late**
- Bullets: ✓ Fitness, insurance, permit and licence · ✓ Checked every morning · ✓ Vehicles and drivers both covered
- **Mock-up:** a compliance table with 3 rows: `Bus 07 · Insurance · 12 days`
  (warning), `Bus 02 · Fitness · 45 days` (success), `Driver Suresh · Licence ·
  Expired` (destructive).

**Fleet**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Bus` · **Vehicles and drivers on file** | Import your fleet from Excel, with documents and service history. | Excel | V3 `rows`: `Bus 07 · 42 seats · Service due Nov`, `Bus 02 · 32 seats` |
| `UserCog` · **Driver absent? Substitute assigned** | Record a driver absence and assign a cover driver. | — | V4 `flow`: `Suresh absent` → `Ramesh covers Route 4` |
| `FileWarning` · *(spotlight 2)* | — | — | — |

**Routes**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `MapPin` · **Students assigned to stops** | Every child linked to a route and stop. | — | V3 `rows`: `Ishaan · Route 4 · Sector 9`, `Ananya · Route 4 · Park Gate` |
| `IndianRupee` · **Transport fee slabs** | Distance-based fees, set up once. | — | V3 `rows`: `0–5 km ₹1,200`, `5–10 km ₹1,800`, `10+ km ₹2,400` |
| `Route` · *(spotlight 1)* | — | — | — |

**Every trip**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `ClipboardCheck` · **Boarding roster** | Mark who got on, trip by trip. | — | V5 `stat`: `38 / 40 boarded` with `2 absent` pill |
| `Navigation` · **Trip location updates** ⚠ | The latest location of each trip, for staff and parents. | — | V13 `clock`: `Last update · 07:18 · near Park Gate` (text only, no map, no moving dot) |
| `Siren` · **Incidents logged and resolved** | Breakdowns or issues recorded, followed up and closed. | — | V3 `rows`: `Flat tyre · Route 2 · Resolved` (success) |
| `Smartphone` · **Parents see only their child** | Route, today's trip and status, never other families' data. | Parent-facing | V8 `phone`: `Ishaan boarded · 07:12 · Route 4` |

⚠ Never "live GPS" in copy or visuals: no map with a moving bus (`plan.md` §8).

---

### 5.10 HR & Payroll

**Headline:** Every staff member, from job post to payslip.
**Lead:** Hiring, attendance, leave, payroll and exits in one record per person.
**Chips:** `Biometric sync` · `Payslips with approval` · `Staff self-service`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/hr/staff` directory. Floating: V4 `flow` "No check-in → Absence → Cover" · V9 `doc` payslip "Oct 2026 · Net ₹42,300" |
| P2 Facts | **08:00** daily HR alerts (probation, documents, anniversaries) · **1st** of every month, leave credited · **3-step** payroll (generate, approve, export) · **1** record from job application to relieving letter |
| P3 How it works | ① Apply by QR (`Candidate`) → ② Hire & onboard (`HR`) → ③ Attendance & leave (`Auto` sync / `Staff`) → ④ Monthly payroll (`HR → Principal`) → ⑤ Exit & relieving letter (`HR`) |
| P4 Tour | Tabs: **Staff** (`/hr/staff`) · **Attendance & leave** (`/hr/attendance`, `/hr/leave`) · **Payroll** (`/hr/payroll`) · **Recruitment** (`/hr/recruitment`) · **Org chart** (`/hr/org-chart`). Hotspots on Payroll: the run total, the approve step, the bank export |
| P5 Before/After | Biometric report re-typed into a register → synced attendance · Leave balances in a ledger → credited and carried forward automatically · Payslips edited in Excel → approved payroll and a bank file |
| P6 Day | 06:45 Approved leave flows into the timetable (`Auto`) · 08:00 Probation and document-expiry alerts (`Auto`) · 08:15 Long unexplained absences flagged (`Auto`) · 15:00 Leave approved (`Principal`) · 1st of month, 02:00 leave accrual (`Auto`) |
| P7 Connected | Timetable → *absences & cover* · Library → *exit clearance* · Certificates → *offer, payslip & relieving letters* · Notifications → *HR alerts* |
| P8 Roles | HR/admin: records, payroll, hiring · Principal: approvals · Staff: My Space (attendance, leave, payslips) · Candidate: applies by QR |
| P9 Phone | Staff "My Space" on a phone: leave balance and a payslip download; plus the public careers form |

**Hero: A missed check-in becomes a covered period**
- Problem: biometric data sits in one system and the timetable in another.
- AIRTEC: no check-in by the first period means a proposed absence, and the teacher's classes go to the cover queue.
- **Mock-up:** `Biometric · No check-in 07:40` → `Absence proposed · Mr. Verma`
  → `3 periods sent to cover`.

**Spotlight 1: Payroll with approval**
- Bullets: ✓ Generate the month's payslips · ✓ Approve before anything is paid · ✓ Export the bank file
- **Mock-up:** a payroll run card `October 2026 · 64 staff · ₹28.6L`, a 3-step
  stepper (Generated ✓ → Approved ✓ → Bank file), and a file chip `bank-export-oct.csv`.

**Spotlight 2: Hiring pipeline with QR apply**
- Bullets: ✓ Public careers page and QR poster · ✓ CVs uploaded from the phone · ✓ Applied → Offer → Joined
- **Mock-up:** a 3-column kanban (`Applied 12`, `Offer sent 2`, `Joined 1`) with
  candidate cards, one tagged `QR Code` as its source.

**Hire**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `QrCode` · **Candidates apply by QR** | A public careers page; candidates upload a CV from their phone. | Public | V11 `scan`: QR with sweep → `Application received` |
| `UserPlus` · **Add staff in one pass** | Account, employment and bank details on one page. | — | V1 `pills` as tabs: `Account ✓` `Employment ✓` `Bank ✓` |
| `Kanban` · *(spotlight 2)* | — | — | — |

**Every day**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `Fingerprint` · **Biometric attendance sync** | Staff attendance pulled from your device, with no double entry. | — | V4 `flow`: `Device` → `AIRTEC · 61 / 64 in` |
| `Clock` · **Shifts and duty log** | Shifts set once; extra duties logged and approved. | — | V3 `rows`: `Exam invigilation · 2 hrs · Approved`, `Sports day · Pending` |
| `CalendarOff` · **Leave with approvals** | Requests, approvals and balances, with comp-off included. | — | V3 `rows`: `CL 6 left`, `EL 12 left`, `Comp-off 1`, with one request `Pending` |
| `RefreshCw` · **Leave credited automatically** | Monthly accrual and year-end carry-forward run themselves. | Auto | V13 `clock`: `1 Nov · +1.5 EL credited` |
| `AlertOctagon` · **Unexplained absence flagged** | Long absences without leave are flagged to HR. | Daily | V1 `pills`: `Mr. Lal · 5 days · No leave` (destructive) |

**Pay**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `FilePen` · **Corrections and arrears** | Pay changes go through a decision step, never silent edits. | — | V4 `flow`: `Correction +₹1,200` → `Approved` |
| `FileText` · **Self-service payslips** | Staff download their own payslips anytime. | — | V9 `doc`: payslip thumbnail `Oct 2026 · Net ₹42,300` with a download icon |
| `Wallet` · *(spotlight 1)* | — | — | — |

**Career and exit**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `BadgeCheck` · **Probation reminders** | Confirm or extend before probation ends. | Daily | V13 `clock`: `Ms. Gill · probation ends in 10 days` with `Confirm` / `Extend` |
| `FileClock` · **Document expiry alerts** | Staff documents flagged before they expire. | Daily | V1 `pills`: `Police verification · 20 days` (warning) |
| `Network` · **Org chart** | Who reports to whom, generated from staff records. | — | V4 `flow` as a tree: `Principal` → `Coordinators (3)` → `Teachers` |
| `LogOut` · **Clean exits** | Checklist, settlement (blocked by unreturned books) and relieving letter. | — | V1 `pills`: `Assets returned ✓`, `Library ✓`, `Relieving letter ready` |

---

### 5.11 Certificates & Documents

**Headline:** Every certificate printable, numbered and verifiable.
**Lead:** The documents your office prints every day, generated from records already in the system.
**Chips:** `Numbered` · `Verifiable online` · `Bulk print`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Screen: `/certificates`, issuing a certificate. Floating: V11 `scan` "TC/2026/0142 · Valid" · V9 `doc` ID card |
| P2 Facts | **10** document types printed · **Every** TC and certificate numbered · **Public** verification by number |
| P3 How it works | ① Pick template (`Admin`) → ② Filled from records (`Auto`) → ③ Numbered & logged (`Auto`) → ④ Printed, singly or in bulk (`Admin`) → ⑤ Verified by the receiving school (`Anyone`) |
| P4 Tour | Tabs: **Issue certificate** (`/certificates`) · **ID cards (bulk)** · **Admit cards (bulk)** · **Verification result**. Hotspots: the template placeholder, the number stamp, the print-all button |
| P5 Before/After | Typed in Word, numbered by hand → filled from records and numbered · Printing 400 ID cards one at a time → bulk print · "Is this TC genuine?" phone calls → online verification |
| P6 Day | 10:00 Bonafide certificate issued in a minute (`Admin`) · 12:00 ID cards for 6-A printed (`Admin`) · 15:00 Another school verifies a TC number (`Anyone`) |
| P7 Connected | Students → *TC & ID cards* · Exams → *admit & report cards* · Admissions → *offer letters* · HR → *payslips & relieving letters* |
| P8 Roles | Office/admin: issues and prints · Principal: approves TCs · Receiving school: verifies |
| P9 Phone | The verification result on a phone, for a receiving school checking on the spot. If the staff app has no public verify page yet, build this from the existing `GET /documents/verify/…` API before showing it |

**Hero: A TC anyone can verify**
- Problem: receiving schools can't tell a real TC from a forged one.
- AIRTEC: every TC and certificate has a number that anyone can check online.
- **Mock-up:** a verification box with input `TC/2026/0142` and a result card
  `Valid · Issued 12 Apr 2026 · Greenfield Public School` (success).

**Spotlight 1: Custom certificates**
- Bullets: ✓ Bonafide, character, sports and more · ✓ Your own templates · ✓ Every issue recorded
- **Mock-up:** a template editor on the left with placeholders highlighted
  (`{student_name}`, `{class}`), and the filled certificate on the right with
  a number stamp.

**Spotlight 2: Whole-class printing**
- Bullets: ✓ ID cards for the whole school · ✓ Admit cards per exam · ✓ One print job
- **Mock-up:** a print preview grid of 8 ID cards on an A4 sheet, and a
  `Print 6-A (38)` button.

**Features**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `ScrollText` · **Transfer certificates** | Issued after fee and library clearance, with a unique number. | — | V9 `doc`: TC thumbnail with `TC/2026/0142` stamp |
| `ListChecks` · **Issued register** | Every certificate issued is on record. | — | V3 `rows`: `Bonafide · Meera · 3 Oct`, `Character · Kabir · 1 Oct` |
| `Mail` · **Letters for staff** | Offer letters, payslips and relieving letters, printable. | — | V9 `doc`: three small letter thumbnails fanned out |
| `Award` / `CreditCard` / `Ticket` · *(spotlights)* | — | — | — |

**Detail list: "Documents AIRTEC prints"**
✓ Transfer certificate · ✓ Student ID card · ✓ Admit card · ✓ Report card · ✓ Admission offer letter ·
✓ Staff offer letter · ✓ Payslip · ✓ Relieving letter · ✓ Student profile · ✓ Custom certificates

---

### 5.12 Family Portal & Notifications

**Headline:** Parents see what you see, on their phone.
**Lead:** One portal for attendance, fees, homework, results and the bus, with notifications that actually arrive.
**Chips:** `Phone app + browser` · `Pay fees online` · `Parents mute what they want`

**Page visuals**
| Block | Content |
|---|---|
| P1 Hero | Instead of a browser frame: **two phones side by side**, the portal home and a notification arriving. Floating: V8 `phone` "Fee due · ₹6,200" · V5 `stat` "Attendance 96%" |
| P2 Facts | **6** portal sections (attendance, fees, homework, exams, timetable, bus) · **2** delivery channels (app push, browser push) · **Every minute** notifications delivered · **Opt-out**: everything on by default |
| P3 How it works | ① Something happens in school (fee due, homework graded) → ② Notification queued (`Auto`) → ③ Delivered to app and browser (`Auto`) → ④ Tap opens the right page, signed in (`Parent`) → ⑤ Parent acts: pays, submits, reads (`Parent`) |
| P4 Tour | Tabs (all phone-sized screenshots): **Home** · **Fees** · **Homework** · **Exams** · **Timetable**, from `frontend-portal/app/(portal)` pages. Hotspots on Home: the child switcher, a due tile, the notification bell |
| P5 Before/After | Notices lost in group chats → one notification per parent · Fee slips sent home in bags → dues and payment on the phone · "When is the exam?" calls → datesheet in the portal |
| P6 Day | 07:00 Fee reminder arrives (`Auto`) · 09:00 Today's attendance visible (`Parent`) · 13:15 "Homework graded" notification (`Auto`) · 20:00 Parent pays fees and submits homework (`Parent`) |
| P7 Connected | Every module feeds it: Fees, Homework, Exams, Attendance, Timetable, Transport |
| P8 Roles | Parent: everything for their children · Student: homework and timetable · School: sends without a WhatsApp group |
| P9 Phone | Already the hero. Here show notification settings (mute switches) on a phone |

**Hero: One message, every device**
- Problem: notices get lost in WhatsApp groups.
- AIRTEC: each notification reaches the parent's phone app and browser, and opens the right page inside the app.
- **Mock-up:** a phone frame with 3 stacked notifications: `Fee due · ₹6,200 by
  10 Oct`, `Homework graded · Science 18/20`, `Results published · Term 1`.

**Spotlight 1: The parent's home screen**
- Bullets: ✓ Attendance, fees, homework, results, timetable and bus · ✓ One login per family · ✓ Works on any phone
- **Mock-up:** a phone showing the portal home: child switcher `Meera · 6-A`,
  tiles `Attendance 96%`, `Fees ₹0 due` (success), `Homework 2 pending`,
  `Bus · Boarded 07:12`.

**Spotlight 2: Parents choose what to mute**
- Bullets: ✓ Everything on by default · ✓ Mute any type · ✓ New alerts reach families with no setup
- **Mock-up:** a settings list with switches: `Fees ✓`, `Homework ✓`, `Exams ✓`,
  `Library ✗`, with a short caption "Muted by you".

**For parents and students**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `CalendarCheck` · **Attendance** | See daily attendance without calling the school. | — | V7 `grid`: month calendar with green dots and one red |
| `IndianRupee` · **Fees and online payment** | See dues and pay from the phone. | Razorpay | V8 `phone`: `₹6,200 due` → `Pay` button |
| `ClipboardList` · **Homework** | See assignments, submit work and read the teacher's feedback. | — | V3 `rows`: `Maths · Due tomorrow`, `Science · Graded 18/20` |
| `GraduationCap` · **Exams and results** | Datesheets and published results in one place. | — | V9 `doc`: mini report card `Term 1 · 87%` |
| `CalendarDays` · **Timetable** | The child's weekly timetable, always current. | — | V7 `grid`: today's column highlighted |
| `Bus` · **Bus status** | Their child's route and today's trip. | — | V5 `stat`: `Boarded · 07:12` with `Route 4` pill |

**Notifications**
| Icon · Title | One line | Chip | Visual |
|---|---|---|---|
| `BellRing` · **Push to phone and browser** | Reaches the mobile app and the browser from one send. | — | V4 `flow`: `1 notice` → splits to `📱 App` and `💻 Browser` |
| `CopyX` · **No duplicate alerts** | The same event never notifies the same person twice in a day. | — | V12 `compare`: two identical notifications, the second struck out |
| `BellOff` · *(spotlight 2)* | — | — | — |

⚠ No WhatsApp, SMS or email in copy or visuals: no WhatsApp-green bubbles (`plan.md` §8).

---

## 6. Implementation notes

- **One content file.** Every module's copy *and* visual data lives in
  `content/modules.ts`, so changing a demo number never means touching a component:

```ts
type Tone = 'primary' | 'success' | 'warning' | 'destructive' | 'muted'

type Visual =
  | { type: 'pills'; items: { label: string; tone: Tone }[] }
  | { type: 'bar'; label: string; segments: { label: string; value: number; tone: Tone }[] }
  | { type: 'rows'; rows: { name: string; meta?: string; pill?: { label: string; tone: Tone } }[] }
  | { type: 'flow'; steps: { label: string; tone?: Tone }[] }
  | { type: 'stat'; value: string; caption: string; pill?: { label: string; tone: Tone } }
  | { type: 'settings'; rows: { label: string; value: string | boolean }[] }
  | { type: 'grid'; cols: string[]; rows: string[]; cells: Record<string, { label: string; tone?: Tone }> }
  | { type: 'phone'; title: string; body: string; time?: string }
  | { type: 'doc'; heading: string; number?: string; lines?: number; stack?: number }
  | { type: 'chart'; points: number[]; labels?: string[]; lastLabel: string }
  | { type: 'scan'; kind: 'barcode' | 'qr'; result: { label: string; tone: Tone } }
  | { type: 'compare'; before: string; after: string; note?: string }
  | { type: 'clock'; time: string; label: string; tone?: Tone }
  | { type: 'form'; field: string; value: string; result?: string }

type Feature = {
  icon: string
  title: string
  line: string
  chip?: { label: string; tone: Tone }
  visual: Visual                // required: every feature has one
  gated?: boolean               // hidden until verified on main
}

type ModuleContent = {
  slug: string
  headline: string
  lead: string
  outcomes: string[]                                     // 3 chips
  hero: { title: string; problem: string; solution: string; mockup: string }
  spotlights: [Spotlight, Spotlight]                     // exactly 2
  groups: { label: string; features: Feature[] }[]
  detailList?: { title: string; items: string[] }
  page: PageVisuals                                      // P1–P9, required
}
type Spotlight = { title: string; line: string; bullets: [string, string, string]; mockup: string }

type Shot = { route: string; light: string; dark: string; mobile?: string; alt: string }
type Actor = { auto: true } | { role: string }          // drives the Auto badge vs role label

type PageVisuals = {
  hero: { screen: Shot; floating: [Visual, Visual]; phones?: boolean }        // P1
  facts: { value: string; caption: string; source: string }[]                  // P2, 3–4, source = file proving it
  howItWorks: { icon: string; label: string; caption: string; actor: Actor }[] // P3, 4–6 steps
  tour: { tab: string; shot: Shot; caption: string;
          hotspots: { x: number; y: number; text: string }[] }[]               // P4, 3–5 tabs; x/y in %
  beforeAfter: { before: string; beforeIcon: string; after: string; afterVisual: Visual }[] // P5, exactly 3
  day: { time: string; icon: string; line: string; actor: Actor; cron?: string }[]          // P6, 4–6
  connected: { slug: string; flow: string }[]                                  // P7, 3–5
  roles: { role: string; icon: string; line: string; crop: Shot }[]            // P8, 3–4
  phone?: { shots: Shot[]; caption: string }                                   // P9, omit to skip
}
```

- **Components:**
  - `components/visuals/` holds the 14 micro-visual components, one per type,
    plus `<MicroVisual visual={…} />` which switches on `type`.
  - `components/mockups/` holds the larger hero and spotlight mock-ups, one per
    module and spotlight (`SeatLedger`, `ResultRules`, `CoverArrangement`,
    `AgingBars`, …), about 36 in total.
  - `components/page-blocks/` holds the 9 page-level blocks (`LayeredHero`,
    `FactsBand`, `HowItWorks`, `ProductTour`, `BeforeAfter`, `DayTimeline`,
    `ConnectedModules`, `RolesStrip`, `PhoneShowcase`). Each takes its slice of
    `PageVisuals`, so all 12 module pages are one template filled from data.
  - `BrowserFrame` and `PhoneFrame` are shared wrappers used by P1, P4, P8 and P9.
  - All are server components with CSS-only animation, so they add almost no JS.
    The exceptions are `ProductTour` tabs and hotspot tooltips, which are small
    client components.
  - A `useInView` wrapper adds a `data-inview` attribute that starts the animation.
- **Screenshots for P1, P4, P8 and P9:**
  - About 70 captures (12 modules × hero + 3–5 tour tabs + role crops + phones),
    each in light and dark.
  - Captured from the seeded demo school with a **Playwright script**
    (`scripts/capture-shots.ts`) that logs in as each role, visits each `route`,
    sets the theme and viewport, and saves to
    `public/shots/<module>/<name>-{light,dark}.webp`.
  - Re-run it whenever the app's UI changes, so the site never shows an outdated screen.
- **Build order:**
  1. The 14 micro-visuals, checked on a `/dev/visuals` page showing every type in both themes.
  2. The 9 page blocks, checked on `/dev/blocks` with Exams data.
  3. The screenshot capture script.
  4. Hero and spotlight mock-ups, module by module, starting with Exams (the
     page in the screenshot), then filling `page` data for the other 11.
- **Copy and visual lint before publishing:**
  - a check that fails if any `line` exceeds 90 characters or contains `;`
  - a check that fails if any feature has no `visual`
  - a check that fails if a visual has more than 3 items
  - a check that fails if a group has more than 6 features
  - a check that fails if a module has no `page` data, if a fact has no
    `source`, or if a P6 `Auto` entry has no `cron` (or system-trigger) note
  - a check that fails if any `Shot` file is missing for either theme
- **Performance:**
  - Micro-visuals are HTML/CSS and inline SVG, not images, so they cost almost
    nothing.
  - Screenshots are the heavy part. Use `next/image` with WebP or AVIF, explicit
    sizes and `loading="lazy"` for everything except the P1 hero (which gets
    `priority`). Only the active tour tab's image loads; the others load on
    first click.
  - Target: under 1.2 MB of images transferred on first load of a module page,
    and the JS budget in `plan.md` §11 still met.
- **Done when:**
  - every feature card shows its micro-visual
  - every module has a hero and 2 spotlights
  - every module page shows all of P1–P8 (and P9 where it has a real phone view), with real screenshots from the seeded school
  - every P2 fact and P6 `Auto` time is traceable to code
  - all visuals render correctly in light and dark and at 390px
  - reduced motion shows the final states
  - no visual implies a gated capability (no maps, no WhatsApp bubbles, no AI card until merged)
