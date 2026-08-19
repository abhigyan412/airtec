import { api } from './api'

// ═══════════════════════════════════════════════════════════════
// Timetable module API client.
// ═══════════════════════════════════════════════════════════════
//
// Every route in the module answers with { success, data, error, code },
// so unwrapping happens once here rather than at ~40 call sites.

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get(`/timetable${path}`, { params })
  return res.data.data as T
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.post(`/timetable${path}`, body ?? {})
  return res.data.data as T
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.put(`/timetable${path}`, body ?? {})
  return res.data.data as T
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.patch(`/timetable${path}`, body ?? {})
  return res.data.data as T
}

async function del<T>(path: string): Promise<T> {
  const res = await api.delete(`/timetable${path}`)
  return res.data.data as T
}

/**
 * The message a server error actually carries.
 *
 * These endpoints answer refusals in plain language a school can act on
 * ("Krishna has reserved this period for copy correction") rather than a
 * status code, and axios buries that two levels down. Losing it to a
 * generic "Request failed" would waste the effort of writing them.
 */
export function timetableError(err: any): string {
  return err?.response?.data?.error
    ?? err?.message
    ?? 'Something went wrong. Please try again.'
}

export function timetableErrorCode(err: any): string | null {
  return err?.response?.data?.code ?? null
}

// ── types ───────────────────────────────────────────────────────

export interface PeriodAxis {
  periodNumber: number
  startTime: string
  endTime: string
  timeLabel: string
  isBreak: boolean
}

export interface Cell {
  id: string
  dayOfWeek: number
  periodNumber: number
  timeLabel: string
  subjectId: string | null
  subjectName: string
  teacherId: string | null
  teacherName: string | null
  roomName: string | null
  isBreak: boolean
  isLocked: boolean
  className?: string | null
  sectionName?: string | null
  covering?: {
    arrangementId: string
    substituteId: string | null
    substituteName: string | null
    absentName: string | null
    status: string
  } | null
}

export interface Arrangement {
  id: string
  arrangement_date: string
  period_number: number
  start_time: string | null
  end_time: string | null
  time_label: string
  status: 'unassigned' | 'assigned' | 'acknowledged' | 'declined' | 'cancelled' | 'unfilled'
  subject_name: string | null
  class_name: string | null
  section_name: string | null
  absent_teacher_id: string
  absent_teacher_name: string | null
  substitute_teacher_id: string | null
  substitute_teacher_name: string | null
  reason: string | null
  rank_score: number | null
  acknowledged_at: string | null
  declined_at: string | null
  decline_reason: string | null
  escalated_at: string | null
  reminder_sent_at: string | null
}

export interface Candidate {
  teacherId: string
  fullName: string
  score: number
  reasons: string[]
  warnings: string[]
  periodsToday: number
  arrangementsThisMonth: number
  freePeriodsToday: number
  hasBooking: boolean
  bookingPurpose: string | null
}

export interface ReadinessItem {
  key: string
  label: string
  done: boolean
  detail: string
  why: string
  blocking: boolean
}

export interface TeacherWorkload {
  teacherId: string
  name: string
  perDay: number[]
  totalPerWeek: number
  maxPerDay: number
  maxConsecutive: number
  freePeriodsPerWeek: number
  daysWithNoFreePeriod: number
  arrangementsThisMonth: number
  subjectCount: number
  limits: { maxPerDay: number; maxPerWeek: number; minPerWeek: number; maxConsecutive: number; exempt: boolean }
  breaches: { code: string; severity: 'block' | 'warn'; message: string }[]
  utilization: number
}

// ── setup ───────────────────────────────────────────────────────

export const timetableApi = {
  readiness: () => get<{ items: ReadinessItem[]; ready: boolean; complete: boolean; percent: number }>('/setup/readiness'),

  settings: () => get<any>('/setup/settings'),
  saveSettings: (body: any) => put<any>('/setup/settings', body),

  dayTemplates: () => get<any[]>('/setup/day-templates'),
  saveDayTemplate: (body: any) => post<{ id: string }>('/setup/day-templates', body),
  deleteDayTemplate: (id: string) => del<{ ok: true }>(`/setup/day-templates/${id}`),

  teacherSetup: () => get<{ subjects: any[]; teachers: any[] }>('/setup/teachers'),
  saveCapabilities: (teacherId: string, capabilities: any[]) =>
    put<any>(`/setup/teachers/${teacherId}/capabilities`, { capabilities }),
  saveConstraints: (teacherId: string, body: any) =>
    put<any>(`/setup/teachers/${teacherId}/constraints`, body),

  rooms: () => get<any[]>('/setup/rooms'),
  saveRoom: (body: any) => post<{ id: string }>('/setup/rooms', body),

  subjects: () => get<any[]>('/setup/subjects'),
  saveSubjectScheduling: (id: string, body: any) => patch<any>(`/setup/subjects/${id}`, body),

  classPlan: (classId: string) => get<any>(`/setup/plan/${classId}`),
  saveClassPlan: (classId: string, items: any[]) => put<any>(`/setup/plan/${classId}`, { items }),

  // ── import ────────────────────────────────────────────────────
  importPreview: (file: string, filename?: string) => post<any>('/import/preview', { file, filename }),
  importCommit: (body: any) => post<any>('/import/commit', body),

  // ── views ─────────────────────────────────────────────────────
  sectionView: (sectionId: string, date?: string) =>
    get<{ sectionId: string; className: string | null; sectionName: string | null; periods: PeriodAxis[]; cells: Cell[] }>(
      `/views/section/${sectionId}`, date ? { date } : undefined),
  teacherViewFor: (teacherId: string, date?: string) =>
    get<{ teacherId: string; periods: PeriodAxis[]; cells: Cell[]; load: any }>(
      `/views/teacher/${teacherId}`, date ? { date } : undefined),
  myWeek: () => get<any>('/my-week'),
  master: (day: number, date?: string) =>
    get<any>('/views/master', { day, ...(date ? { date } : {}) }),
  /** Every section's week, from the live timetable or a draft. */
  block: (versionId?: string | null) =>
    get<any>('/views/block', versionId ? { versionId } : undefined),
  cloneActive: (label?: string) =>
    post<any>('/versions/clone-active', label ? { label } : {}),
  updateDraftCell: (versionId: string, cellId: string, body: { teacherId?: string | null; roomId?: string | null; subjectId?: string | null }) =>
    patch<any>(`/draft/${versionId}/cells/${cellId}`, body),
  moveDraftCell: (versionId: string, cellId: string, target: { day: number; periodNumber: number }) =>
    post<any>(`/draft/${versionId}/cells/${cellId}/move`, target),
  freeTeachers: (day: number, date?: string) =>
    get<any>('/views/free-teachers', { day, ...(date ? { date } : {}) }),

  // ── absences ──────────────────────────────────────────────────
  absences: (date: string) => get<any[]>('/absences', { date }),
  createAbsence: (body: any) => post<any>('/absences', body),
  cancelPreview: (id: string) => get<any>(`/absences/${id}/cancel-preview`),
  cancelAbsence: (id: string, reason: string, keepArrangementIds?: string[]) =>
    post<any>(`/absences/${id}/cancel`, { reason, keepArrangementIds }),
  syncLeave: (date: string) => post<any>('/absences/sync-leave', { date }),
  detectAbsences: (date: string) => post<any>('/absences/detect', { date }),
  longAbsences: (from?: string) => get<any[]>('/absences/long', from ? { from } : undefined),
  reportEarlyLeave: (fromPeriod: number, reason: string) =>
    post<any>('/my/early-leave', { fromPeriod, reason }),

  // ── arrangements ──────────────────────────────────────────────
  arrangements: (date: string) => get<Arrangement[]>('/arrangements', { date }),
  candidates: (id: string, all = false) =>
    get<Candidate[]>(`/arrangements/${id}/candidates`, all ? { all: 'true' } : undefined),
  assign: (id: string, substituteTeacherId: string, overrideReason?: string) =>
    post<any>(`/arrangements/${id}/assign`, { substituteTeacherId, overrideReason }),
  unassign: (id: string) => post<any>(`/arrangements/${id}/unassign`),
  cancelArrangement: (id: string, reason: string) => post<any>(`/arrangements/${id}/cancel`, { reason }),
  acknowledge: (id: string) => post<any>(`/arrangements/${id}/acknowledge`),
  decline: (id: string, reason: string) => post<any>(`/arrangements/${id}/decline`, { reason }),
  register: (from: string, to: string) => get<any[]>('/arrangements/register', { from, to }),
  fairness: (month: string) => get<any>('/arrangements/stats', { month }),

  // ── bookings ──────────────────────────────────────────────────
  bookable: (from: string, to: string) => get<any>('/my/bookable', { from, to }),
  book: (body: any) => post<any>('/my/bookings', body),
  releaseBooking: (id: string) => del<any>(`/my/bookings/${id}`),
  allBookings: (from: string, to: string) => get<any[]>('/bookings', { from, to }),

  // ── workload ──────────────────────────────────────────────────
  workload: (month?: string) => get<any>('/workload', month ? { month } : undefined),
  redistribute: (teacherId: string) => get<any[]>(`/workload/${teacherId}/redistribute`),
  reassign: (periodId: string, teacherId: string) =>
    post<any>('/workload/reassign', { periodId, teacherId }),

  // ── generation ────────────────────────────────────────────────
  feasibility: () => get<any>('/generate/feasibility'),
  generate: (body: any) => post<any>('/generate', body),
  versions: () => get<any[]>('/versions'),
  versionGrid: (id: string, sectionId?: string) =>
    get<any[]>(`/versions/${id}/grid`, sectionId ? { sectionId } : undefined),
  publish: (id: string) => post<any>(`/versions/${id}/publish`),
  rollback: (id: string) => post<any>(`/versions/${id}/rollback`),
  discardDraft: (id: string) => del<any>(`/versions/${id}`),
  conflicts: () => get<any>('/conflicts'),
  validateMove: (body: any) => post<any>('/validate-move', body),

  // ── sweeps ────────────────────────────────────────────────────
  runAckSweep: () => post<any>('/sweeps/acknowledgements'),
  runUnfilledSweep: () => post<any>('/sweeps/unfilled'),
}

// ── shared display helpers ──────────────────────────────────────

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDaysISO(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Monday = 1 .. Saturday = 6, Sunday = 7. */
export function dayOfWeekFor(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const js = new Date(y, m - 1, d).getDay()
  return js === 0 ? 7 : js
}

export function prettyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

const RELATIVE: Record<number, string> = { 0: 'Today', 1: 'Tomorrow', [-1]: 'Yesterday' }

export function relativeDate(dateStr: string): string | null {
  const today = todayISO()
  for (const delta of [-1, 0, 1]) {
    if (addDaysISO(today, delta) === dateStr) return RELATIVE[delta]
  }
  return null
}
