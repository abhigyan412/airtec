// Conflict detection (timetable.md §6) + safe-swap suggestions (§5.4) — pure, no I/O.

import type {
  ConflictCode,
  EngineConflict,
  EngineEntry,
  EngineInput,
  EnginePlacementPrefs,
  EngineTeacher,
  SwapSuggestion,
} from "./types";
import { CONFLICT_SEVERITY } from "./types";
import { defaultTeacher } from "./feasibility";

type Cell = { sectionId?: string; teacherUserId?: string; day: number; periodNumber: number };

function conflict(code: ConflictCode, message: string, cells: Cell[]): EngineConflict {
  return { code, severity: CONFLICT_SEVERITY[code], message, cells };
}

function entryCell(e: EngineEntry): Cell {
  return {
    sectionId: e.sectionId,
    teacherUserId: e.teacherUserId,
    day: e.day,
    periodNumber: e.periodNumber,
  };
}

const key2 = (a: number, b: number): string => `${a}|${b}`;

export function detectConflicts(entries: EngineEntry[], input: EngineInput): EngineConflict[] {
  const conflicts: EngineConflict[] = [];
  const teachers = new Map(input.teachers.map((t) => [t.teacherUserId, t]));
  const getTeacher = (id: string): EngineTeacher => teachers.get(id) ?? defaultTeacher(id, input);
  const roomCapacity = new Map(input.rooms.map((r) => [r.roomId, r.capacityGroups]));

  const bySectionSlot = new Map<string, Map<string, EngineEntry[]>>();
  const byTeacherSlot = new Map<string, Map<string, EngineEntry[]>>();
  const byRoomSlot = new Map<string, Map<string, EngineEntry[]>>();
  const push = <K>(
    outer: Map<K, Map<string, EngineEntry[]>>,
    k: K,
    slot: string,
    e: EngineEntry,
  ): void => {
    const inner = outer.get(k) ?? new Map<string, EngineEntry[]>();
    const list = inner.get(slot) ?? [];
    list.push(e);
    inner.set(slot, list);
    outer.set(k, inner);
  };
  for (const e of entries) {
    const slot = key2(e.day, e.periodNumber);
    push(bySectionSlot, e.sectionId, slot, e);
    push(byTeacherSlot, e.teacherUserId, slot, e);
    if (e.roomId) push(byRoomSlot, e.roomId, slot, e);
  }

  // 1. TEACHER_DOUBLE_BOOKED
  for (const [teacherUserId, slots] of byTeacherSlot) {
    for (const [, list] of slots) {
      if (list.length < 2) continue;
      const first = list[0];
      if (!first) continue;
      conflicts.push(
        conflict(
          "TEACHER_DOUBLE_BOOKED",
          `Teacher ${teacherUserId} is booked in ${list.length} sections on day ${first.day} period ${first.periodNumber} (${list.map((e) => e.sectionId).join(", ")})`,
          list.map(entryCell),
        ),
      );
    }
  }

  // 2. SECTION_SLOT_CONFLICT (double-filled slot)
  for (const [sectionId, slots] of bySectionSlot) {
    for (const [, list] of slots) {
      if (list.length < 2) continue;
      const first = list[0];
      if (!first) continue;
      conflicts.push(
        conflict(
          "SECTION_SLOT_CONFLICT",
          `Section ${sectionId} has ${list.length} lessons in the same slot on day ${first.day} period ${first.periodNumber}`,
          list.map(entryCell),
        ),
      );
    }
  }

  // 3. ROOM_OVERBOOKED
  for (const [roomId, slots] of byRoomSlot) {
    const capacity = roomCapacity.get(roomId) ?? 1;
    for (const [, list] of slots) {
      if (list.length <= capacity) continue;
      const first = list[0];
      if (!first) continue;
      conflicts.push(
        conflict(
          "ROOM_OVERBOOKED",
          `Room ${roomId} hosts ${list.length} groups on day ${first.day} period ${first.periodNumber} but its capacity is ${capacity}`,
          list.map(entryCell),
        ),
      );
    }
  }

  // 4/5. QUOTA_UNMET / QUOTA_EXCEEDED — compare against demanded periods only.
  for (const section of input.sections) {
    const sectionEntries = entries.filter((e) => e.sectionId === section.sectionId);
    const counts = new Map<string, number>();
    for (const e of sectionEntries) counts.set(e.subjectId, (counts.get(e.subjectId) ?? 0) + 1);
    const occupied = new Set(sectionEntries.map((e) => key2(e.day, e.periodNumber)));
    const emptyCells: Cell[] = [];
    for (const day of input.days) {
      for (let p = 1; p <= input.periodsPerDay; p++) {
        if (!occupied.has(key2(day, p)))
          emptyCells.push({ sectionId: section.sectionId, day, periodNumber: p });
      }
    }
    const demanded = new Map<string, number>();
    for (const d of section.demands)
      demanded.set(d.subjectId, (demanded.get(d.subjectId) ?? 0) + d.periodsPerWeek);
    for (const [subjectId, quota] of demanded) {
      const actual = counts.get(subjectId) ?? 0;
      if (actual < quota) {
        conflicts.push(
          conflict(
            "QUOTA_UNMET",
            `Section ${section.sectionId}: subject ${subjectId} has ${actual}/${quota} periods placed`,
            emptyCells.slice(0, Math.max(1, quota - actual)),
          ),
        );
      } else if (actual > quota) {
        conflicts.push(
          conflict(
            "QUOTA_EXCEEDED",
            `Section ${section.sectionId}: subject ${subjectId} has ${actual} periods placed but the weekly quota is ${quota}`,
            sectionEntries.filter((e) => e.subjectId === subjectId).map(entryCell),
          ),
        );
      }
    }
    for (const [subjectId, actual] of counts) {
      if (demanded.has(subjectId)) continue;
      conflicts.push(
        conflict(
          "QUOTA_EXCEEDED",
          `Section ${section.sectionId}: subject ${subjectId} has ${actual} period(s) placed but is not in the section's subject plan`,
          sectionEntries.filter((e) => e.subjectId === subjectId).map(entryCell),
        ),
      );
    }
  }

  // 6-8, 10-11, 14. Teacher-level checks.
  for (const [teacherUserId, slots] of byTeacherSlot) {
    const teacher = getTeacher(teacherUserId);
    const blocked = new Set(teacher.blocked.map((b) => key2(b.day, b.periodNumber)));
    const byDay = new Map<number, EngineEntry[]>();
    let weekTotal = 0;
    for (const [, list] of slots) {
      for (const e of list) {
        weekTotal += 1;
        const dayList = byDay.get(e.day) ?? [];
        dayList.push(e);
        byDay.set(e.day, dayList);
        if (blocked.has(key2(e.day, e.periodNumber))) {
          conflicts.push(
            conflict(
              "BLOCKED_SLOT",
              `Teacher ${teacherUserId} is scheduled on day ${e.day} period ${e.periodNumber} which is outside their availability`,
              [entryCell(e)],
            ),
          );
        }
      }
    }
    if (weekTotal > teacher.maxPerWeek) {
      const all = [...byDay.values()].flat();
      conflicts.push(
        conflict(
          "TEACHER_MAX_PER_WEEK",
          `Teacher ${teacherUserId} has ${weekTotal} periods/week (max ${teacher.maxPerWeek})`,
          all.map(entryCell),
        ),
      );
    }
    if (weekTotal < (teacher.minPerWeek ?? 0)) {
      const all = [...byDay.values()].flat();
      conflicts.push(
        conflict(
          "UNDER_MIN_LOAD",
          `Teacher ${teacherUserId} has ${weekTotal} periods/week, under their minimum of ${teacher.minPerWeek}`,
          all.map(entryCell),
        ),
      );
    }
    for (const [day, dayEntries] of byDay) {
      if (dayEntries.length > teacher.maxPerDay) {
        conflicts.push(
          conflict(
            "TEACHER_MAX_PER_DAY",
            `Teacher ${teacherUserId} has ${dayEntries.length} periods on day ${day} (max ${teacher.maxPerDay})`,
            dayEntries.map(entryCell),
          ),
        );
      }
      if (dayEntries.length >= input.periodsPerDay) {
        conflicts.push(
          conflict(
            "NO_FREE_PERIOD_DAY",
            `Teacher ${teacherUserId} has no free period on day ${day}`,
            dayEntries.map(entryCell),
          ),
        );
      }
      // CONSECUTIVE_OVERRUN: runs longer than maxConsecutive.
      const periods = dayEntries.map((e) => e.periodNumber).sort((a, b) => a - b);
      let runStart = 0;
      for (let i = 1; i <= periods.length; i++) {
        const prev = periods[i - 1];
        if (i < periods.length && prev !== undefined && periods[i] === prev + 1) continue;
        const runLen = i - runStart;
        if (runLen > teacher.maxConsecutive) {
          const runPeriods = periods.slice(runStart, i);
          conflicts.push(
            conflict(
              "CONSECUTIVE_OVERRUN",
              `Teacher ${teacherUserId} has ${runLen} consecutive periods on day ${day} (P${runPeriods[0]}–P${runPeriods[runLen - 1]}), preferred max ${teacher.maxConsecutive}`,
              dayEntries.filter((e) => runPeriods.includes(e.periodNumber)).map(entryCell),
            ),
          );
        }
        runStart = i;
      }
    }
  }

  // UNDER_MIN_LOAD must also fire for teachers with ZERO placements (audit
  // item 30a): they never appear in byTeacherSlot, so sweep input.teachers.
  // cells is legitimately empty — there is no placed period to point at.
  for (const t of input.teachers) {
    if ((t.minPerWeek ?? 0) <= 0) continue;
    if (byTeacherSlot.has(t.teacherUserId)) continue;
    conflicts.push(
      conflict(
        "UNDER_MIN_LOAD",
        `Teacher ${t.teacherUserId} has 0 periods/week, under their minimum of ${t.minPerWeek}`,
        [],
      ),
    );
  }

  // 9. DOUBLE_SPANS_BREAK — double parts must pair up adjacently within a segment.
  for (const [sectionId, slots] of bySectionSlot) {
    const doubleParts = new Map<string, EngineEntry[]>(); // day|subject|teacher → parts
    for (const [, list] of slots) {
      for (const e of list) {
        if (!e.isDoublePart) continue;
        const k = `${e.day}|${e.subjectId}|${e.teacherUserId}`;
        const parts = doubleParts.get(k) ?? [];
        parts.push(e);
        doubleParts.set(k, parts);
      }
    }
    for (const [, parts] of doubleParts) {
      parts.sort((a, b) => a.periodNumber - b.periodNumber);
      let i = 0;
      while (i < parts.length) {
        const a = parts[i];
        const b = parts[i + 1];
        if (a && b && b.periodNumber === a.periodNumber + 1) {
          if (input.breakAfter.includes(a.periodNumber)) {
            conflicts.push(
              conflict(
                "DOUBLE_SPANS_BREAK",
                `Section ${sectionId}: double period for subject ${a.subjectId} spans the break after period ${a.periodNumber} on day ${a.day}`,
                [entryCell(a), entryCell(b)],
              ),
            );
          }
          i += 2;
        } else if (a) {
          conflicts.push(
            conflict(
              "DOUBLE_SPANS_BREAK",
              `Section ${sectionId}: double-period part for subject ${a.subjectId} on day ${a.day} period ${a.periodNumber} has no adjacent partner`,
              [entryCell(a)],
            ),
          );
          i += 1;
        } else {
          i += 1;
        }
      }
    }
  }

  // 12/13. Section-subject daily patterns.
  const placementBySectionSubject = new Map<string, EnginePlacementPrefs | null>();
  const quotaBySectionSubject = new Map<string, number>();
  for (const section of input.sections) {
    for (const d of section.demands) {
      placementBySectionSubject.set(`${section.sectionId}|${d.subjectId}`, d.placement ?? null);
      quotaBySectionSubject.set(
        `${section.sectionId}|${d.subjectId}`,
        (quotaBySectionSubject.get(`${section.sectionId}|${d.subjectId}`) ?? 0) + d.periodsPerWeek,
      );
    }
  }
  // A subject whose weekly quota exceeds the number of school days MUST repeat
  // on some days — that is arithmetic, not a scheduling defect. Only flag
  // repeats beyond the unavoidable ceil(quota / days) per day.
  const allowedPerDay = (sectionId: string, subjectId: string): number => {
    const quota = quotaBySectionSubject.get(`${sectionId}|${subjectId}`);
    if (quota === undefined) return 1;
    return Math.max(1, Math.ceil(quota / Math.max(1, input.days.length)));
  };
  for (const [sectionId, slots] of bySectionSlot) {
    const perSubjectDay = new Map<string, EngineEntry[]>();
    const perSubjectLast = new Map<string, EngineEntry[]>();
    for (const [, list] of slots) {
      for (const e of list) {
        const k = `${e.subjectId}|${e.day}`;
        const dayList = perSubjectDay.get(k) ?? [];
        dayList.push(e);
        perSubjectDay.set(k, dayList);
        if (e.periodNumber === input.periodsPerDay) {
          const lastList = perSubjectLast.get(e.subjectId) ?? [];
          lastList.push(e);
          perSubjectLast.set(e.subjectId, lastList);
        }
      }
    }
    for (const [k, list] of perSubjectDay) {
      const doubleCount = list.filter((e) => e.isDoublePart).length;
      const occurrences = list.length - doubleCount + Math.ceil(doubleCount / 2);
      const [subjectId, day] = k.split("|");
      const allowed = allowedPerDay(sectionId, subjectId ?? "");
      if (occurrences > allowed) {
        conflicts.push(
          conflict(
            "SUBJECT_TWICE_A_DAY",
            `Section ${sectionId}: subject ${subjectId} appears ${occurrences} times on day ${day} — more than the ${allowed}/day its weekly quota requires`,
            list.map(entryCell),
          ),
        );
      }
      // 16. SUBJECT_GAP_DAY — same-day repeats must be back-to-back: one
      // contiguous run with no break inside (a de-facto double period).
      if (list.length >= 2) {
        const periods = list.map((e) => e.periodNumber).sort((a, b) => a - b);
        let split = false;
        for (let i = 1; i < periods.length; i++) {
          const prev = periods[i - 1]!;
          if (periods[i]! !== prev + 1 || input.breakAfter.includes(prev)) {
            split = true;
            break;
          }
        }
        if (split) {
          conflicts.push(
            conflict(
              "SUBJECT_GAP_DAY",
              `Section ${sectionId}: subject ${subjectId} sits at periods ${periods.join(", ")} on day ${day} — same-day periods must be back-to-back with no gap or break between`,
              list.map(entryCell),
            ),
          );
        }
      }
    }
    for (const [subjectId, list] of perSubjectLast) {
      const prefs = placementBySectionSubject.get(`${sectionId}|${subjectId}`);
      if (!prefs?.preferMorning || list.length < 2) continue;
      conflicts.push(
        conflict(
          "HEAVY_LAST_PERIOD",
          `Section ${sectionId}: heavy subject ${subjectId} sits in the last period on ${list.length} days`,
          list.map(entryCell),
        ),
      );
    }
  }

  // 15. CLASS_TEACHER_NOT_P1 — expectation-aware: the class teacher can only
  // open as many days as their own weekly quota in this section allows. Only
  // report when they take FEWER first periods than that.
  for (const section of input.sections) {
    if (!section.classTeacherUserId) continue;
    const ctDemand = section.demands
      .filter((d) => d.teacherUserId === section.classTeacherUserId)
      .reduce((sum, d) => sum + d.periodsPerWeek, 0);
    const expected = Math.min(input.days.length, ctDemand);
    if (expected === 0) continue; // class teacher teaches nothing here — nothing to expect
    const slots = bySectionSlot.get(section.sectionId);
    let ctP1Days = 0;
    const offending: Cell[] = [];
    for (const day of input.days) {
      const p1 = slots?.get(key2(day, 1))?.[0];
      if (p1 && p1.teacherUserId === section.classTeacherUserId) ctP1Days += 1;
      else if (p1) offending.push(entryCell(p1));
    }
    // Only a class teacher who NEVER opens their own section is worth a note —
    // partial coverage is normal (their quota competes with every other rule).
    if (ctP1Days === 0) {
      conflicts.push(
        conflict(
          "CLASS_TEACHER_NOT_P1",
          `Section ${section.sectionId}: class teacher ${section.classTeacherUserId} never takes period 1 (teaches ${ctDemand} period(s)/week here)`,
          offending.slice(0, Math.min(offending.length, expected)),
        ),
      );
    }
  }

  return conflicts;
}

/**
 * For a target cell, suggest swaps with other cells of the SAME section (different
 * day/period) that leave the timetable with zero block-severity conflicts.
 */
export function suggestSwaps(
  entries: EngineEntry[],
  input: EngineInput,
  move: { sectionId: string; day: number; periodNumber: number },
): SwapSuggestion[] {
  const suggestions: SwapSuggestion[] = [];
  const at = (day: number, periodNumber: number): EngineEntry | undefined =>
    entries.find(
      (e) => e.sectionId === move.sectionId && e.day === day && e.periodNumber === periodNumber,
    );
  const source = at(move.day, move.periodNumber);
  if (source?.isLocked || source?.isDoublePart) return [];

  for (const day of input.days) {
    for (let p = 1; p <= input.periodsPerDay; p++) {
      if (suggestions.length >= 5) return suggestions;
      if (day === move.day && p === move.periodNumber) continue;
      const target = at(day, p);
      if (!source && !target) continue;
      if (target?.isLocked || target?.isDoublePart) continue;

      const swapped = entries
        .filter((e) => e !== source && e !== target)
        .concat(
          source ? [{ ...source, day, periodNumber: p }] : [],
          target ? [{ ...target, day: move.day, periodNumber: move.periodNumber }] : [],
        );
      const hasBlock = detectConflicts(swapped, input).some((c) => c.severity === "block");
      if (hasBlock) continue;

      const describe = (e: EngineEntry | undefined): string =>
        e ? `${e.subjectId} (${e.teacherUserId})` : "free slot";
      suggestions.push({
        description: `Swap day ${move.day} P${move.periodNumber} [${describe(source)}] with day ${day} P${p} [${describe(target)}] — no conflicts`,
        swapWith: { day, periodNumber: p },
      });
    }
  }
  return suggestions;
}
