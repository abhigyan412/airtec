// Timetable engine — public contract (timetable-design.md §2).
// Pure types only: no I/O, no Prisma. Other agents code against this file.

export interface EnginePlacementPrefs {
  preferMorning?: boolean;
  avoidPeriod1?: boolean;
  avoidPostLunch?: boolean;
  preferLast?: boolean;
}

export interface EngineDemand {
  subjectId: string;
  teacherUserId: string;
  periodsPerWeek: number;
  doublePeriods: number;
  roomType?: string | null;
  placement?: EnginePlacementPrefs | null;
}

export interface EngineSection {
  sectionId: string;
  classId: string;
  classOrder: number;
  homeRoomId?: string | null;
  classTeacherUserId?: string | null;
  demands: EngineDemand[];
}

export interface EngineTeacher {
  teacherUserId: string;
  maxPerDay: number;
  maxPerWeek: number;
  maxConsecutive: number;
  blocked: { day: number; periodNumber: number }[];
  /** Optional (not in the base contract): enables UNDER_MIN_LOAD warnings when > 0. */
  minPerWeek?: number;
}

export interface EngineRoom {
  roomId: string;
  roomType: string;
  capacityGroups: number;
}

export interface EngineInput {
  days: number[];
  periodsPerDay: number;
  /** Teaching period numbers after which a break falls (a double may not span these). */
  breakAfter: number[];
  /** First teaching period after lunch. */
  postLunchPeriod?: number | null;
  sections: EngineSection[];
  teachers: EngineTeacher[];
  rooms: EngineRoom[];
  locked: EngineEntry[];
  /**
   * Occupancy from OTHER sections' active timetables (same branch+session).
   * Generation treats these as immovable teacher/room bookings so it never
   * double-books a teacher or overfills a typed room across sections; they are
   * excluded from the returned entries and from quota accounting.
   */
  external?: EngineEntry[];
  weights?: Partial<SoftWeights>;
}

export interface EngineEntry {
  sectionId: string;
  day: number;
  periodNumber: number;
  subjectId: string;
  teacherUserId: string;
  roomId?: string | null;
  isDoublePart?: boolean;
  isLocked?: boolean;
}

export type ConflictSeverity = "block" | "warn" | "info";

export type ConflictCode =
  | "TEACHER_DOUBLE_BOOKED"
  | "SECTION_SLOT_CONFLICT"
  | "ROOM_OVERBOOKED"
  | "QUOTA_UNMET"
  | "QUOTA_EXCEEDED"
  | "TEACHER_MAX_PER_DAY"
  | "TEACHER_MAX_PER_WEEK"
  | "BLOCKED_SLOT"
  | "DOUBLE_SPANS_BREAK"
  | "CONSECUTIVE_OVERRUN"
  | "NO_FREE_PERIOD_DAY"
  | "SUBJECT_TWICE_A_DAY"
  | "SUBJECT_GAP_DAY"
  | "HEAVY_LAST_PERIOD"
  | "UNDER_MIN_LOAD"
  | "CLASS_TEACHER_NOT_P1"
  // Rooms are best-effort (audit item 10): a typed-room demand that found no
  // free room degrades to the section's own classroom and reports this warn.
  | "ROOM_FALLBACK"
  // A locked half of a double period whose partner cannot be placed adjacently
  // is demoted to a single (audit item 9) — reported, never an eternal block.
  | "LOCKED_DOUBLE_DEMOTED"
  // Locked cells outside the current day template's range (audit item 30c):
  // surfaced so callers can skip/re-place them instead of silently emitting.
  | "LOCKED_OUT_OF_RANGE";

export const CONFLICT_SEVERITY: Record<ConflictCode, ConflictSeverity> = {
  TEACHER_DOUBLE_BOOKED: "block",
  SECTION_SLOT_CONFLICT: "block",
  ROOM_OVERBOOKED: "block",
  QUOTA_UNMET: "block",
  QUOTA_EXCEEDED: "block",
  TEACHER_MAX_PER_DAY: "block",
  TEACHER_MAX_PER_WEEK: "block",
  BLOCKED_SLOT: "block",
  DOUBLE_SPANS_BREAK: "block",
  CONSECUTIVE_OVERRUN: "warn",
  NO_FREE_PERIOD_DAY: "warn",
  SUBJECT_TWICE_A_DAY: "warn",
  SUBJECT_GAP_DAY: "warn",
  HEAVY_LAST_PERIOD: "warn",
  UNDER_MIN_LOAD: "warn",
  CLASS_TEACHER_NOT_P1: "info",
  ROOM_FALLBACK: "warn",
  LOCKED_DOUBLE_DEMOTED: "warn",
  LOCKED_OUT_OF_RANGE: "warn",
};

export interface EngineConflict {
  code: string;
  severity: ConflictSeverity;
  message: string;
  cells: { sectionId?: string; teacherUserId?: string; day: number; periodNumber: number }[];
}

export interface FeasibilityIssue {
  code: string;
  message: string;
  detail?: unknown;
  /**
   * "block" (the default when omitted) makes the input infeasible; "warn" is
   * advisory — generation proceeds best-effort. Room-type shortfalls are warn
   * because generation degrades typed-room demand to the homeroom (audit
   * item 10c: feasibility must match generation's best-effort room policy).
   */
  severity?: "block" | "warn";
}

export interface FeasibilityReport {
  /** True when no block-severity issue exists (warn issues do not gate). */
  feasible: boolean;
  issues: FeasibilityIssue[];
  stats: { subjectDemand: Record<string, number>; subjectCapacity: Record<string, number> };
}

export interface EngineResult {
  ok: boolean;
  entries: EngineEntry[];
  score: number;
  conflicts: EngineConflict[];
  log: string[];
}

export interface SwapSuggestion {
  description: string;
  swapWith: { day: number; periodNumber: number };
}

/** Weights for the soft-constraint penalty (lower total = better timetable). */
export interface SoftWeights {
  /** preferMorning subject placed after the morning block. */
  preferMorning: number;
  /** Same subject sitting in the same period number on multiple days. */
  samePeriodDaily: number;
  /** Teacher consecutive-run length beyond their maxConsecutive. */
  teacherConsecutive: number;
  /** Same subject more than once per day for a section (spread across the week). */
  spreadAcrossWeek: number;
  /** Class teacher not taking period 1 of their own section. */
  classTeacherP1: number;
  /** avoidPostLunch subject placed in the first post-lunch period. */
  avoidPostLunch: number;
  /** avoidPeriod1 subject placed in period 1. */
  avoidPeriod1: number;
  /** preferLast subject not placed in the last period. */
  preferLast: number;
  /** Imbalance between a teacher's heaviest and lightest day. */
  teacherDayBalance: number;
  /**
   * A cell demanding a typed room (lab/ground) sitting in the homeroom instead.
   * Keeps local search from trading an assigned lab away for minor soft wins
   * (audit item 10b) and rewards swaps that recover a typed room.
   */
  roomFallback: number;
  /** Same-day repeats of a subject not sitting back-to-back (split by gap/break). */
  sameDayGap: number;
}

export const DEFAULT_SOFT_WEIGHTS: SoftWeights = {
  preferMorning: 4,
  samePeriodDaily: 2,
  teacherConsecutive: 6,
  spreadAcrossWeek: 3,
  // High: the class teacher opening their own section's day is a hard school
  // convention — it must beat the same-period-daily spread penalty it causes.
  classTeacherP1: 8,
  avoidPostLunch: 3,
  avoidPeriod1: 3,
  preferLast: 2,
  teacherDayBalance: 2,
  // Higher than any single placement preference: losing a lab must never be a
  // "profitable" side effect of chasing one soft-preference point.
  roomFallback: 5,
  // High: a split same-day repeat only ever comes out of the last-resort
  // relaxed attempt — closing the gap is local search's top priority.
  sameDayGap: 10,
};
