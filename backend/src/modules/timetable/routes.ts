import { Router, Response } from 'express'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2, requireAnyPermissionV2, getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { toLocalDateStr } from '../../shared/utils/academicCalendar'
import { supabase } from '../../shared/db/client'
import { badRequest, conflict, dayOfWeekFor, getSettings, sendError, TimetableError } from './lib/core'

import { readWorkbook } from './import/xlsx'
import { parseTimetableWorkbook } from './import/parseWorkbook'
import { resolveImport } from './import/resolve'
import { commitImport } from './import/commit'

import * as config from './services/config'
import * as views from './services/views'
import * as absences from './services/absences'
import * as arrangements from './services/arrangements'
import * as bookings from './services/bookings'
import * as workload from './services/workload'
import * as generate from './services/generate'
import * as escalation from './services/escalation'

const router = Router()
router.use(authenticate)

// Everything in this module reports failures the same way, so the client
// can rely on { success, error, code } rather than guessing per route.
const handle = (fn: (req: AuthRequest, res: Response) => Promise<any>) =>
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const data = await fn(req, res)
      if (!res.headersSent) res.json({ success: true, data })
    } catch (err) {
      sendError(res, err)
    }
  })

const today = () => toLocalDateStr(new Date())

function requireDate(value: unknown, fallback?: string): string {
  const raw = typeof value === 'string' && value ? value : fallback
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest('bad_date', 'Give a date as YYYY-MM-DD.')
  }
  return raw
}

/**
 * Zod has validated this; hand it on with its real shape.
 *
 * This project compiles with `strict: false`, under which zod infers
 * every field of a parsed object as optional — `z.string()` becomes
 * `string | undefined`. That makes every `Schema.parse(body)` result
 * structurally incompatible with the service signature it is about to be
 * passed to, so the compiler would reject a value it has already checked
 * at runtime. Narrowing here keeps the assertion in one visible, greppable
 * place instead of scattering `as any` across two dozen route handlers.
 */
const validated = <T>(value: unknown): T => value as T

async function can(req: AuthRequest, code: string): Promise<boolean> {
  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, req.user!.school_id)
  return isSuperRole || permissionCodes.has(code)
}

// ═══════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════

// The setup checklist is an administrator's to-do list, not something a
// teacher needs; day templates below stay on timetable.view because every
// grid needs the period times to render.
router.get('/setup/readiness', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.setupReadiness(req.user!.school_id)))

router.get('/setup/settings', requirePermissionV2('timetable.view'),
  handle(async req => getSettings(req.user!.school_id)))

router.put('/setup/settings', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveSettings(req.user!.school_id, req.user!.id, req.body ?? {})))

router.get('/setup/day-templates', requirePermissionV2('timetable.view'),
  handle(async req => config.listDayTemplates(req.user!.school_id)))

const DayTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Give the day a name.'),
  templateType: z.enum(['regular', 'saturday', 'exam', 'activity', 'half_day']).optional(),
  periods: z.array(z.object({
    slotIndex: z.number().int().min(1),
    kind: z.enum(['period', 'assembly', 'break', 'lunch']),
    periodNumber: z.number().int().min(1).nullable(),
    startTime: z.string(),
    endTime: z.string(),
    label: z.string().nullable().optional(),
  })).min(1),
})

router.post('/setup/day-templates', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveDayTemplate(req.user!.school_id, req.user!.id,
    validated<Parameters<typeof config.saveDayTemplate>[2]>(DayTemplateSchema.parse(req.body)))))

router.delete('/setup/day-templates/:id', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.deleteDayTemplate(req.user!.school_id, req.user!.id, req.params.id)))

router.get('/setup/teachers', requirePermissionV2('timetable.view'),
  handle(async req => config.listTeacherSetup(req.user!.school_id)))

const CapabilitiesSchema = z.object({
  capabilities: z.array(z.object({
    subjectId: z.string().uuid(),
    priority: z.number().int().min(1).max(3),
    minClassLevel: z.number().int().nullable().optional(),
    maxClassLevel: z.number().int().nullable().optional(),
  })),
})

router.put('/setup/teachers/:teacherId/capabilities', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveCapabilities(
    req.user!.school_id, req.user!.id, req.params.teacherId,
    validated<Parameters<typeof config.saveCapabilities>[3]>(CapabilitiesSchema.parse(req.body).capabilities))))

router.put('/setup/teachers/:teacherId/constraints', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveConstraints(
    req.user!.school_id, req.user!.id, req.params.teacherId, req.body ?? {})))

router.get('/setup/rooms', requirePermissionV2('timetable.view'),
  handle(async req => config.listRooms(req.user!.school_id)))

router.post('/setup/rooms', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveRoom(req.user!.school_id, req.user!.id, req.body ?? {})))

router.get('/setup/subjects', requirePermissionV2('timetable.view'),
  handle(async req => config.listSubjects(req.user!.school_id)))

router.patch('/setup/subjects/:id', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveSubjectScheduling(
    req.user!.school_id, req.user!.id, req.params.id, req.body ?? {})))

router.get('/setup/plan/:classId', requirePermissionV2('timetable.view'),
  handle(async req => config.getClassPlan(req.user!.school_id, req.params.classId)))

const PlanSchema = z.object({
  items: z.array(z.object({
    sectionId: z.string().uuid().nullable(),
    subjectId: z.string().uuid(),
    weeklyPeriods: z.number().int().min(0),
    doublePeriods: z.number().int().min(0).optional(),
    teacherId: z.string().uuid().nullable().optional(),
  })),
})

router.put('/setup/plan/:classId', requirePermissionV2('timetable.setup_manage'),
  handle(async req => config.saveClassPlan(
    req.user!.school_id, req.user!.id, req.params.classId,
    validated<Parameters<typeof config.saveClassPlan>[3]>(PlanSchema.parse(req.body).items))))

// ═══════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════

const ImportFileSchema = z.object({
  /** base64 of the .xlsx. Kept client-side between preview and commit so
   *  the server holds no half-finished import state. */
  file: z.string().min(1, 'Attach a spreadsheet.'),
  filename: z.string().optional(),
})

function decodeWorkbook(base64: string) {
  const cleaned = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const buffer = Buffer.from(cleaned, 'base64')
  if (!buffer.length) throw badRequest('empty_file', 'That file appears to be empty.')
  if (buffer.length > 15 * 1024 * 1024) {
    throw badRequest('file_too_large', 'Timetable spreadsheets are kilobytes. That file is over 15MB.')
  }
  try {
    return readWorkbook(buffer)
  } catch (err: any) {
    throw badRequest('unreadable_file', err?.message ?? 'Could not read that spreadsheet.')
  }
}

router.post('/import/preview', requirePermissionV2('timetable.import'),
  handle(async req => {
    const body = ImportFileSchema.parse(req.body)
    const parse = parseTimetableWorkbook(decodeWorkbook(body.file))
    const resolved = await resolveImport(req.user!.school_id, parse)
    return {
      filename: body.filename ?? null,
      stats: parse.stats,
      days: parse.days,
      sections: parse.sections,
      dayTemplates: parse.dayTemplates.map(t => ({
        name: t.name,
        sectionLabels: t.sectionLabels,
        teachingPeriods: t.periods.filter(p => p.kind === 'period').length,
        periods: t.periods,
      })),
      subjectGroups: parse.subjectGroups,
      teacherGroups: parse.teacherGroups,
      coTaught: parse.coTaught,
      plan: parse.plan,
      capabilities: parse.capabilities,
      constraints: parse.constraints,
      issues: parse.issues,
      resolved,
      blocked: parse.issues.some(i => i.severity === 'block'),
    }
  }))

const CommitSchema = ImportFileSchema.extend({
  subjects: z.array(z.object({
    canonical: z.string(),
    subjectId: z.string().uuid().nullable().optional(),
    renameTo: z.string().optional(),
    skip: z.boolean().optional(),
  })).default([]),
  teachers: z.array(z.object({
    canonical: z.string(),
    action: z.enum(['link', 'create', 'skip']),
    userId: z.string().uuid().nullable().optional(),
    fullName: z.string().optional(),
    email: z.string().email().optional(),
  })).default([]),
  sections: z.array(z.object({
    raw: z.string(),
    action: z.enum(['link', 'skip']),
    classId: z.string().uuid().nullable().optional(),
    sectionId: z.string().uuid().nullable().optional(),
  })).default([]),
  variantOverrides: z.record(z.string()).optional(),
  versionLabel: z.string().optional(),
  effectiveFrom: z.string().nullable().optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  applyPlan: z.boolean().optional(),
  applyCapabilities: z.boolean().optional(),
  applyConstraints: z.boolean().optional(),
  applyDayTemplates: z.boolean().optional(),
})

router.post('/import/commit', requirePermissionV2('timetable.import'),
  handle(async req => {
    const body = CommitSchema.parse(req.body)
    const parse = parseTimetableWorkbook(decodeWorkbook(body.file))
    if (parse.issues.some(i => i.severity === 'block')) {
      throw badRequest('import_blocked',
        'The spreadsheet has problems that must be fixed before it can be imported.',
        parse.issues.filter(i => i.severity === 'block'))
    }
    return commitImport(req.user!.school_id, req.user!.id, parse,
      validated<Parameters<typeof commitImport>[3]>(body))
  }))

// ═══════════════════════════════════════════════════════════════
// VIEWS
// ═══════════════════════════════════════════════════════════════

router.get('/views/section/:sectionId', requirePermissionV2('timetable.view'),
  handle(async req => views.sectionView(req.user!.school_id, req.params.sectionId, {
    date: typeof req.query.date === 'string' ? req.query.date : null,
  })))

router.get('/views/teacher/:teacherId', requirePermissionV2('timetable.view'),
  handle(async req => {
    // A teacher may always read their own week. Reading a colleague's is
    // a manager capability, checked here rather than left to the UI.
    if (req.params.teacherId !== req.user!.id && !(await can(req, 'timetable.manage'))) {
      throw new TimetableError(403, 'forbidden', 'You can only view your own timetable.')
    }
    return views.teacherView(req.user!.school_id, req.params.teacherId, {
      date: typeof req.query.date === 'string' ? req.query.date : null,
    })
  }))

/** The teacher's own view. No id in the URL, so nothing to tamper with. */
router.get('/my-week', handle(async req => views.myWeek(req.user!.school_id, req.user!.id)))

router.get('/views/master', requirePermissionV2('timetable.view'),
  handle(async req => {
    const day = Number(req.query.day ?? dayOfWeekFor(today()))
    if (!(day >= 1 && day <= 6)) throw badRequest('bad_day', 'Day must be 1 (Monday) to 6 (Saturday).')
    return views.masterGrid(req.user!.school_id, day, {
      date: typeof req.query.date === 'string' ? req.query.date : null,
    })
  }))

// Every section's week at once, from the live timetable or any draft.
// timetable.view rather than a manage permission: this is the sheet
// pinned up in the staffroom, and printing it is the point.
router.get('/views/block', requirePermissionV2('timetable.view'),
  handle(async req => views.blockGrid(req.user!.school_id, {
    versionId: typeof req.query.versionId === 'string' ? req.query.versionId : null,
  })))

router.get('/views/free-teachers', requireAnyPermissionV2('arrangement.view', 'timetable.manage'),
  handle(async req => {
    const date = typeof req.query.date === 'string' ? req.query.date : null
    const day = Number(req.query.day ?? (date ? dayOfWeekFor(date) : dayOfWeekFor(today())))
    if (!(day >= 1 && day <= 6)) throw badRequest('bad_day', 'Day must be 1 (Monday) to 6 (Saturday).')
    return views.freeTeacherMatrix(req.user!.school_id, day, date)
  }))

// ═══════════════════════════════════════════════════════════════
// ABSENCES
// ═══════════════════════════════════════════════════════════════

router.get('/absences', requirePermissionV2('arrangement.view'),
  handle(async req => absences.listAbsences(req.user!.school_id, requireDate(req.query.date, today()))))

const AbsenceSchema = z.object({
  teacherId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(['full_day', 'first_half', 'second_half', 'periods', 'early_leave', 'late_arrival']),
  periods: z.array(z.number().int().min(1)).optional(),
  fromPeriod: z.number().int().min(1).nullable().optional(),
  reason: z.string().nullable().optional(),
})

router.post('/absences', requirePermissionV2('arrangement.manage'),
  handle(async req => absences.createAbsence(req.user!.school_id, req.user!.id,
    validated<Parameters<typeof absences.createAbsence>[2]>(AbsenceSchema.parse(req.body)))))

// What standing this absence down would do, period by period, so the
// manager decides rather than being told a number afterwards.
router.get('/absences/:id/cancel-preview', requirePermissionV2('arrangement.manage'),
  handle(async req => absences.cancelPreview(req.user!.school_id, req.params.id)))

router.post('/absences/:id/cancel', requirePermissionV2('arrangement.manage'),
  handle(async req => absences.cancelAbsence(
    req.user!.school_id, req.user!.id, req.params.id,
    String(req.body?.reason ?? 'Teacher returned'),
    Array.isArray(req.body?.keepArrangementIds)
      ? req.body.keepArrangementIds.map(String)
      : undefined)))

router.post('/absences/sync-leave', requirePermissionV2('arrangement.manage'),
  handle(async req => absences.syncApprovedLeave(
    req.user!.school_id, req.user!.id, requireDate(req.body?.date, today()))))

router.post('/absences/detect', requirePermissionV2('arrangement.manage'),
  handle(async req => absences.detectAbsences(
    req.user!.school_id, req.user!.id, requireDate(req.body?.date, today()))))

router.get('/absences/long', requirePermissionV2('arrangement.view'),
  handle(async req => absences.longAbsences(
    req.user!.school_id, requireDate(req.query.from, addMonths(today(), -2)))))

/**
 * A teacher reporting their own early departure.
 *
 * The teacher id comes from the token and is never read from the body:
 * this endpoint is held by every teacher, and accepting a teacherId
 * would let any of them mark a colleague as leaving.
 */
router.post('/my/early-leave', requirePermissionV2('arrangement.acknowledge'),
  handle(async req => {
    const fromPeriod = Number(req.body?.fromPeriod)
    if (!Number.isInteger(fromPeriod) || fromPeriod < 1) {
      throw badRequest('bad_period', 'Say which period you are leaving from.')
    }
    return absences.reportEarlyLeave(
      req.user!.school_id, req.user!.id, fromPeriod, String(req.body?.reason ?? ''))
  }))

// ═══════════════════════════════════════════════════════════════
// ARRANGEMENTS
// ═══════════════════════════════════════════════════════════════

router.get('/arrangements', requirePermissionV2('arrangement.view'),
  handle(async req => arrangements.listArrangements(
    req.user!.school_id, requireDate(req.query.date, today()))))

router.get('/arrangements/register', requirePermissionV2('arrangement.view'),
  handle(async req => arrangements.register(
    req.user!.school_id,
    requireDate(req.query.from, addMonths(today(), -1)),
    requireDate(req.query.to, today()))))

router.get('/arrangements/stats', requirePermissionV2('arrangement.view'),
  handle(async req => {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month : today().slice(0, 7)
    return arrangements.fairnessStats(req.user!.school_id, month)
  }))

router.get('/arrangements/:id/candidates', requirePermissionV2('arrangement.manage'),
  handle(async req => arrangements.candidatesFor(req.user!.school_id, req.params.id, {
    includeIneligible: req.query.all === 'true',
    canOverrideBooking: await can(req, 'arrangement.override_booking'),
  })))

router.post('/arrangements/:id/assign', requirePermissionV2('arrangement.manage'),
  handle(async req => {
    const substituteId = String(req.body?.substituteTeacherId ?? '')
    if (!substituteId) throw badRequest('substitute_required', 'Choose who is covering.')
    return arrangements.assignSubstitute(
      req.user!.school_id, req.user!.id, req.params.id, substituteId,
      {
        canOverrideBooking: await can(req, 'arrangement.override_booking'),
        overrideReason: req.body?.overrideReason,
      })
  }))

router.post('/arrangements/:id/unassign', requirePermissionV2('arrangement.manage'),
  handle(async req => arrangements.unassign(req.user!.school_id, req.user!.id, req.params.id)))

router.post('/arrangements/:id/cancel', requireAnyPermissionV2('arrangement.manage', 'arrangement.acknowledge'),
  handle(async req => arrangements.cancelArrangement(
    req.user!.school_id, req.user!.id, req.params.id,
    String(req.body?.reason ?? 'No longer needed'),
    await can(req, 'arrangement.manage'))))

// ── the substitute's own actions ────────────────────────────────

router.post('/arrangements/:id/acknowledge', requirePermissionV2('arrangement.acknowledge'),
  handle(async req => arrangements.acknowledge(req.user!.school_id, req.user!.id, req.params.id)))

router.post('/arrangements/:id/decline', requirePermissionV2('arrangement.acknowledge'),
  handle(async req => {
    const reason = String(req.body?.reason ?? '').trim()
    if (!reason) {
      throw badRequest('reason_required',
        'Say why you cannot take it — the manager needs to find somebody else.')
    }
    return arrangements.decline(req.user!.school_id, req.user!.id, req.params.id, reason)
  }))

// ═══════════════════════════════════════════════════════════════
// FREE-PERIOD BOOKINGS
// ═══════════════════════════════════════════════════════════════

router.get('/my/bookable', requirePermissionV2('booking.manage_own'),
  handle(async req => bookings.bookableSlots(
    req.user!.school_id, req.user!.id,
    requireDate(req.query.from, today()),
    requireDate(req.query.to, addDaysStr(today(), 13)))))

const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodNumber: z.number().int().min(1),
  purpose: z.string(),
  notes: z.string().nullable().optional(),
})

router.post('/my/bookings', requirePermissionV2('booking.manage_own'),
  handle(async req => bookings.createBooking(
    req.user!.school_id, req.user!.id,
    validated<Parameters<typeof bookings.createBooking>[2]>(BookingSchema.parse(req.body)))))

router.delete('/my/bookings/:id', requirePermissionV2('booking.manage_own'),
  handle(async req => bookings.releaseBooking(req.user!.school_id, req.user!.id, req.params.id)))

router.get('/bookings', requirePermissionV2('arrangement.view'),
  handle(async req => bookings.listBookings(req.user!.school_id, {
    teacherId: typeof req.query.teacherId === 'string' ? req.query.teacherId : undefined,
    from: requireDate(req.query.from, today()),
    to: requireDate(req.query.to, addDaysStr(today(), 13)),
    includeInactive: req.query.includeInactive === 'true',
  })))

// ═══════════════════════════════════════════════════════════════
// WORKLOAD
// ═══════════════════════════════════════════════════════════════

router.get('/workload', requirePermissionV2('timetable.workload_view'),
  handle(async req => workload.workloadReport(
    req.user!.school_id,
    typeof req.query.month === 'string' ? req.query.month : undefined)))

router.get('/workload/:teacherId/redistribute', requirePermissionV2('timetable.workload_view'),
  handle(async req => workload.redistributionOptions(req.user!.school_id, req.params.teacherId)))

router.post('/workload/reassign', requirePermissionV2('timetable.manage'),
  handle(async req => {
    const periodId = String(req.body?.periodId ?? '')
    const teacherId = String(req.body?.teacherId ?? '')
    if (!periodId || !teacherId) throw badRequest('missing_fields', 'Choose a period and a teacher.')
    return workload.reassignPeriod(req.user!.school_id, req.user!.id, periodId, teacherId)
  }))

// ═══════════════════════════════════════════════════════════════
// GENERATION
// ═══════════════════════════════════════════════════════════════

router.get('/generate/feasibility', requirePermissionV2('timetable.generate'),
  handle(async req => generate.runFeasibility(req.user!.school_id)))

router.post('/generate', requirePermissionV2('timetable.generate'),
  handle(async req => {
    // Generation takes tens of seconds with no progress to watch, so a
    // second click is the natural thing to do — and it used to produce a
    // second draft nobody asked for. One at a time; discard the old one
    // first.
    const { data: openDraft } = await supabase.from('timetable_versions')
      .select('id, label').eq('school_id', req.user!.school_id).eq('status', 'draft').limit(1).maybeSingle()
    if (openDraft) {
      throw conflict('draft_exists',
        `There is already an unpublished draft ("${openDraft.label}"). Publish or discard it before generating another.`,
        { versionId: openDraft.id })
    }
    return generate.generateDraft(req.user!.school_id, req.user!.id, {
      seed: req.body?.seed != null ? Number(req.body.seed) : undefined,
      iterations: req.body?.iterations != null ? Number(req.body.iterations) : undefined,
      keepLocked: req.body?.keepLocked !== false,
      label: req.body?.label,
      effectiveFrom: req.body?.effectiveFrom ?? null,
    })
  }))

router.get('/versions', requirePermissionV2('timetable.view'),
  handle(async req => generate.listVersions(req.user!.school_id)))

router.get('/versions/:id/grid', requirePermissionV2('timetable.view'),
  handle(async req => generate.draftGrid(
    req.user!.school_id, req.params.id,
    typeof req.query.sectionId === 'string' ? req.query.sectionId : undefined)))

// Editing the live timetable means copying it first. See the note above
// cloneActiveToDraft: the published grid is what the school is working
// from right now, and rewriting it under them is not an edit, it is an
// outage nobody was told about.
router.post('/versions/clone-active', requirePermissionV2('timetable.manage'),
  handle(async req => generate.cloneActiveToDraft(req.user!.school_id, req.user!.id, {
    label: typeof req.body?.label === 'string' ? req.body.label : undefined,
  })))

router.patch('/draft/:versionId/cells/:cellId', requirePermissionV2('timetable.manage'),
  handle(async req => generate.updateDraftCell(
    req.user!.school_id, req.user!.id, req.params.versionId, req.params.cellId, {
      teacherId: 'teacherId' in (req.body ?? {}) ? (req.body.teacherId || null) : undefined,
      roomId: 'roomId' in (req.body ?? {}) ? (req.body.roomId || null) : undefined,
      subjectId: 'subjectId' in (req.body ?? {}) ? (req.body.subjectId || null) : undefined,
    })))

router.post('/draft/:versionId/cells/:cellId/move', requirePermissionV2('timetable.manage'),
  handle(async req => generate.moveDraftCell(
    req.user!.school_id, req.user!.id, req.params.versionId, req.params.cellId, {
      day: Number(req.body?.day),
      periodNumber: Number(req.body?.periodNumber),
    })))

router.post('/versions/:id/publish', requirePermissionV2('timetable.publish'),
  handle(async req => generate.publishVersion(req.user!.school_id, req.user!.id, req.params.id)))

router.post('/versions/:id/rollback', requirePermissionV2('timetable.publish'),
  handle(async req => generate.rollbackVersion(req.user!.school_id, req.user!.id, req.params.id)))

router.delete('/versions/:id', requirePermissionV2('timetable.generate'),
  handle(async req => generate.discardDraft(req.user!.school_id, req.user!.id, req.params.id)))

router.get('/conflicts', requirePermissionV2('timetable.view'),
  handle(async req => generate.liveConflicts(req.user!.school_id)))

router.post('/validate-move', requirePermissionV2('timetable.manage'),
  handle(async req => generate.validateMove(req.user!.school_id, {
    sectionId: String(req.body?.sectionId ?? ''),
    day: Number(req.body?.day),
    periodNumber: Number(req.body?.periodNumber),
    subjectId: req.body?.subjectId ?? null,
    teacherId: req.body?.teacherId ?? null,
  })))

// ═══════════════════════════════════════════════════════════════
// SWEEPS — manual triggers for the cron jobs
// ═══════════════════════════════════════════════════════════════
// Every scheduled job in this app is in-process, which on a host that
// sleeps when idle may never fire. These are how an external scheduler,
// or a manager who suspects nothing is running, sets them off.

router.post('/sweeps/acknowledgements', requirePermissionV2('arrangement.manage'),
  handle(async req => escalation.runAcknowledgementSweep(req.user!.school_id)))

router.post('/sweeps/unfilled', requirePermissionV2('arrangement.manage'),
  handle(async req => escalation.runUnfilledSweep(req.user!.school_id)))

// ── helpers ─────────────────────────────────────────────────────

function addDaysStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function addMonths(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, d)).toISOString().slice(0, 10)
}

export default router
