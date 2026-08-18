// Feasibility pre-check — pure capacity math, no placement (timetable.md §5.3 step 1).

import type { EngineInput, EngineTeacher, FeasibilityIssue, FeasibilityReport } from "./types";

/** Contiguous runs of teaching periods (breaks split runs). E.g. P=8, breakAfter=[3,6] → [[1,2,3],[4,5,6],[7,8]]. */
export function teachingSegments(periodsPerDay: number, breakAfter: number[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let p = 1; p <= periodsPerDay; p++) {
    current.push(p);
    if (breakAfter.includes(p) && p < periodsPerDay) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Max non-overlapping adjacent pairs (double periods) that fit in one day. */
export function maxDoublesPerDay(periodsPerDay: number, breakAfter: number[]): number {
  return teachingSegments(periodsPerDay, breakAfter).reduce(
    (sum, seg) => sum + Math.floor(seg.length / 2),
    0,
  );
}

/** Fallback limits for a teacher referenced in demands but absent from input.teachers. */
export function defaultTeacher(teacherUserId: string, input: EngineInput): EngineTeacher {
  return {
    teacherUserId,
    maxPerDay: input.periodsPerDay,
    maxPerWeek: input.days.length * input.periodsPerDay,
    maxConsecutive: 3,
    blocked: [],
  };
}

/** Periods a teacher can actually teach per week, accounting for maxPerDay/maxPerWeek and blocked slots. */
function teacherWeeklyCapacity(
  teacher: EngineTeacher,
  input: EngineInput,
  ignoreBlocked: boolean,
): number {
  let total = 0;
  for (const day of input.days) {
    const blockedToday = ignoreBlocked
      ? 0
      : teacher.blocked.filter(
          (b) => b.day === day && b.periodNumber >= 1 && b.periodNumber <= input.periodsPerDay,
        ).length;
    total += Math.min(teacher.maxPerDay, input.periodsPerDay - blockedToday);
  }
  return Math.min(teacher.maxPerWeek, total);
}

export function checkFeasibility(input: EngineInput): FeasibilityReport {
  const issues: FeasibilityIssue[] = [];
  const teachers = new Map(input.teachers.map((t) => [t.teacherUserId, t]));
  const slotsPerWeek = input.days.length * input.periodsPerDay;
  const doublesPerDay = maxDoublesPerDay(input.periodsPerDay, input.breakAfter);

  // Occupancy already committed in OTHER sections' active timetables: it
  // consumes teacher and typed-room capacity before this generation starts.
  const externalTeacherLoad = new Map<string, number>();
  const externalRoomLoad = new Map<string, number>();
  const roomTypeById = new Map(input.rooms.map((r) => [r.roomId, r.roomType]));
  for (const e of input.external ?? []) {
    externalTeacherLoad.set(e.teacherUserId, (externalTeacherLoad.get(e.teacherUserId) ?? 0) + 1);
    const type = e.roomId ? roomTypeById.get(e.roomId) : undefined;
    if (type) externalRoomLoad.set(type, (externalRoomLoad.get(type) ?? 0) + 1);
  }

  const subjectDemand: Record<string, number> = {};
  const subjectTeachers = new Map<string, Set<string>>();
  const teacherDemand = new Map<string, number>();
  const roomTypeDemand = new Map<string, number>();

  for (const section of input.sections) {
    let sectionTotal = 0;
    let sectionDoubles = 0;
    for (const demand of section.demands) {
      sectionTotal += demand.periodsPerWeek;
      sectionDoubles += demand.doublePeriods;
      subjectDemand[demand.subjectId] =
        (subjectDemand[demand.subjectId] ?? 0) + demand.periodsPerWeek;
      teacherDemand.set(
        demand.teacherUserId,
        (teacherDemand.get(demand.teacherUserId) ?? 0) + demand.periodsPerWeek,
      );
      const mapped = subjectTeachers.get(demand.subjectId) ?? new Set<string>();
      mapped.add(demand.teacherUserId);
      subjectTeachers.set(demand.subjectId, mapped);
      if (demand.roomType) {
        roomTypeDemand.set(
          demand.roomType,
          (roomTypeDemand.get(demand.roomType) ?? 0) + demand.periodsPerWeek,
        );
      }
      if (demand.doublePeriods * 2 > demand.periodsPerWeek) {
        issues.push({
          code: "INVALID_DEMAND",
          message: `Section ${section.sectionId}: subject ${demand.subjectId} asks for ${demand.doublePeriods} double(s) (${demand.doublePeriods * 2} periods) but only ${demand.periodsPerWeek} periods/week are allotted`,
          detail: { sectionId: section.sectionId, subjectId: demand.subjectId },
        });
      }
    }
    if (sectionTotal > slotsPerWeek) {
      issues.push({
        code: "SECTION_QUOTA_OVERFLOW",
        message: `Section ${section.sectionId} needs ${sectionTotal} periods/week but only ${slotsPerWeek} slots exist (${input.days.length} days × ${input.periodsPerDay} periods)`,
        detail: { sectionId: section.sectionId, demand: sectionTotal, capacity: slotsPerWeek },
      });
    }
    if (sectionDoubles > 0 && doublesPerDay === 0) {
      issues.push({
        code: "DOUBLES_DONT_FIT",
        message: `Section ${section.sectionId} needs ${sectionDoubles} double period(s)/week but no adjacent non-break period pair exists in the day template`,
        detail: { sectionId: section.sectionId },
      });
    } else if (sectionDoubles > input.days.length * doublesPerDay) {
      issues.push({
        code: "DOUBLES_DONT_FIT",
        message: `Section ${section.sectionId} needs ${sectionDoubles} double period(s)/week but at most ${input.days.length * doublesPerDay} fit (${doublesPerDay} adjacent pair(s)/day × ${input.days.length} days)`,
        detail: {
          sectionId: section.sectionId,
          demand: sectionDoubles,
          capacity: input.days.length * doublesPerDay,
        },
      });
    }
  }

  // Per-teacher: mapped demand vs what they can actually supply (minus the
  // load they already carry in other sections' active timetables).
  for (const [teacherUserId, demand] of teacherDemand) {
    const teacher = teachers.get(teacherUserId) ?? defaultTeacher(teacherUserId, input);
    const already = externalTeacherLoad.get(teacherUserId) ?? 0;
    const capacity = teacherWeeklyCapacity(teacher, input, false) - already;
    if (demand <= capacity) continue;
    const capacityIgnoringBlocked = teacherWeeklyCapacity(teacher, input, true) - already;
    if (demand <= capacityIgnoringBlocked) {
      issues.push({
        code: "TEACHER_BLOCKED_OVERCONSTRAINED",
        message: `Teacher ${teacherUserId} is mapped to ${demand} periods/week but blocked slots leave only ${capacity} available (${capacityIgnoringBlocked} before blocking)`,
        detail: { teacherUserId, demand, capacity, capacityIgnoringBlocked },
      });
    } else {
      issues.push({
        code: "TEACHER_OVERLOADED",
        message: `Teacher ${teacherUserId} is mapped to ${demand} periods/week but can teach at most ${capacity} (maxPerWeek ${teacher.maxPerWeek}, maxPerDay ${teacher.maxPerDay} over ${input.days.length} days)`,
        detail: { teacherUserId, demand, capacity },
      });
    }
  }

  // Per-subject: total demand vs the combined capacity of its mapped teachers.
  const subjectCapacity: Record<string, number> = {};
  for (const [subjectId, demand] of Object.entries(subjectDemand)) {
    let capacity = 0;
    for (const teacherUserId of subjectTeachers.get(subjectId) ?? []) {
      const teacher = teachers.get(teacherUserId) ?? defaultTeacher(teacherUserId, input);
      capacity +=
        teacherWeeklyCapacity(teacher, input, false) -
        (externalTeacherLoad.get(teacherUserId) ?? 0);
    }
    subjectCapacity[subjectId] = capacity;
    if (demand > capacity) {
      issues.push({
        code: "SUBJECT_CAPACITY_SHORT",
        message: `Subject ${subjectId} needs ${demand} periods/week but mapped teachers can supply ${capacity}`,
        detail: { subjectId, demand, capacity },
      });
    }
  }

  // Room-type capacity: weekly demand vs rooms × capacityGroups × slots.
  // Room shortfalls are WARN, not blocks (audit item 10c): generation treats
  // typed rooms as best-effort — a demand with no free room falls back to the
  // section's own classroom and reports ROOM_FALLBACK — so feasibility must
  // not hard-fail on the same condition it would happily generate through.
  for (const [roomType, demand] of roomTypeDemand) {
    const rooms = input.rooms.filter((r) => r.roomType === roomType);
    if (rooms.length === 0) {
      issues.push({
        code: "ROOM_TYPE_MISSING",
        message: `Subjects need a "${roomType}" room ${demand} period(s)/week but no room of that type exists — those lessons will run in the sections' own classrooms`,
        detail: { roomType, demand },
        severity: "warn",
      });
      continue;
    }
    const capacity =
      rooms.reduce((sum, r) => sum + r.capacityGroups, 0) * slotsPerWeek -
      (externalRoomLoad.get(roomType) ?? 0);
    if (demand > capacity) {
      issues.push({
        code: "ROOM_TYPE_SHORT",
        message: `Room type "${roomType}" is demanded ${demand} period(s)/week but capacity is ${capacity} (${rooms.length} room(s) × groups × ${slotsPerWeek} slots)`,
        detail: { roomType, demand, capacity },
        severity: "warn",
      });
    }
  }

  // Warn-severity issues are advisory: only block-severity issues gate.
  return {
    feasible: !issues.some((i) => (i.severity ?? "block") === "block"),
    issues,
    stats: { subjectDemand, subjectCapacity },
  };
}
