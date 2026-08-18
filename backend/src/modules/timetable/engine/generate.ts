// Auto-generation engine (timetable.md §5.3): feasibility → locked → doubles →
// greedy most-constrained-first singles → seeded swap-based local search.
// Pure logic: deterministic for a given seed, no I/O, no Prisma.

import type {
  EngineConflict,
  EngineEntry,
  EngineInput,
  EnginePlacementPrefs,
  EngineResult,
  EngineRoom,
  EngineTeacher,
  SoftWeights,
} from "./types";
import { CONFLICT_SEVERITY, DEFAULT_SOFT_WEIGHTS } from "./types";
import { checkFeasibility, defaultTeacher } from "./feasibility";
import { detectConflicts } from "./conflicts";

/** Deterministic PRNG (mulberry32). Never use Math.random in the engine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (...parts: (string | number)[]): string => parts.join("\u001f");

interface Cell {
  sectionId: string;
  day: number;
  periodNumber: number;
  subjectId: string;
  teacherUserId: string;
  roomId: string | null;
  roomType: string | null;
  isDoublePart: boolean;
  isLocked: boolean;
}

interface Group {
  sectionId: string;
  subjectId: string;
  teacherUserId: string;
  roomType: string | null;
  placement: EnginePlacementPrefs | null;
  singles: number;
  doubles: number;
  /** Locked half-doubles attributed to this row, awaiting an adjacent partner (audit item 9). */
  orphanHalves: EngineEntry[];
}

interface Ctx {
  input: EngineInput;
  weights: SoftWeights;
  teachers: Map<string, EngineTeacher>;
  blocked: Set<string>;
  roomsByType: Map<string, EngineRoom[]>;
  classTeacherBySection: Map<string, string>;
  /** Sections this run is generating for (external occupancy is excluded from output). */
  targets: Set<string>;
  /** section⋅subject → max occurrences/day implied by the weekly quota (ceil(quota/days)). */
  dayCap: Map<string, number>;
  /** Extra occurrences/day tolerated (bumped on the final placement attempt). */
  dayCapRelax: number;
  morningEnd: number;
  rng: () => number;
  log: string[];
}

class State {
  grid = new Map<string, Cell>(); // section⋅day⋅period → cell
  teacherCount = new Map<string, number>(); // teacher⋅day⋅period → bookings
  teacherCell = new Map<string, string>(); // teacher⋅day⋅period → grid key (for ejection)
  teacherDay = new Map<string, number>(); // teacher⋅day → periods
  teacherWeek = new Map<string, number>(); // teacher → periods
  roomUse = new Map<string, number>(); // room⋅day⋅period → groups
  subjDay = new Map<string, number>(); // section⋅subject⋅day → count
  subjPeriod = new Map<string, number>(); // section⋅subject⋅period → count

  place(cell: Cell): void {
    const gk = key(cell.sectionId, cell.day, cell.periodNumber);
    this.grid.set(gk, cell);
    const tk = key(cell.teacherUserId, cell.day, cell.periodNumber);
    this.teacherCount.set(tk, (this.teacherCount.get(tk) ?? 0) + 1);
    this.teacherCell.set(tk, gk);
    const dk = key(cell.teacherUserId, cell.day);
    this.teacherDay.set(dk, (this.teacherDay.get(dk) ?? 0) + 1);
    this.teacherWeek.set(cell.teacherUserId, (this.teacherWeek.get(cell.teacherUserId) ?? 0) + 1);
    if (cell.roomId) {
      const rk = key(cell.roomId, cell.day, cell.periodNumber);
      this.roomUse.set(rk, (this.roomUse.get(rk) ?? 0) + 1);
    }
    const sdk = key(cell.sectionId, cell.subjectId, cell.day);
    this.subjDay.set(sdk, (this.subjDay.get(sdk) ?? 0) + 1);
    const spk = key(cell.sectionId, cell.subjectId, cell.periodNumber);
    this.subjPeriod.set(spk, (this.subjPeriod.get(spk) ?? 0) + 1);
  }

  unplace(cell: Cell): void {
    const gk = key(cell.sectionId, cell.day, cell.periodNumber);
    this.grid.delete(gk);
    const tk = key(cell.teacherUserId, cell.day, cell.periodNumber);
    const tc = (this.teacherCount.get(tk) ?? 0) - 1;
    if (tc <= 0) {
      this.teacherCount.delete(tk);
      this.teacherCell.delete(tk);
    } else {
      this.teacherCount.set(tk, tc);
    }
    const dk = key(cell.teacherUserId, cell.day);
    this.teacherDay.set(dk, (this.teacherDay.get(dk) ?? 0) - 1);
    this.teacherWeek.set(cell.teacherUserId, (this.teacherWeek.get(cell.teacherUserId) ?? 0) - 1);
    if (cell.roomId) {
      const rk = key(cell.roomId, cell.day, cell.periodNumber);
      const rc = (this.roomUse.get(rk) ?? 0) - 1;
      if (rc <= 0) this.roomUse.delete(rk);
      else this.roomUse.set(rk, rc);
    }
    const sdk = key(cell.sectionId, cell.subjectId, cell.day);
    this.subjDay.set(sdk, (this.subjDay.get(sdk) ?? 0) - 1);
    const spk = key(cell.sectionId, cell.subjectId, cell.periodNumber);
    this.subjPeriod.set(spk, (this.subjPeriod.get(spk) ?? 0) - 1);
  }
}

function getTeacher(ctx: Ctx, teacherUserId: string): EngineTeacher {
  return ctx.teachers.get(teacherUserId) ?? defaultTeacher(teacherUserId, ctx.input);
}

function slotOpen(
  ctx: Ctx,
  state: State,
  sectionId: string,
  teacherUserId: string,
  day: number,
  periodNumber: number,
): boolean {
  if (state.grid.has(key(sectionId, day, periodNumber))) return false;
  if ((state.teacherCount.get(key(teacherUserId, day, periodNumber)) ?? 0) > 0) return false;
  if (ctx.blocked.has(key(teacherUserId, day, periodNumber))) return false;
  return true;
}

function teacherHasCapacity(
  ctx: Ctx,
  state: State,
  teacherUserId: string,
  day: number,
  add: number,
): boolean {
  const t = getTeacher(ctx, teacherUserId);
  if ((state.teacherDay.get(key(teacherUserId, day)) ?? 0) + add > t.maxPerDay) return false;
  if ((state.teacherWeek.get(teacherUserId) ?? 0) + add > t.maxPerWeek) return false;
  return true;
}

/** First room of the type with free capacity at the slot(s); undefined = none. */
function findRoom(
  ctx: Ctx,
  state: State,
  roomType: string,
  day: number,
  periods: number[],
): string | undefined {
  for (const room of ctx.roomsByType.get(roomType) ?? []) {
    const free = periods.every(
      (p) => (state.roomUse.get(key(room.roomId, day, p)) ?? 0) < room.capacityGroups,
    );
    if (free) return room.roomId;
  }
  return undefined;
}

/**
 * Typed rooms never BLOCK a placement: prefer a free room of the demanded type,
 * fall back to the section's own classroom (roomId null). Overbooking a typed
 * room is therefore impossible by construction.
 */
function pickRoom(
  ctx: Ctx,
  state: State,
  roomType: string | null,
  day: number,
  periods: number[],
): string | null {
  if (!roomType) return null;
  return findRoom(ctx, state, roomType, day, periods) ?? null;
}

/** Occurrences of a subject already on a section's day (a double pair counts once). */
function dayOccurrences(
  ctx: Ctx,
  state: State,
  sectionId: string,
  subjectId: string,
  day: number,
): number {
  let singles = 0;
  let doubleParts = 0;
  for (let p = 1; p <= ctx.input.periodsPerDay; p++) {
    const c = state.grid.get(key(sectionId, day, p));
    if (c && c.subjectId === subjectId) {
      if (c.isDoublePart) doubleParts += 1;
      else singles += 1;
    }
  }
  return singles + Math.ceil(doubleParts / 2);
}

/** Max occurrences/day the weekly quota implies (repeats beyond it are avoidable). */
function capFor(ctx: Ctx, sectionId: string, subjectId: string): number {
  return (ctx.dayCap.get(key(sectionId, subjectId)) ?? Number.POSITIVE_INFINITY) + ctx.dayCapRelax;
}

function underDayCap(
  ctx: Ctx,
  state: State,
  sectionId: string,
  subjectId: string,
  day: number,
): boolean {
  return dayOccurrences(ctx, state, sectionId, subjectId, day) < capFor(ctx, sectionId, subjectId);
}

/**
 * All periods of a subject on a section's day (plus the tentative `extra`
 * slots) must form one contiguous, break-free run — a same-day repeat is a
 * back-to-back double, never two lessons split across the day.
 *
 * Hard on normal attempts; on the final day-cap-relaxed attempt it degrades to
 * a soft preference (see slotPenalty / scoreState) so a gap warning can beat an
 * unplaced blocking period, mirroring the day-cap relax philosophy.
 */
function sameDayRunOk(
  ctx: Ctx,
  state: State,
  sectionId: string,
  subjectId: string,
  day: number,
  extra: number[],
): boolean {
  const periods = [...extra];
  for (let p = 1; p <= ctx.input.periodsPerDay; p++) {
    const c = state.grid.get(key(sectionId, day, p));
    if (c && c.subjectId === subjectId) periods.push(p);
  }
  if (periods.length <= 1) return true;
  periods.sort((a, b) => a - b);
  for (let i = 1; i < periods.length; i++) {
    const prev = periods[i - 1]!;
    if (periods[i]! !== prev + 1) return false;
    if (ctx.input.breakAfter.includes(prev)) return false;
  }
  return true;
}

function canPlaceSingle(
  ctx: Ctx,
  state: State,
  g: Group,
  day: number,
  periodNumber: number,
): boolean {
  if (!slotOpen(ctx, state, g.sectionId, g.teacherUserId, day, periodNumber)) return false;
  if (!teacherHasCapacity(ctx, state, g.teacherUserId, day, 1)) return false;
  if (!underDayCap(ctx, state, g.sectionId, g.subjectId, day)) return false;
  if (
    ctx.dayCapRelax === 0 &&
    !sameDayRunOk(ctx, state, g.sectionId, g.subjectId, day, [periodNumber])
  )
    return false;
  return true;
}

/** Greedy desirability of a slot for a group — lower is better. Seeded jitter breaks ties. */
function slotPenalty(ctx: Ctx, state: State, g: Group, day: number, periodNumber: number): number {
  const w = ctx.weights;
  let pen = ctx.rng() * 0.5;
  pen += (state.subjDay.get(key(g.sectionId, g.subjectId, day)) ?? 0) * w.spreadAcrossWeek * 2;
  pen +=
    (state.subjPeriod.get(key(g.sectionId, g.subjectId, periodNumber)) ?? 0) * w.samePeriodDaily;
  pen += (state.teacherDay.get(key(g.teacherUserId, day)) ?? 0) * 0.5;
  // Pull the class teacher's own subject into period 1 of their section.
  if (periodNumber === 1 && ctx.classTeacherBySection.get(g.sectionId) === g.teacherUserId)
    pen -= w.classTeacherP1 * 2;
  const p = g.placement;
  if (p?.preferMorning && periodNumber > ctx.morningEnd) pen += w.preferMorning;
  if (p?.avoidPeriod1 && periodNumber === 1) pen += w.avoidPeriod1;
  if (
    p?.avoidPostLunch &&
    ctx.input.postLunchPeriod != null &&
    periodNumber === ctx.input.postLunchPeriod
  )
    pen += w.avoidPostLunch;
  if (p?.preferLast && periodNumber !== ctx.input.periodsPerDay) pen += w.preferLast;
  // Only reachable on the relaxed attempt: strongly prefer keeping a same-day
  // repeat back-to-back over splitting it across the day.
  if (!sameDayRunOk(ctx, state, g.sectionId, g.subjectId, day, [periodNumber])) pen += w.sameDayGap;
  return pen;
}

// ── Soft-constraint score (lower = better) ─────────────────────────────────────

function scoreState(ctx: Ctx, state: State): number {
  const w = ctx.weights;
  const { periodsPerDay, postLunchPeriod, days } = ctx.input;
  let score = 0;

  const prefsBySectionSubject = new Map<string, EnginePlacementPrefs | null>();
  for (const section of ctx.input.sections) {
    for (const d of section.demands)
      prefsBySectionSubject.set(key(section.sectionId, d.subjectId), d.placement ?? null);
  }

  const teacherDayPeriods = new Map<string, number[]>();
  for (const cell of state.grid.values()) {
    const prefs = prefsBySectionSubject.get(key(cell.sectionId, cell.subjectId));
    if (prefs?.preferMorning && cell.periodNumber > ctx.morningEnd) score += w.preferMorning;
    if (prefs?.avoidPeriod1 && cell.periodNumber === 1) score += w.avoidPeriod1;
    if (prefs?.avoidPostLunch && postLunchPeriod != null && cell.periodNumber === postLunchPeriod)
      score += w.avoidPostLunch;
    if (prefs?.preferLast && cell.periodNumber !== periodsPerDay) score += w.preferLast;
    // Audit item 10b: a typed-room demand sitting in the homeroom costs — a
    // swap that silently strips a lab now raises the score (and one that
    // recovers a lab lowers it), so local search never prefers room loss.
    if (cell.roomType && !cell.roomId) score += w.roomFallback;
    const tdk = key(cell.teacherUserId, cell.day);
    const list = teacherDayPeriods.get(tdk) ?? [];
    list.push(cell.periodNumber);
    teacherDayPeriods.set(tdk, list);
  }

  // Same subject repeated within a day (doubles count as one occurrence).
  for (const [k, count] of state.subjDay) {
    if (count < 2) continue;
    const parts = k.split("\u001f");
    const sectionId = parts[0] ?? "";
    const subjectId = parts[1] ?? "";
    const day = Number(parts[2]);
    let doubleParts = 0;
    const periods: number[] = [];
    for (let p = 1; p <= periodsPerDay; p++) {
      const cell = state.grid.get(key(sectionId, day, p));
      if (cell && cell.subjectId === subjectId) {
        periods.push(p);
        if (cell.isDoublePart) doubleParts += 1;
      }
    }
    const occurrences = count - doubleParts + Math.ceil(doubleParts / 2);
    if (occurrences > 1) score += (occurrences - 1) * w.spreadAcrossWeek;
    // Split same-day repeat (gap or break inside the run) — only ever produced
    // by the relaxed attempt; heavily penalized so local search closes it.
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1]!;
      if (periods[i]! !== prev + 1 || ctx.input.breakAfter.includes(prev)) {
        score += w.sameDayGap;
        break;
      }
    }
  }

  // Same subject pinned to the same period number across days — EXCEPT the
  // class teacher's subject at period 1, which we deliberately pin daily.
  const ctP1Exempt = new Set<string>();
  for (const section of ctx.input.sections) {
    const ct = ctx.classTeacherBySection.get(section.sectionId);
    if (!ct) continue;
    for (const d of section.demands) {
      if (d.teacherUserId === ct) ctP1Exempt.add(key(section.sectionId, d.subjectId, 1));
    }
  }
  for (const [k, count] of state.subjPeriod) {
    if (count > 1 && !ctP1Exempt.has(k)) score += (count - 1) * w.samePeriodDaily;
  }

  // Teacher consecutive runs beyond maxConsecutive.
  for (const [tdk, periods] of teacherDayPeriods) {
    const teacherUserId = tdk.split("\u001f")[0] ?? "";
    const maxConsecutive = getTeacher(ctx, teacherUserId).maxConsecutive;
    periods.sort((a, b) => a - b);
    let runStart = 0;
    for (let i = 1; i <= periods.length; i++) {
      const prev = periods[i - 1];
      if (i < periods.length && prev !== undefined && periods[i] === prev + 1) continue;
      const runLen = i - runStart;
      if (runLen > maxConsecutive) score += (runLen - maxConsecutive) * w.teacherConsecutive;
      runStart = i;
    }
  }

  // Teacher day balance: spread between heaviest and lightest working day.
  for (const [teacherUserId, weekLoad] of state.teacherWeek) {
    if (weekLoad <= 0) continue;
    let max = 0;
    let min = Number.POSITIVE_INFINITY;
    for (const day of days) {
      const load = state.teacherDay.get(key(teacherUserId, day)) ?? 0;
      if (load > max) max = load;
      if (load < min) min = load;
    }
    if (max - min > 1) score += (max - min - 1) * w.teacherDayBalance;
  }

  // Class teacher taking P1 of their own section.
  for (const [sectionId, classTeacherUserId] of ctx.classTeacherBySection) {
    for (const day of days) {
      const p1 = state.grid.get(key(sectionId, day, 1));
      if (p1 && p1.teacherUserId !== classTeacherUserId) score += w.classTeacherP1;
    }
  }

  return score;
}

// ── Placement phases ───────────────────────────────────────────────────────────

/**
 * Locked isDoublePart cells with no adjacent locked partner (same
 * section/day/subject/teacher). Greedy adjacent pairing, like detectConflicts.
 */
function findOrphanLockedHalves(locked: EngineEntry[]): Set<EngineEntry> {
  const byRun = new Map<string, EngineEntry[]>();
  for (const e of locked) {
    if (!e.isDoublePart) continue;
    const k = key(e.sectionId, e.day, e.subjectId, e.teacherUserId);
    const list = byRun.get(k) ?? [];
    list.push(e);
    byRun.set(k, list);
  }
  const orphans = new Set<EngineEntry>();
  for (const parts of byRun.values()) {
    parts.sort((a, b) => a.periodNumber - b.periodNumber);
    let i = 0;
    while (i < parts.length) {
      const a = parts[i]!;
      const b = parts[i + 1];
      if (b && b.periodNumber === a.periodNumber + 1) {
        i += 2; // a fully locked pair — nothing to complete
      } else {
        orphans.add(a);
        i += 1;
      }
    }
  }
  return orphans;
}

/**
 * Build demand rows and attribute locked periods to them (audit item 8): each
 * locked cell reduces exactly ONE row's remaining quota — a row whose teacher
 * matches the locked cell's teacher when one exists; otherwise the subject's
 * rows in input order as a deterministic fallback (first row with spare quota,
 * else the first row). A locked cell is never counted against two rows, so
 * split demand (same subject, two teachers) no longer double-subtracts.
 */
function buildGroups(ctx: Ctx): Group[] {
  type Row = Group & {
    quota: number;
    demandDoubles: number;
    lockedCount: number;
    lockedPairedParts: number;
  };
  const rows: Row[] = [];
  const bySectionSubject = new Map<string, Row[]>();
  for (const section of ctx.input.sections) {
    for (const d of section.demands) {
      const row: Row = {
        sectionId: section.sectionId,
        subjectId: d.subjectId,
        teacherUserId: d.teacherUserId,
        roomType: d.roomType ?? null,
        placement: d.placement ?? null,
        singles: 0,
        doubles: 0,
        orphanHalves: [],
        quota: d.periodsPerWeek,
        demandDoubles: d.doublePeriods,
        lockedCount: 0,
        lockedPairedParts: 0,
      };
      rows.push(row);
      const k = key(section.sectionId, d.subjectId);
      const list = bySectionSubject.get(k) ?? [];
      list.push(row);
      bySectionSubject.set(k, list);
    }
  }
  const orphans = findOrphanLockedHalves(ctx.input.locked);
  for (const e of ctx.input.locked) {
    const candidates = bySectionSubject.get(key(e.sectionId, e.subjectId)) ?? [];
    if (candidates.length === 0) continue; // subject not in the plan — QUOTA_EXCEEDED reports it
    const matching = candidates.filter((r) => r.teacherUserId === e.teacherUserId);
    const pool = matching.length > 0 ? matching : candidates;
    const target = pool.find((r) => r.lockedCount < r.quota) ?? pool[0]!;
    target.lockedCount += 1;
    if (e.isDoublePart) {
      if (orphans.has(e)) target.orphanHalves.push(e);
      else target.lockedPairedParts += 1;
    }
  }
  for (const row of rows) {
    const remaining = Math.max(0, row.quota - row.lockedCount);
    const satisfiedDoubles = Math.floor(row.lockedPairedParts / 2);
    let doubles = Math.min(
      Math.max(0, row.demandDoubles - satisfiedDoubles),
      Math.floor(remaining / 2),
    );
    let singles = remaining - doubles * 2;
    // Same-day repeats must sit back-to-back, so every repeat the weekly
    // quota forces (more occurrence-days than school days) is a de-facto
    // double: convert those singles into pairs and let the doubles pass
    // place them adjacently, instead of hoping singles land side by side.
    const forcedPairs = Math.min(
      Math.floor(singles / 2),
      Math.max(0, doubles + singles - ctx.input.days.length),
    );
    doubles += forcedPairs;
    singles -= forcedPairs * 2;
    row.doubles = doubles;
    row.singles = singles;
  }
  return rows;
}

function placeLocked(ctx: Ctx, state: State): void {
  for (const e of ctx.input.locked) {
    state.place({
      sectionId: e.sectionId,
      day: e.day,
      periodNumber: e.periodNumber,
      subjectId: e.subjectId,
      teacherUserId: e.teacherUserId,
      roomId: e.roomId ?? null,
      roomType: null,
      isDoublePart: e.isDoublePart ?? false,
      isLocked: true,
    });
  }
  if (ctx.input.locked.length > 0) ctx.log.push(`placed ${ctx.input.locked.length} locked cell(s)`);
}

/**
 * Seed other sections' active-timetable occupancy as immovable cells so the
 * teacher/room bookkeeping sees the whole branch, not just the target sections.
 * These are stripped from the result by the target-section filter.
 */
function placeExternal(ctx: Ctx, state: State): void {
  const external = ctx.input.external ?? [];
  for (const e of external) {
    state.place({
      sectionId: e.sectionId,
      day: e.day,
      periodNumber: e.periodNumber,
      subjectId: e.subjectId,
      teacherUserId: e.teacherUserId,
      roomId: e.roomId ?? null,
      roomType: null,
      isDoublePart: e.isDoublePart ?? false,
      isLocked: true, // repair/ejection must never move another section's lesson
    });
  }
  if (external.length > 0)
    ctx.log.push(
      `seeded ${external.length} occupied cell(s) from other sections' active timetables`,
    );
}

interface LockedDoubleOutcome {
  /** Locked halves demoted to singles (isDoublePart cleared in the OUTPUT). */
  demoted: {
    sectionId: string;
    teacherUserId: string;
    subjectId: string;
    day: number;
    periodNumber: number;
  }[];
  completed: number;
}

/**
 * Audit item 9 — a locked cell marked isDoublePart with no locked partner used
 * to be an eternal DOUBLE_SPANS_BREAK block. Policy:
 *  1. Try to place the partner adjacent to the locked half — the period above
 *     first, then the one below (deterministic) — respecting the template
 *     range, breaks, section/teacher availability and the teacher's day/week
 *     capacity. A completed pair satisfies one demanded double and consumes
 *     one period of the row's remaining quota.
 *  2. Otherwise (no legal adjacent slot, no quota left, or the locked cell is
 *     outside the template range) DEMOTE: clear isDoublePart on the locked
 *     cell in the OUTPUT and report LOCKED_DOUBLE_DEMOTED (warn). The cell
 *     still counts toward quota as a single; the demanded double stays in the
 *     row's budget, so a fresh pair is still attempted elsewhere if it fits.
 */
function completeLockedDoubles(ctx: Ctx, state: State, groups: Group[]): LockedDoubleOutcome {
  const outcome: LockedDoubleOutcome = { demoted: [], completed: 0 };
  for (const g of groups) {
    for (const e of g.orphanHalves) {
      const inRange =
        ctx.input.days.includes(e.day) &&
        e.periodNumber >= 1 &&
        e.periodNumber <= ctx.input.periodsPerDay;
      const hasBudget = g.doubles > 0 || g.singles > 0;
      let partnerAt: number | null = null;
      if (inRange && hasBudget) {
        for (const pp of [e.periodNumber + 1, e.periodNumber - 1]) {
          if (pp < 1 || pp > ctx.input.periodsPerDay) continue;
          // The pair (min..min+1) must not span the break after its lower period.
          if (ctx.input.breakAfter.includes(Math.min(e.periodNumber, pp))) continue;
          if (!slotOpen(ctx, state, e.sectionId, e.teacherUserId, e.day, pp)) continue;
          if (!teacherHasCapacity(ctx, state, e.teacherUserId, e.day, 1)) continue;
          partnerAt = pp;
          break;
        }
      }
      if (partnerAt !== null) {
        const roomId = pickRoom(ctx, state, g.roomType, e.day, [partnerAt]);
        state.place({
          sectionId: e.sectionId,
          day: e.day,
          periodNumber: partnerAt,
          subjectId: e.subjectId,
          teacherUserId: e.teacherUserId,
          roomId,
          roomType: g.roomType,
          isDoublePart: true,
          isLocked: false,
        });
        // Budget: the completed pair satisfies one demanded double using the
        // locked half (already deducted at attribution) plus this partner — a
        // planned fresh pair (2 periods) collapses into 1 partner period.
        if (g.doubles > 0) {
          g.doubles -= 1;
          g.singles += 1;
        } else {
          g.singles -= 1;
        }
        outcome.completed += 1;
        ctx.log.push(
          `locked half-double: placed partner for section ${e.sectionId} subject ${e.subjectId} at day ${e.day} P${partnerAt}`,
        );
      } else {
        const cell = state.grid.get(key(e.sectionId, e.day, e.periodNumber));
        if (cell?.isDoublePart) {
          state.unplace(cell);
          state.place({ ...cell, isDoublePart: false });
        }
        outcome.demoted.push({
          sectionId: e.sectionId,
          teacherUserId: e.teacherUserId,
          subjectId: e.subjectId,
          day: e.day,
          periodNumber: e.periodNumber,
        });
        ctx.log.push(
          `locked half-double: no adjacent partner possible for section ${e.sectionId} subject ${e.subjectId} day ${e.day} P${e.periodNumber} — demoted to a single (LOCKED_DOUBLE_DEMOTED)`,
        );
      }
    }
  }
  return outcome;
}

function doubleCandidates(
  ctx: Ctx,
  state: State,
  g: Group,
): { day: number; periodNumber: number }[] {
  const out: { day: number; periodNumber: number }[] = [];
  for (const day of ctx.input.days) {
    for (let p = 1; p < ctx.input.periodsPerDay; p++) {
      if (ctx.input.breakAfter.includes(p)) continue; // would span the break after p
      if (!slotOpen(ctx, state, g.sectionId, g.teacherUserId, day, p)) continue;
      if (!slotOpen(ctx, state, g.sectionId, g.teacherUserId, day, p + 1)) continue;
      if (!teacherHasCapacity(ctx, state, g.teacherUserId, day, 2)) continue;
      if (!underDayCap(ctx, state, g.sectionId, g.subjectId, day)) continue;
      if (
        ctx.dayCapRelax === 0 &&
        !sameDayRunOk(ctx, state, g.sectionId, g.subjectId, day, [p, p + 1])
      )
        continue;
      out.push({ day, periodNumber: p });
    }
  }
  return out;
}

/** Place all doubles most-constrained-first. Returns the number left unplaced. */
function placeDoubles(ctx: Ctx, state: State, groups: Group[]): number {
  let failed = 0;
  for (;;) {
    let best: { g: Group; candidates: { day: number; periodNumber: number }[] } | null = null;
    for (const g of groups) {
      if (g.doubles <= 0) continue;
      const candidates = doubleCandidates(ctx, state, g);
      if (best === null || candidates.length < best.candidates.length) best = { g, candidates };
    }
    if (best === null) return failed;
    const { g, candidates } = best;
    if (candidates.length === 0) {
      ctx.log.push(
        `FAIL: section ${g.sectionId} subject ${g.subjectId} double period cannot fit — no adjacent free pair for teacher ${g.teacherUserId}${g.roomType ? ` with a free ${g.roomType}` : ""}`,
      );
      g.doubles = 0;
      failed += 1;
      continue;
    }
    let chosen = candidates[0];
    let chosenPen = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const pen =
        slotPenalty(ctx, state, g, c.day, c.periodNumber) +
        slotPenalty(ctx, state, g, c.day, c.periodNumber + 1);
      if (pen < chosenPen) {
        chosen = c;
        chosenPen = pen;
      }
    }
    if (!chosen) return failed;
    const roomId = pickRoom(ctx, state, g.roomType, chosen.day, [
      chosen.periodNumber,
      chosen.periodNumber + 1,
    ]);
    for (const p of [chosen.periodNumber, chosen.periodNumber + 1]) {
      state.place({
        sectionId: g.sectionId,
        day: chosen.day,
        periodNumber: p,
        subjectId: g.subjectId,
        teacherUserId: g.teacherUserId,
        roomId,
        roomType: g.roomType,
        isDoublePart: true,
        isLocked: false,
      });
    }
    g.doubles -= 1;
  }
}

/**
 * Section-local repair: vacate a slot where g's teacher IS free by moving that
 * slot's current lesson (taught by a different teacher) into one of the
 * section's still-free slots.
 */
function trySectionSwapRepair(ctx: Ctx, state: State, g: Group): boolean {
  const free: { day: number; periodNumber: number }[] = [];
  const occupied: Cell[] = [];
  for (const day of ctx.input.days) {
    for (let p = 1; p <= ctx.input.periodsPerDay; p++) {
      const cell = state.grid.get(key(g.sectionId, day, p));
      if (!cell) free.push({ day, periodNumber: p });
      else if (!cell.isLocked && !cell.isDoublePart && cell.teacherUserId !== g.teacherUserId)
        occupied.push(cell);
    }
  }
  for (const victim of occupied) {
    state.unplace(victim);
    // Removing the victim must not split a same-subject run left on its day.
    if (
      ctx.dayCapRelax === 0 &&
      !sameDayRunOk(ctx, state, victim.sectionId, victim.subjectId, victim.day, [])
    ) {
      state.place(victim);
      continue;
    }
    // Can g take the vacated slot at all?
    const gFits =
      slotOpen(ctx, state, g.sectionId, g.teacherUserId, victim.day, victim.periodNumber) &&
      teacherHasCapacity(ctx, state, g.teacherUserId, victim.day, 1) &&
      underDayCap(ctx, state, g.sectionId, g.subjectId, victim.day) &&
      (ctx.dayCapRelax > 0 ||
        sameDayRunOk(ctx, state, g.sectionId, g.subjectId, victim.day, [victim.periodNumber]));
    if (gFits) {
      for (const target of free) {
        if (
          !slotOpen(
            ctx,
            state,
            victim.sectionId,
            victim.teacherUserId,
            target.day,
            target.periodNumber,
          )
        )
          continue;
        if (!teacherHasCapacity(ctx, state, victim.teacherUserId, target.day, 1)) continue;
        if (!underDayCap(ctx, state, victim.sectionId, victim.subjectId, target.day)) continue;
        if (
          ctx.dayCapRelax === 0 &&
          !sameDayRunOk(ctx, state, victim.sectionId, victim.subjectId, target.day, [
            target.periodNumber,
          ])
        )
          continue;
        const victimRoomId = pickRoom(ctx, state, victim.roomType, target.day, [
          target.periodNumber,
        ]);
        state.place({
          ...victim,
          day: target.day,
          periodNumber: target.periodNumber,
          roomId: victimRoomId,
        });
        const roomId = pickRoom(ctx, state, g.roomType, victim.day, [victim.periodNumber]);
        state.place({
          sectionId: g.sectionId,
          day: victim.day,
          periodNumber: victim.periodNumber,
          subjectId: g.subjectId,
          teacherUserId: g.teacherUserId,
          roomId,
          roomType: g.roomType,
          isDoublePart: false,
          isLocked: false,
        });
        return true;
      }
    }
    state.place(victim); // restore and try the next victim
  }
  return false;
}

/** Free a slot for `g` by relocating the blocking single of the same teacher (depth-1 ejection). */
function tryEject(ctx: Ctx, state: State, g: Group): boolean {
  for (const day of ctx.input.days) {
    for (let p = 1; p <= ctx.input.periodsPerDay; p++) {
      if (state.grid.has(key(g.sectionId, day, p))) continue;
      if (ctx.blocked.has(key(g.teacherUserId, day, p))) continue;
      if (!teacherHasCapacity(ctx, state, g.teacherUserId, day, 1)) continue;
      if (!underDayCap(ctx, state, g.sectionId, g.subjectId, day)) continue;
      if (ctx.dayCapRelax === 0 && !sameDayRunOk(ctx, state, g.sectionId, g.subjectId, day, [p]))
        continue;
      const blockKey = state.teacherCell.get(key(g.teacherUserId, day, p));
      if (!blockKey) continue;
      const victim = state.grid.get(blockKey);
      if (!victim || victim.isLocked || victim.isDoublePart) continue;
      state.unplace(victim);
      // Removing the victim must not split a same-subject run left on its day.
      if (
        ctx.dayCapRelax === 0 &&
        !sameDayRunOk(ctx, state, victim.sectionId, victim.subjectId, victim.day, [])
      ) {
        state.place(victim);
        continue;
      }
      let relocated = false;
      for (const day2 of ctx.input.days) {
        for (let p2 = 1; p2 <= ctx.input.periodsPerDay && !relocated; p2++) {
          if (day2 === day && p2 === p) continue;
          if (!slotOpen(ctx, state, victim.sectionId, victim.teacherUserId, day2, p2)) continue;
          if (!teacherHasCapacity(ctx, state, victim.teacherUserId, day2, 1)) continue;
          if (!underDayCap(ctx, state, victim.sectionId, victim.subjectId, day2)) continue;
          if (
            ctx.dayCapRelax === 0 &&
            !sameDayRunOk(ctx, state, victim.sectionId, victim.subjectId, day2, [p2])
          )
            continue;
          const roomId = pickRoom(ctx, state, victim.roomType, day2, [p2]);
          state.place({ ...victim, day: day2, periodNumber: p2, roomId });
          relocated = true;
        }
        if (relocated) break;
      }
      if (!relocated) {
        state.place(victim); // restore and try the next slot
        continue;
      }
      const roomId = pickRoom(ctx, state, g.roomType, day, [p]);
      state.place({
        sectionId: g.sectionId,
        day,
        periodNumber: p,
        subjectId: g.subjectId,
        teacherUserId: g.teacherUserId,
        roomId,
        roomType: g.roomType,
        isDoublePart: false,
        isLocked: false,
      });
      return true;
    }
  }
  return false;
}

/** Greedy most-constrained-first placement of singles. Returns unplaced count. */
function placeSingles(ctx: Ctx, state: State, groups: Group[]): number {
  let failed = 0;
  for (;;) {
    let best: {
      g: Group;
      count: number;
      slot: { day: number; periodNumber: number } | null;
      slotPen: number;
    } | null = null;
    for (const g of groups) {
      if (g.singles <= 0) continue;
      let count = 0;
      let bestSlot: { day: number; periodNumber: number } | null = null;
      let bestPen = Number.POSITIVE_INFINITY;
      for (const day of ctx.input.days) {
        for (let p = 1; p <= ctx.input.periodsPerDay; p++) {
          if (!canPlaceSingle(ctx, state, g, day, p)) continue;
          count += 1;
          const pen = slotPenalty(ctx, state, g, day, p);
          if (pen < bestPen) {
            bestPen = pen;
            bestSlot = { day, periodNumber: p };
          }
        }
      }
      if (best === null || count < best.count)
        best = { g, count, slot: bestSlot, slotPen: bestPen };
    }
    if (best === null) return failed;
    const { g, slot } = best;
    if (slot === null) {
      if (trySectionSwapRepair(ctx, state, g) || tryEject(ctx, state, g)) {
        g.singles -= 1;
        continue;
      }
      ctx.log.push(
        `FAIL: section ${g.sectionId} subject ${g.subjectId} — no legal slot left for teacher ${g.teacherUserId} (busy, blocked or at capacity on every free slot${g.roomType ? `, or no free ${g.roomType}` : ""})`,
      );
      failed += g.singles;
      g.singles = 0;
      continue;
    }
    const roomId = g.roomType
      ? (findRoom(ctx, state, g.roomType, slot.day, [slot.periodNumber]) ?? null)
      : null;
    state.place({
      sectionId: g.sectionId,
      day: slot.day,
      periodNumber: slot.periodNumber,
      subjectId: g.subjectId,
      teacherUserId: g.teacherUserId,
      roomId,
      roomType: g.roomType,
      isDoublePart: false,
      isLocked: false,
    });
    g.singles -= 1;
  }
}

// ── Local search ───────────────────────────────────────────────────────────────

/** Try to swap the contents of two cells of one section. Returns an undo fn, or null if illegal. */
function trySwap(
  ctx: Ctx,
  state: State,
  sectionId: string,
  a: { day: number; periodNumber: number },
  b: { day: number; periodNumber: number },
): (() => void) | null {
  const cellA = state.grid.get(key(sectionId, a.day, a.periodNumber));
  const cellB = state.grid.get(key(sectionId, b.day, b.periodNumber));
  if (!cellA && !cellB) return null;
  if (cellA && (cellA.isLocked || cellA.isDoublePart)) return null;
  if (cellB && (cellB.isLocked || cellB.isDoublePart)) return null;

  if (cellA) state.unplace(cellA);
  if (cellB) state.unplace(cellB);

  const placedNew: Cell[] = [];
  const revert = (): void => {
    for (const c of placedNew) state.unplace(c);
    if (cellA) state.place(cellA);
    if (cellB) state.place(cellB);
  };
  const placeAt = (cell: Cell, at: { day: number; periodNumber: number }): boolean => {
    if (!slotOpen(ctx, state, sectionId, cell.teacherUserId, at.day, at.periodNumber)) return false;
    if (!teacherHasCapacity(ctx, state, cell.teacherUserId, at.day, 1)) return false;
    if (!underDayCap(ctx, state, sectionId, cell.subjectId, at.day)) return false;
    const roomId = pickRoom(ctx, state, cell.roomType, at.day, [at.periodNumber]);
    const moved = { ...cell, day: at.day, periodNumber: at.periodNumber, roomId };
    state.place(moved);
    placedNew.push(moved);
    return true;
  };

  if (cellA && !placeAt(cellA, b)) {
    revert();
    return null;
  }
  if (cellB && !placeAt(cellB, a)) {
    revert();
    return null;
  }
  // Moving a cell must not split (or create a split) same-subject run on any
  // affected day — same-day repeats stay back-to-back through local search.
  for (const cell of [cellA, cellB]) {
    if (!cell) continue;
    if (
      !sameDayRunOk(ctx, state, sectionId, cell.subjectId, a.day, []) ||
      !sameDayRunOk(ctx, state, sectionId, cell.subjectId, b.day, [])
    ) {
      revert();
      return null;
    }
  }
  return revert;
}

function localSearch(
  ctx: Ctx,
  state: State,
  iterations: number,
): { initial: number; final: number; iterationsRun: number } {
  const sections = ctx.input.sections;
  const { days, periodsPerDay } = ctx.input;
  let current = scoreState(ctx, state);
  const initial = current;
  let sinceImproved = 0;
  let i = 0;
  for (; i < iterations && sections.length > 0 && current > 0; i++) {
    if (sinceImproved >= 300) break;
    const section = sections[Math.floor(ctx.rng() * sections.length)];
    if (!section) break;
    const dayA = days[Math.floor(ctx.rng() * days.length)];
    const dayB = days[Math.floor(ctx.rng() * days.length)];
    if (dayA === undefined || dayB === undefined) break;
    const pA = 1 + Math.floor(ctx.rng() * periodsPerDay);
    const pB = 1 + Math.floor(ctx.rng() * periodsPerDay);
    if (dayA === dayB && pA === pB) {
      sinceImproved += 1;
      continue;
    }
    const undo = trySwap(
      ctx,
      state,
      section.sectionId,
      { day: dayA, periodNumber: pA },
      { day: dayB, periodNumber: pB },
    );
    if (undo === null) {
      sinceImproved += 1;
      continue;
    }
    const next = scoreState(ctx, state);
    if (next < current) {
      current = next;
      sinceImproved = 0;
    } else {
      undo();
      sinceImproved += 1;
    }
  }
  return { initial, final: current, iterationsRun: i };
}

// ── Entry point ────────────────────────────────────────────────────────────────

export function generateTimetable(
  input: EngineInput,
  opts?: { seed?: number; iterations?: number },
): EngineResult {
  const seed = opts?.seed ?? 1;
  const iterations = opts?.iterations ?? 2000;
  const log: string[] = [
    `generate: seed=${seed}, iterations=${iterations}, sections=${input.sections.length}, days=${input.days.length}, periods/day=${input.periodsPerDay}`,
  ];

  const feasibility = checkFeasibility(input);
  if (!feasibility.feasible) {
    log.push(
      `feasibility: FAIL (${feasibility.issues.length} issue(s)) — aborting before placement`,
    );
    for (const issue of feasibility.issues) log.push(`  - [${issue.code}] ${issue.message}`);
    return {
      ok: false,
      entries: input.locked.map((e) => ({ ...e, isLocked: true })),
      score: 0,
      conflicts: [],
      log,
    };
  }
  // Warn-severity issues (room shortfalls) don't gate — generation proceeds
  // best-effort and reports ROOM_FALLBACK on the cells it degrades (item 10c).
  const feasibilityWarns = feasibility.issues.filter((i) => i.severity === "warn");
  log.push(
    feasibilityWarns.length > 0
      ? `feasibility: OK with ${feasibilityWarns.length} warning(s)`
      : "feasibility: OK",
  );
  for (const issue of feasibilityWarns) log.push(`  - [${issue.code}] ${issue.message}`);

  // Audit item 30c: locked cells beyond the current template's range cannot be
  // honored — surface them instead of silently emitting out-of-range entries.
  const outOfRangeLocked = input.locked.filter(
    (e) =>
      !input.days.includes(e.day) || e.periodNumber < 1 || e.periodNumber > input.periodsPerDay,
  );
  if (outOfRangeLocked.length > 0)
    log.push(
      `WARN: ${outOfRangeLocked.length} locked cell(s) fall outside the day template (LOCKED_OUT_OF_RANGE)`,
    );

  const dayCap = new Map<string, number>();
  for (const section of input.sections) {
    const totals = new Map<string, number>();
    for (const d of section.demands)
      totals.set(d.subjectId, (totals.get(d.subjectId) ?? 0) + d.periodsPerWeek);
    for (const [subjectId, total] of totals) {
      dayCap.set(
        key(section.sectionId, subjectId),
        Math.max(1, Math.ceil(total / Math.max(1, input.days.length))),
      );
    }
  }

  const ctx: Ctx = {
    input,
    weights: { ...DEFAULT_SOFT_WEIGHTS, ...input.weights },
    teachers: new Map(input.teachers.map((t) => [t.teacherUserId, t])),
    blocked: new Set(
      input.teachers.flatMap((t) =>
        t.blocked.map((b) => key(t.teacherUserId, b.day, b.periodNumber)),
      ),
    ),
    roomsByType: input.rooms.reduce((m, r) => {
      const list = m.get(r.roomType) ?? [];
      list.push(r);
      m.set(r.roomType, list);
      return m;
    }, new Map<string, EngineRoom[]>()),
    classTeacherBySection: new Map(
      input.sections
        .filter((s) => s.classTeacherUserId)
        .map((s) => [s.sectionId, s.classTeacherUserId as string]),
    ),
    targets: new Set(input.sections.map((s) => s.sectionId)),
    dayCap,
    dayCapRelax: 0,
    morningEnd:
      input.postLunchPeriod != null
        ? input.postLunchPeriod - 1
        : Math.ceil(input.periodsPerDay / 2),
    rng: mulberry32(seed),
    log,
  };

  // Placement with randomized restarts: keep the attempt with the fewest
  // failures. The final attempt relaxes the per-day repeat cap by one — a
  // repeat warning beats an unplaced (blocking) period.
  const maxAttempts = 4;
  let bestState: State | null = null;
  let bestFailed = Number.POSITIVE_INFINITY;
  let bestDemoted: LockedDoubleOutcome["demoted"] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    ctx.dayCapRelax = attempt === maxAttempts ? 1 : 0;
    const state = new State();
    placeExternal(ctx, state);
    placeLocked(ctx, state);
    const groups = buildGroups(ctx);
    const lockedDoubles = completeLockedDoubles(ctx, state, groups);
    const failedDoubles = placeDoubles(ctx, state, groups);
    const failedSingles = placeSingles(ctx, state, groups);
    const failed = failedDoubles * 2 + failedSingles;
    log.push(
      `attempt ${attempt}: doubles placed (${failedDoubles} failed), singles placed (${failedSingles} failed)${ctx.dayCapRelax ? " [day-cap relaxed]" : ""}`,
    );
    if (failed < bestFailed) {
      bestFailed = failed;
      bestState = state;
      bestDemoted = lockedDoubles.demoted;
    }
    if (failed === 0) break;
    if (attempt < maxAttempts)
      log.push(
        `attempt ${attempt}: ${failed} period(s) unplaced — restarting with reshuffled ordering`,
      );
  }
  ctx.dayCapRelax = 0;
  const state = bestState ?? new State();
  if (bestFailed > 0)
    log.push(
      `placement incomplete: ${bestFailed} period(s) could not be placed (see FAIL lines above)`,
    );

  const search = localSearch(ctx, state, iterations);
  log.push(
    `local search: score ${search.initial} → ${search.final} in ${search.iterationsRun} iteration(s)`,
  );

  const sectionOrder = new Map(input.sections.map((s, i) => [s.sectionId, i]));
  const entries: EngineEntry[] = [...state.grid.values()]
    .filter((c) => ctx.targets.has(c.sectionId)) // strip external occupancy
    .sort(
      (a, b) =>
        (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0) ||
        a.day - b.day ||
        a.periodNumber - b.periodNumber,
    )
    .map((c) => ({
      sectionId: c.sectionId,
      day: c.day,
      periodNumber: c.periodNumber,
      subjectId: c.subjectId,
      teacherUserId: c.teacherUserId,
      roomId: c.roomId,
      isDoublePart: c.isDoublePart,
      isLocked: c.isLocked,
    }));

  // Check against the full branch picture, then keep findings that touch a
  // target section — pre-existing clashes among other sections are not this
  // generation's report to make. Section-agnostic findings (no section-bearing
  // cells, e.g. a zero-placement UNDER_MIN_LOAD with an empty cells array) are
  // kept: they were previously dropped by the some() filter (audit item 30b).
  const allConflicts = detectConflicts([...entries, ...(input.external ?? [])], input);
  const conflicts = allConflicts.filter((c) => {
    const touchesTarget = c.cells.some(
      (cell) => cell.sectionId !== undefined && ctx.targets.has(cell.sectionId),
    );
    const sectionAgnostic = c.cells.every((cell) => cell.sectionId === undefined);
    return touchesTarget || sectionAgnostic;
  });

  // Audit item 10a: typed-room demand that ended in the homeroom, per
  // (section, subject, roomType), with the affected cells.
  const fallbackCells = new Map<string, Cell[]>();
  for (const c of state.grid.values()) {
    if (!ctx.targets.has(c.sectionId)) continue;
    if (!c.roomType || c.roomId) continue;
    const k = key(c.sectionId, c.subjectId, c.roomType);
    const list = fallbackCells.get(k) ?? [];
    list.push(c);
    fallbackCells.set(k, list);
  }
  for (const [k, cells] of [...fallbackCells.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [sectionId = "", subjectId = "", roomType = ""] = k.split("\u001f");
    cells.sort((a, b) => a.day - b.day || a.periodNumber - b.periodNumber);
    conflicts.push({
      code: "ROOM_FALLBACK",
      severity: CONFLICT_SEVERITY.ROOM_FALLBACK,
      message: `Section ${sectionId}: subject ${subjectId} needs a "${roomType}" room but none was free for ${cells.length} period(s) — held in the section's own classroom`,
      cells: cells.map((c) => ({
        sectionId: c.sectionId,
        teacherUserId: c.teacherUserId,
        day: c.day,
        periodNumber: c.periodNumber,
      })),
    } satisfies EngineConflict);
  }

  // Audit item 9: locked half-doubles that could not be completed (demoted).
  for (const d of bestDemoted) {
    conflicts.push({
      code: "LOCKED_DOUBLE_DEMOTED",
      severity: CONFLICT_SEVERITY.LOCKED_DOUBLE_DEMOTED,
      message: `Section ${d.sectionId}: locked half of a double period for subject ${d.subjectId} (day ${d.day} P${d.periodNumber}) has no possible adjacent partner — kept as a single period`,
      cells: [
        {
          sectionId: d.sectionId,
          teacherUserId: d.teacherUserId,
          day: d.day,
          periodNumber: d.periodNumber,
        },
      ],
    } satisfies EngineConflict);
  }

  // Audit item 30c: locked cells the current template cannot represent.
  if (outOfRangeLocked.length > 0) {
    conflicts.push({
      code: "LOCKED_OUT_OF_RANGE",
      severity: CONFLICT_SEVERITY.LOCKED_OUT_OF_RANGE,
      message: `${outOfRangeLocked.length} locked cell(s) fall outside the current day template (${input.days.length} day(s) × ${input.periodsPerDay} period(s)) and cannot be honored — unlock or re-place them`,
      cells: outOfRangeLocked.map((e) => ({
        sectionId: e.sectionId,
        teacherUserId: e.teacherUserId,
        day: e.day,
        periodNumber: e.periodNumber,
      })),
    } satisfies EngineConflict);
  }

  const blocks = conflicts.filter((c) => c.severity === "block").length;
  const ok = bestFailed === 0 && blocks === 0;
  log.push(
    `done: ${entries.length} entries, ${conflicts.length} conflict(s) (${blocks} blocking), ok=${ok}`,
  );
  return { ok, entries, score: Math.round(search.final), conflicts, log };
}
