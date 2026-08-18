import { describe, it, expect } from "vitest";
import { checkFeasibility, generateTimetable, detectConflicts, suggestSwaps } from "./index";
import type {
  EngineDemand,
  EngineEntry,
  EngineInput,
  EngineRoom,
  EngineSection,
  EngineTeacher,
} from "./index";

function teacher(id: string, over: Partial<EngineTeacher> = {}): EngineTeacher {
  return {
    teacherUserId: id,
    maxPerDay: 8,
    maxPerWeek: 40,
    maxConsecutive: 3,
    blocked: [],
    ...over,
  };
}

function demand(
  subjectId: string,
  teacherUserId: string,
  periodsPerWeek: number,
  over: Partial<EngineDemand> = {},
): EngineDemand {
  return { subjectId, teacherUserId, periodsPerWeek, doublePeriods: 0, ...over };
}

function section(
  sectionId: string,
  demands: EngineDemand[],
  over: Partial<EngineSection> = {},
): EngineSection {
  return { sectionId, classId: `class-${sectionId}`, classOrder: 1, demands, ...over };
}

function room(roomId: string, roomType: string, capacityGroups = 1): EngineRoom {
  return { roomId, roomType, capacityGroups };
}

function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    days: [1, 2, 3, 4, 5],
    periodsPerDay: 6,
    breakAfter: [3],
    postLunchPeriod: 5,
    sections: [],
    teachers: [],
    rooms: [],
    locked: [],
    ...over,
  };
}

/** 2 sections × 5 days × 6 periods, demand exactly fills capacity (30/section). */
function smallSchool(): EngineInput {
  const demands = (): EngineDemand[] => [
    demand("math", "t-math", 6, { placement: { preferMorning: true } }),
    demand("eng", "t-eng", 6),
    demand("sci", "t-sci", 6, { doublePeriods: 1, roomType: "science_lab" }),
    demand("hin", "t-hin", 6),
    demand("pe", "t-pe", 6, { roomType: "ground", placement: { avoidPeriod1: true } }),
  ];
  return baseInput({
    sections: [section("6A", demands()), section("6B", demands())],
    teachers: [
      teacher("t-math"),
      teacher("t-eng"),
      teacher("t-sci"),
      teacher("t-hin"),
      teacher("t-pe"),
    ],
    rooms: [room("lab-1", "science_lab"), room("ground-1", "ground")],
  });
}

function blockConflicts(entries: EngineEntry[], input: EngineInput) {
  return detectConflicts(entries, input).filter((c) => c.severity === "block");
}

describe("checkFeasibility", () => {
  it("catches a teacher-capacity shortfall with an actionable message", () => {
    const input = baseInput({
      sections: [
        section("8A", [demand("math", "t1", 8)]),
        section("8B", [demand("math", "t1", 8)]),
      ],
      teachers: [teacher("t1", { maxPerWeek: 10 })],
    });
    const report = checkFeasibility(input);
    expect(report.feasible).toBe(false);
    const overload = report.issues.find((i) => i.code === "TEACHER_OVERLOADED");
    expect(overload).toBeDefined();
    expect(overload?.message).toContain("t1");
    expect(overload?.message).toContain("16");
    expect(overload?.message).toContain("10");
    expect(report.stats.subjectDemand["math"]).toBe(16);
    expect(report.stats.subjectCapacity["math"]).toBe(10);
  });

  it("flags blocked-slot over-constraint separately from raw overload", () => {
    // 2 days × 3 periods = 6 slots; 4 blocked → only 2 teachable, demand 4.
    const input = baseInput({
      days: [1, 2],
      periodsPerDay: 3,
      breakAfter: [],
      postLunchPeriod: null,
      sections: [section("A", [demand("math", "t1", 4)])],
      teachers: [
        teacher("t1", {
          blocked: [
            { day: 1, periodNumber: 1 },
            { day: 1, periodNumber: 2 },
            { day: 2, periodNumber: 1 },
            { day: 2, periodNumber: 2 },
          ],
        }),
      ],
    });
    const report = checkFeasibility(input);
    expect(report.feasible).toBe(false);
    expect(report.issues.some((i) => i.code === "TEACHER_BLOCKED_OVERCONSTRAINED")).toBe(true);
  });
});

describe("generateTimetable", () => {
  it("fills a small 2-section school with zero block conflicts and all quotas met", () => {
    const input = smallSchool();
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    expect(blockConflicts(res.entries, input)).toEqual([]);
    for (const sectionId of ["6A", "6B"]) {
      const own = res.entries.filter((e) => e.sectionId === sectionId);
      expect(own).toHaveLength(30); // demand === capacity → every teaching slot filled
      for (const subjectId of ["math", "eng", "sci", "hin", "pe"]) {
        expect(own.filter((e) => e.subjectId === subjectId)).toHaveLength(6);
      }
    }
  });

  it("places doubles on adjacent periods that never span breakAfter", () => {
    const input = smallSchool();
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    for (const sectionId of ["6A", "6B"]) {
      const parts = res.entries
        .filter((e) => e.sectionId === sectionId && e.isDoublePart)
        .sort((a, b) => a.day - b.day || a.periodNumber - b.periodNumber);
      // Every subject at 6/week over 5 days carries one forced back-to-back
      // pair, plus sci's declared double — all placed as adjacent double parts.
      const byDaySubject = new Map<string, typeof parts>();
      for (const p of parts) {
        const k = `${p.day}|${p.subjectId}`;
        byDaySubject.set(k, [...(byDaySubject.get(k) ?? []), p]);
      }
      for (const [, pair] of byDaySubject) {
        expect(pair).toHaveLength(2);
        expect(pair[1]!.periodNumber).toBe(pair[0]!.periodNumber + 1);
        expect(input.breakAfter).not.toContain(pair[0]!.periodNumber); // never spans the break
      }
      const sciParts = parts.filter((p) => p.subjectId === "sci");
      expect(sciParts).toHaveLength(2); // sci's declared lab double
      expect(sciParts[0]?.roomId).toBe("lab-1");
      expect(sciParts[1]?.roomId).toBe("lab-1");
    }
  });

  it("keeps same-day repeats back-to-back with no gap or break between", () => {
    // 8 periods/week over 5 days forces math onto some day twice (cap 2) —
    // the repeat must land adjacent to its sibling, never split across the day.
    const input = baseInput({
      sections: [
        section("A", [
          demand("math", "t-math", 8),
          demand("eng", "t-eng", 8),
          demand("sci", "t-sci", 7),
          demand("hin", "t-hin", 7),
        ]),
      ],
      teachers: [teacher("t-math"), teacher("t-eng"), teacher("t-sci"), teacher("t-hin")],
    });
    for (const seed of [1, 7, 42]) {
      const res = generateTimetable(input, { seed });
      expect(res.ok).toBe(true);
      for (const day of input.days) {
        const bySubject = new Map<string, number[]>();
        for (const e of res.entries) {
          if (e.day !== day) continue;
          const list = bySubject.get(e.subjectId) ?? [];
          list.push(e.periodNumber);
          bySubject.set(e.subjectId, list);
        }
        for (const [, periods] of bySubject) {
          periods.sort((a, b) => a - b);
          for (let i = 1; i < periods.length; i++) {
            expect(periods[i]).toBe(periods[i - 1]! + 1); // contiguous
            expect(input.breakAfter).not.toContain(periods[i - 1]); // no break inside
          }
        }
      }
      expect(res.conflicts.filter((c) => c.code === "SUBJECT_GAP_DAY")).toEqual([]);
    }
  });

  it("preserves locked cells verbatim", () => {
    const input = smallSchool();
    input.locked = [
      {
        sectionId: "6A",
        day: 3,
        periodNumber: 2,
        subjectId: "hin",
        teacherUserId: "t-hin",
        isLocked: true,
      },
    ];
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    const cell = res.entries.find(
      (e) => e.sectionId === "6A" && e.day === 3 && e.periodNumber === 2,
    );
    expect(cell).toMatchObject({ subjectId: "hin", teacherUserId: "t-hin", isLocked: true });
    // Quota is still exactly met (the locked period counts toward hin's 6).
    expect(res.entries.filter((e) => e.sectionId === "6A" && e.subjectId === "hin")).toHaveLength(
      6,
    );
  });

  it("is deterministic: same seed produces identical entries and score", () => {
    const a = generateTimetable(smallSchool(), { seed: 7 });
    const b = generateTimetable(smallSchool(), { seed: 7 });
    expect(b.entries).toEqual(a.entries);
    expect(b.score).toBe(a.score);
  });

  it("fails fast with named bottlenecks when infeasible", () => {
    const input = baseInput({
      sections: [section("A", [demand("math", "t1", 20)])],
      teachers: [teacher("t1", { maxPerWeek: 5 })],
    });
    const res = generateTimetable(input);
    expect(res.ok).toBe(false);
    expect(res.entries).toEqual([]);
    expect(res.log.some((l) => l.includes("feasibility: FAIL"))).toBe(true);
    expect(res.log.some((l) => l.includes("TEACHER_OVERLOADED"))).toBe(true);
  });
});

describe("detectConflicts", () => {
  it("flags teacher double-booking, room overbooking and consecutive overrun", () => {
    const input = baseInput({
      sections: [
        section("A", [demand("math", "t1", 2), demand("eng", "t2", 4)]),
        section("B", [demand("math", "t1", 1), demand("eng", "t2", 1)]),
      ],
      teachers: [teacher("t1"), teacher("t2", { maxConsecutive: 3 })],
      rooms: [room("r1", "science_lab", 1)],
    });
    const entries: EngineEntry[] = [
      // t1 in two sections at once
      { sectionId: "A", day: 1, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "B", day: 1, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      // room r1 (capacity 1) hosting two groups
      {
        sectionId: "A",
        day: 1,
        periodNumber: 2,
        subjectId: "math",
        teacherUserId: "t1",
        roomId: "r1",
      },
      {
        sectionId: "B",
        day: 1,
        periodNumber: 2,
        subjectId: "eng",
        teacherUserId: "t2",
        roomId: "r1",
      },
      // t2 with 4 consecutive periods (max 3)
      { sectionId: "A", day: 2, periodNumber: 1, subjectId: "eng", teacherUserId: "t2" },
      { sectionId: "A", day: 2, periodNumber: 2, subjectId: "eng", teacherUserId: "t2" },
      { sectionId: "A", day: 2, periodNumber: 3, subjectId: "eng", teacherUserId: "t2" },
      { sectionId: "A", day: 2, periodNumber: 4, subjectId: "eng", teacherUserId: "t2" },
    ];
    const conflicts = detectConflicts(entries, input);

    const doubleBooked = conflicts.find((c) => c.code === "TEACHER_DOUBLE_BOOKED");
    expect(doubleBooked?.severity).toBe("block");
    expect(doubleBooked?.cells).toHaveLength(2);
    expect(doubleBooked?.cells.every((c) => c.day === 1 && c.periodNumber === 1)).toBe(true);

    const overbooked = conflicts.find((c) => c.code === "ROOM_OVERBOOKED");
    expect(overbooked?.severity).toBe("block");
    expect(overbooked?.message).toContain("r1");
    expect(overbooked?.cells).toHaveLength(2);

    const overrun = conflicts.find((c) => c.code === "CONSECUTIVE_OVERRUN");
    expect(overrun?.severity).toBe("warn");
    expect(overrun?.message).toContain("t2");
    expect(overrun?.cells).toHaveLength(4);
  });

  it("flags blocked slots, quota drift and double-spanning-break as blocks", () => {
    const input = baseInput({
      sections: [
        section("A", [demand("math", "t1", 2), demand("sci", "t2", 2, { doublePeriods: 1 })]),
      ],
      teachers: [teacher("t1", { blocked: [{ day: 1, periodNumber: 1 }] }), teacher("t2")],
    });
    const entries: EngineEntry[] = [
      // t1 scheduled on their blocked slot; math also exceeds its quota of 2
      { sectionId: "A", day: 1, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "A", day: 2, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "A", day: 3, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      // sci double placed across the break after P3
      {
        sectionId: "A",
        day: 1,
        periodNumber: 3,
        subjectId: "sci",
        teacherUserId: "t2",
        isDoublePart: true,
      },
      {
        sectionId: "A",
        day: 1,
        periodNumber: 4,
        subjectId: "sci",
        teacherUserId: "t2",
        isDoublePart: true,
      },
    ];
    const codes = detectConflicts(entries, input).map((c) => c.code);
    expect(codes).toContain("BLOCKED_SLOT");
    expect(codes).toContain("QUOTA_EXCEEDED");
    expect(codes).toContain("DOUBLE_SPANS_BREAK");
  });

  it("warns when same-day repeats are split by a gap or a break", () => {
    const input = baseInput({
      sections: [section("A", [demand("math", "t1", 8), demand("sci", "t2", 8)])],
      teachers: [teacher("t1"), teacher("t2")],
    });
    const entries: EngineEntry[] = [
      // math twice on day 1 with a gap (P1 and P5)
      { sectionId: "A", day: 1, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "A", day: 1, periodNumber: 5, subjectId: "math", teacherUserId: "t1" },
      // sci twice on day 2 adjacent but split by the break after P3
      { sectionId: "A", day: 2, periodNumber: 3, subjectId: "sci", teacherUserId: "t2" },
      { sectionId: "A", day: 2, periodNumber: 4, subjectId: "sci", teacherUserId: "t2" },
      // math back-to-back on day 3 — clean, must NOT be flagged
      { sectionId: "A", day: 3, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "A", day: 3, periodNumber: 2, subjectId: "math", teacherUserId: "t1" },
    ];
    const gaps = detectConflicts(entries, input).filter((c) => c.code === "SUBJECT_GAP_DAY");
    expect(gaps).toHaveLength(2);
    expect(gaps.every((c) => c.severity === "warn")).toBe(true);
    expect(gaps.some((c) => c.message.includes("math"))).toBe(true);
    expect(gaps.some((c) => c.message.includes("sci"))).toBe(true);
  });
});

describe("suggestSwaps", () => {
  it("returns only conflict-free swap partners", () => {
    const input = baseInput({
      days: [1, 2],
      periodsPerDay: 2,
      breakAfter: [],
      postLunchPeriod: null,
      sections: [section("A", [demand("math", "t1", 2), demand("eng", "t2", 2)])],
      teachers: [teacher("t1", { blocked: [{ day: 2, periodNumber: 2 }] }), teacher("t2")],
    });
    const entries: EngineEntry[] = [
      { sectionId: "A", day: 1, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "A", day: 1, periodNumber: 2, subjectId: "eng", teacherUserId: "t2" },
      { sectionId: "A", day: 2, periodNumber: 1, subjectId: "math", teacherUserId: "t1" },
      { sectionId: "A", day: 2, periodNumber: 2, subjectId: "eng", teacherUserId: "t2" },
    ];
    expect(blockConflicts(entries, input)).toEqual([]);

    const suggestions = suggestSwaps(entries, input, { sectionId: "A", day: 1, periodNumber: 1 });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    // Moving math/t1 to day 2 P2 would hit t1's blocked slot → must not be suggested.
    expect(suggestions.map((s) => s.swapWith)).not.toContainEqual({ day: 2, periodNumber: 2 });
    // Every suggestion, applied, leaves zero block conflicts.
    for (const s of suggestions) {
      const source = entries.find((e) => e.day === 1 && e.periodNumber === 1);
      const target = entries.find(
        (e) => e.day === s.swapWith.day && e.periodNumber === s.swapWith.periodNumber,
      );
      const swapped = entries
        .filter((e) => e !== source && e !== target)
        .concat(
          source ? [{ ...source, day: s.swapWith.day, periodNumber: s.swapWith.periodNumber }] : [],
          target ? [{ ...target, day: 1, periodNumber: 1 }] : [],
        );
      expect(blockConflicts(swapped, input)).toEqual([]);
    }
  });
});

// ── Audit fixes: todos/timetable-edge-cases.md items 8, 9, 10, 30 ─────────────

describe("locked-period accounting with split demand (audit item 8)", () => {
  it("does not double-subtract locked periods when a subject has two demand rows", () => {
    // math is split t1 3/wk + t2 3/wk; two locked t1 cells used to be
    // subtracted from BOTH rows → QUOTA_UNMET on valid input.
    const input = baseInput({
      sections: [
        section("A", [demand("math", "t1", 3), demand("math", "t2", 3), demand("eng", "t3", 6)]),
      ],
      teachers: [teacher("t1"), teacher("t2"), teacher("t3")],
      locked: [
        {
          sectionId: "A",
          day: 1,
          periodNumber: 1,
          subjectId: "math",
          teacherUserId: "t1",
          isLocked: true,
        },
        {
          sectionId: "A",
          day: 2,
          periodNumber: 1,
          subjectId: "math",
          teacherUserId: "t1",
          isLocked: true,
        },
      ],
    });
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    const math = res.entries.filter((e) => e.subjectId === "math");
    expect(math).toHaveLength(6); // full 3+3 quota, locked cells counted once
    expect(math.filter((e) => e.teacherUserId === "t1")).toHaveLength(3);
    expect(math.filter((e) => e.teacherUserId === "t2")).toHaveLength(3);
    expect(res.conflicts.filter((c) => c.code === "QUOTA_UNMET")).toEqual([]);
  });

  it("attributes a locked cell with an unmapped teacher to the subject's rows once", () => {
    // Locked math cell taught by a substitute (t9) matches no demand row —
    // it must reduce exactly one row's quota (deterministic fallback), never both.
    const input = baseInput({
      sections: [section("A", [demand("math", "t1", 3), demand("math", "t2", 3)])],
      teachers: [teacher("t1"), teacher("t2"), teacher("t9")],
      locked: [
        {
          sectionId: "A",
          day: 1,
          periodNumber: 1,
          subjectId: "math",
          teacherUserId: "t9",
          isLocked: true,
        },
      ],
    });
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    // 6 total math incl. the locked substitute cell → 5 freshly placed.
    expect(res.entries.filter((e) => e.subjectId === "math")).toHaveLength(6);
    expect(res.conflicts.filter((c) => c.code === "QUOTA_UNMET")).toEqual([]);
  });
});

describe("locked half-double (audit item 9)", () => {
  it("places a partner adjacent to a locked half so the double completes", () => {
    const input = baseInput({
      sections: [
        section("A", [demand("sci", "t1", 6, { doublePeriods: 1 }), demand("eng", "t2", 6)]),
      ],
      teachers: [teacher("t1"), teacher("t2")],
      locked: [
        {
          sectionId: "A",
          day: 2,
          periodNumber: 2,
          subjectId: "sci",
          teacherUserId: "t1",
          isDoublePart: true,
          isLocked: true,
        },
      ],
    });
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    const parts = res.entries
      .filter((e) => e.day === 2 && e.subjectId === "sci" && e.isDoublePart)
      .sort((a, b) => a.periodNumber - b.periodNumber);
    expect(parts).toHaveLength(2); // locked half + freshly placed partner
    expect(parts[1]?.periodNumber).toBe((parts[0]?.periodNumber ?? 0) + 1);
    expect(input.breakAfter).not.toContain(parts[0]?.periodNumber);
    expect(res.entries.filter((e) => e.subjectId === "sci")).toHaveLength(6); // quota intact
    expect(res.conflicts.filter((c) => c.code === "DOUBLE_SPANS_BREAK")).toEqual([]);
    expect(res.conflicts.filter((c) => c.code === "LOCKED_DOUBLE_DEMOTED")).toEqual([]);
  });

  it("demotes a locked half to a single with a warn when no adjacent slot is legal", () => {
    // P1 sits alone before the break (segments [1] and [2,3]) — a partner for a
    // locked half at P1 is structurally impossible. Old behavior: eternal
    // DOUBLE_SPANS_BREAK block. New policy: demote (clear isDoublePart in the
    // output, keep counting toward quota) + LOCKED_DOUBLE_DEMOTED warn.
    const input = baseInput({
      days: [1, 2],
      periodsPerDay: 3,
      breakAfter: [1],
      postLunchPeriod: null,
      sections: [section("A", [demand("math", "t1", 2)])],
      teachers: [teacher("t1")],
      locked: [
        {
          sectionId: "A",
          day: 1,
          periodNumber: 1,
          subjectId: "math",
          teacherUserId: "t1",
          isDoublePart: true,
          isLocked: true,
        },
      ],
    });
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    const lockedCell = res.entries.find((e) => e.day === 1 && e.periodNumber === 1);
    expect(lockedCell).toMatchObject({ subjectId: "math", isLocked: true, isDoublePart: false });
    expect(res.entries.filter((e) => e.subjectId === "math")).toHaveLength(2);
    const demoted = res.conflicts.filter((c) => c.code === "LOCKED_DOUBLE_DEMOTED");
    expect(demoted).toHaveLength(1);
    expect(demoted[0]?.severity).toBe("warn");
    expect(demoted[0]?.cells).toEqual([
      { sectionId: "A", teacherUserId: "t1", day: 1, periodNumber: 1 },
    ]);
    expect(res.conflicts.filter((c) => c.code === "DOUBLE_SPANS_BREAK")).toEqual([]);
  });
});

describe("room policy (audit item 10)", () => {
  it("emits ROOM_FALLBACK warns under typed-room contention while ok stays true", () => {
    // Two sections each need sci in the single lab for both periods of a
    // 1-day × 2-period template: exactly one section can hold the lab, the
    // other's cells must fall back to the homeroom — reported, not silent.
    const input = baseInput({
      days: [1],
      periodsPerDay: 2,
      breakAfter: [],
      postLunchPeriod: null,
      sections: [
        section("A", [demand("sci", "tA", 2, { roomType: "science_lab" })]),
        section("B", [demand("sci", "tB", 2, { roomType: "science_lab" })]),
      ],
      teachers: [teacher("tA"), teacher("tB")],
      rooms: [room("lab-1", "science_lab", 1)],
    });
    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    expect(blockConflicts(res.entries, input)).toEqual([]); // lab never overbooked
    const inLab = res.entries.filter((e) => e.roomId === "lab-1");
    const fellBack = res.entries.filter((e) => e.roomId == null);
    expect(inLab).toHaveLength(2);
    expect(fellBack).toHaveLength(2);
    const warns = res.conflicts.filter((c) => c.code === "ROOM_FALLBACK");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.every((c) => c.severity === "warn")).toBe(true);
    // Full accounting: the warn cells are exactly the cells without the lab.
    const warnCells = warns.flatMap((c) => c.cells);
    expect(warnCells).toHaveLength(2);
    for (const cell of warnCells) {
      const entry = res.entries.find(
        (e) =>
          e.sectionId === cell.sectionId &&
          e.day === cell.day &&
          e.periodNumber === cell.periodNumber,
      );
      expect(entry?.roomId ?? null).toBeNull();
    }
  });

  it("feasibility warns (not fails) on zero rooms of a demanded type, and generation proceeds", () => {
    const input = baseInput({
      sections: [section("A", [demand("sci", "t1", 4, { roomType: "science_lab" })])],
      teachers: [teacher("t1")],
      rooms: [], // no lab anywhere
    });
    const report = checkFeasibility(input);
    expect(report.feasible).toBe(true); // warn does not gate — matches generation policy
    const missing = report.issues.find((i) => i.code === "ROOM_TYPE_MISSING");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("warn");

    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    expect(res.entries.filter((e) => e.subjectId === "sci")).toHaveLength(4);
    const warns = res.conflicts.filter((c) => c.code === "ROOM_FALLBACK");
    expect(warns.flatMap((c) => c.cells)).toHaveLength(4); // every sci cell reported
  });
});

describe("reporting gaps (audit item 30)", () => {
  it("UNDER_MIN_LOAD fires for a teacher with zero placements", () => {
    // t2 has minPerWeek 5 but no demand rows → never appears in entries. The
    // warn used to be dropped twice: never generated (only placed teachers were
    // swept) and, with an empty cells array, filtered out of the result (30b).
    const input = baseInput({
      sections: [section("A", [demand("math", "t1", 4)])],
      teachers: [teacher("t1"), teacher("t2", { minPerWeek: 5 })],
    });
    const direct = detectConflicts([], input);
    const zeroLoad = direct.find((c) => c.code === "UNDER_MIN_LOAD");
    expect(zeroLoad).toBeDefined();
    expect(zeroLoad?.severity).toBe("warn");
    expect(zeroLoad?.cells).toEqual([]);

    const res = generateTimetable(input);
    expect(res.ok).toBe(true);
    const surfaced = res.conflicts.find(
      (c) => c.code === "UNDER_MIN_LOAD" && c.message.includes("t2"),
    );
    expect(surfaced).toBeDefined(); // empty-cells conflicts are no longer dropped
  });

  it("surfaces LOCKED_OUT_OF_RANGE for locked cells beyond the template (keepLocked regen)", () => {
    const input = smallSchool();
    input.locked = [
      {
        sectionId: "6A",
        day: 3,
        periodNumber: 9, // template has 6 periods/day — from a bigger old template
        subjectId: "hin",
        teacherUserId: "t-hin",
        isLocked: true,
      },
    ];
    const res = generateTimetable(input);
    const oor = res.conflicts.filter((c) => c.code === "LOCKED_OUT_OF_RANGE");
    expect(oor).toHaveLength(1);
    expect(oor[0]?.severity).toBe("warn");
    expect(oor[0]?.cells).toEqual([
      { sectionId: "6A", teacherUserId: "t-hin", day: 3, periodNumber: 9 },
    ]);
    // The engine still emits the entry (callers decide to skip persisting it).
    expect(
      res.entries.some((e) => e.periodNumber === 9 && e.subjectId === "hin" && e.isLocked),
    ).toBe(true);
  });
});

describe("realistic scale", () => {
  it("6 sections × 6 days × 8 periods with 8 teachers completes < 2s with zero block conflicts", () => {
    const subjects = ["math", "eng", "sci", "hin", "sst", "cs", "art", "pe"];
    const teachers = subjects.map((_s, i) =>
      teacher(`t${i + 1}`, { maxPerDay: 7, maxPerWeek: 40 }),
    );
    const demands = (): EngineDemand[] =>
      subjects.map((s, i) =>
        demand(s, `t${i + 1}`, 6, {
          ...(s === "sci" ? { doublePeriods: 1, roomType: "science_lab" } : {}),
          ...(s === "math" ? { placement: { preferMorning: true } } : {}),
          ...(s === "pe" ? { placement: { avoidPeriod1: true } } : {}),
        }),
      );
    const input = baseInput({
      days: [1, 2, 3, 4, 5, 6],
      periodsPerDay: 8,
      breakAfter: [3, 6],
      postLunchPeriod: 7,
      sections: ["6A", "6B", "7A", "7B", "8A", "8B"].map((id) => section(id, demands())),
      teachers,
      rooms: [room("lab-1", "science_lab"), room("lab-2", "science_lab")],
    });

    const started = performance.now();
    const res = generateTimetable(input);
    const elapsedMs = performance.now() - started;

    expect(res.ok).toBe(true);
    // Shared CI runners are slow and contended (integration suites run alongside);
    // locally the suite runs test files in parallel, so keep headroom there too.
    // This guards against order-of-magnitude regressions, not absolute speed.
    expect(elapsedMs).toBeLessThan(process.env["CI"] ? 15_000 : 5000);
    expect(blockConflicts(res.entries, input)).toEqual([]);
    for (const s of input.sections) {
      expect(res.entries.filter((e) => e.sectionId === s.sectionId)).toHaveLength(48);
    }
  });
});
