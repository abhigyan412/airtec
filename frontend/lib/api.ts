import axios, { AxiosError } from 'axios'

// Same-origin by default: the browser hits the Next.js server at `/api`,
// which proxies to the backend via the rewrite in next.config.js. This
// keeps everything on one origin (no CORS, one public domain in prod).
// Works for both the axios baseURL and the document-download <a href>s,
// since a relative path resolves against the current page origin.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api'

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('airtec_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Silent re-auth ───────────────────────────────────────────
// Supabase access tokens expire after an hour. Without this, the first
// request past that mark 401s and dumps the user back on the login
// screen mid-session, losing whatever they were looking at. On a 401 we
// spend the stored refresh_token once, then replay the original request.
//
// The in-flight promise is shared: a dashboard fires a dozen queries at
// once, and all of them 401 together — they must queue behind ONE
// refresh, or they'd each burn the refresh token and the losers would
// fail against an already-rotated token.
let refreshInFlight: Promise<string> | null = null

function hardLogout() {
  localStorage.removeItem('airtec_token')
  localStorage.removeItem('airtec_refresh_token')
  localStorage.removeItem('airtec_user')
  if (!window.location.pathname.startsWith('/auth/login')) {
    window.location.href = '/auth/login'
  }
}

async function refreshAccessToken(): Promise<string> {
  const refresh_token = localStorage.getItem('airtec_refresh_token')
  if (!refresh_token) throw new Error('no refresh token')

  // Bare axios, not `api` — going through the instance would recurse
  // back into this interceptor if the refresh itself 401s.
  const res = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token }, {
    headers: { 'Content-Type': 'application/json' },
  })
  const { access_token, refresh_token: rotated } = res.data.data
  localStorage.setItem('airtec_token', access_token)
  // Supabase rotates the refresh token on every use; keeping the old one
  // would make the *next* refresh fail.
  if (rotated) localStorage.setItem('airtec_refresh_token', rotated)
  return access_token
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined

    if (
      error.response?.status !== 401 ||
      typeof window === 'undefined' ||
      !original ||
      original._retried ||
      // The credential endpoints legitimately return 401 — a wrong
      // password must surface as a wrong password, not a refresh loop.
      original.url?.includes('/auth/login') ||
      original.url?.includes('/auth/refresh')
    ) {
      if (error.response?.status === 401 && typeof window !== 'undefined' && !original?.url?.includes('/auth/login')) {
        hardLogout()
      }
      return Promise.reject(error)
    }

    original._retried = true
    try {
      refreshInFlight = refreshInFlight ?? refreshAccessToken().finally(() => { refreshInFlight = null })
      const token = await refreshInFlight
      original.headers = original.headers ?? {}
      ;(original.headers as any).Authorization = `Bearer ${token}`
      return api(original)
    } catch {
      hardLogout()
      return Promise.reject(error)
    }
  }
)

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),
  me: () => api.get('/auth/me').then(r => r.data),
  registerSchool: (data: any) =>
    api.post('/auth/register-school', data).then(r => r.data),
  inviteUser: (data: any) =>
    api.post('/auth/invite-user', data).then(r => r.data),
  updateSchoolProfile: (data: any) =>
    api.patch('/auth/school-profile', data).then(r => r.data),
}

export const certificateApi = {
  getTemplates: () =>
    api.get('/documents/certificate-templates').then(r => r.data),
  createTemplate: (data: any) =>
    api.post('/documents/certificate-templates', data).then(r => r.data),
  getIssued: (params?: any) =>
    api.get('/documents/issued-certificates', { params }).then(r => r.data),
  issue: (data: any) =>
    api.post('/documents/issue-certificate', data).then(r => r.data),
  print: (certNumber: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/certificate/${certNumber}?token=${token}`
  },
}

export const admitCardApi = {
  single: (examId: string, studentId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/admit-card/${examId}/${studentId}?token=${token}`
  },
  bulk: (examId: string, classId?: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    const classParam = classId ? `&class_id=${classId}` : ''
    return `${API_BASE}/documents/admit-cards/bulk/${examId}?token=${token}${classParam}`
  },
}

// Printable pages opened via a plain `<a href target="_blank">` — the
// browser can't attach an Authorization header to that navigation, so
// the token has to travel as a query param instead (backend accepts
// both via authenticateFlexible).
export const documentsApi = {
  idCard: (studentId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/id-card/${studentId}?token=${token}`
  },
  studentProfile: (studentId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/student-profile/${studentId}?token=${token}`
  },
  reportCard: (examId: string, studentId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/report-card/${examId}/${studentId}?token=${token}`
  },
  relievingLetter: (exitId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/relieving-letter/${exitId}?token=${token}`
  },
  offerLetter: (applicationId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/offer-letter/${applicationId}?token=${token}`
  },
  // Distinct from offerLetter above — that one is the HR recruitment offer
  // (job_applications). This renders an admission_applications offer letter.
  admissionOfferLetter: (applicationId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/admission-offer-letter/${applicationId}?token=${token}`
  },
  payslip: (payslipId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/payslip/${payslipId}?token=${token}`
  },
}

export const studentsApi = {
  list: (params?: Record<string, any>) =>
    api.get('/students', { params }).then(r => r.data),
  get: (id: string) =>
    api.get(`/students/${id}`).then(r => r.data),
  me: () =>
    api.get('/students/me').then(r => r.data),
  create: (data: any) =>
    api.post('/students', data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch(`/students/${id}`, data).then(r => r.data),
  stats: () =>
    api.get('/students/stats/dashboard').then(r => r.data),
  attendanceToday: () =>
    api.get('/students/attendance/today').then(r => r.data),
  attendanceClassSummary: (date?: string) =>
    api.get('/students/attendance/class-summary', { params: { date } }).then(r => r.data),
  pendingTcRequests: () =>
    api.get('/students/tc-requests/pending').then(r => r.data),
  bulkPromote: (data: any) =>
    api.post('/students/bulk/promote', data).then(r => r.data),
  promotions: (params?: { student_id?: string; promotion_type?: string; class_id?: string; limit?: number }) =>
    api.get('/students/promotions', { params }).then(r => r.data),
  issueTC: (id: string, data: any) =>
    api.post(`/students/${id}/tc`, data).then(r => r.data),
  uploadPhoto: (id: string, data: any) =>
    api.post(`/students/${id}/photo`, data).then(r => r.data),
  createPortalLogin: (id: string, data: { target: 'student' | 'parent'; email: string; password: string }) =>
    api.post(`/students/${id}/portal-login`, data).then(r => r.data),
  getDocuments: (id: string) =>
    api.get(`/students/${id}/documents`).then(r => r.data),
  uploadDocument: (id: string, data: any) =>
    api.post(`/students/${id}/documents`, data).then(r => r.data),
  deleteDocument: (id: string, docId: string) =>
    api.delete(`/students/${id}/documents/${docId}`).then(r => r.data),
  getAttendance: (id: string, month?: number, year?: number) =>
    api.get(`/students/${id}/attendance`, { params: { month, year } }).then(r => r.data),
  performance: (id: string, examId?: string) =>
    api.get(`/students/${id}/performance`, { params: { exam_id: examId } }).then(r => r.data),
  getClassAttendance: (classId: string, date: string, sectionId?: string) =>
    api.get('/students/attendance/class', { params: { class_id: classId, date, section_id: sectionId } }).then(r => r.data),
  saveAttendance: (data: any) =>
    api.post('/students/attendance', data).then(r => r.data),
  getAttendanceReport: (classId: string, month: number, year: number, sectionId?: string) =>
    api.get('/students/attendance/report', { params: { class_id: classId, month, year, section_id: sectionId || undefined } }).then(r => r.data),
  // Custom range (e.g. academic-year-to-date) instead of a single month.
  getAttendanceReportRange: (classId: string, from: string, to: string, sectionId?: string) =>
    api.get('/students/attendance/report', { params: { class_id: classId, from, to, section_id: sectionId || undefined } }).then(r => r.data),
  tc: {
    request: (id: string, data: any) => api.post(`/students/${id}/tc`, data).then(r => r.data),
    list: (id: string) => api.get(`/students/${id}/tc`).then(r => r.data),
    workflowStatus: (id: string, tcId: string) =>
      api.get(`/students/${id}/tc/${tcId}/workflow-status`).then(r => r.data),
    workflowAction: (id: string, tcId: string, status: 'approved' | 'rejected', notes?: string) =>
      api.post(`/students/${id}/tc/${tcId}/workflow-action`, { status, notes }).then(r => r.data),
  },
}

export const academicYearsApi = {
  list: () => api.get('/admission/academic-years').then(r => r.data),
}

export const admissionApi = {
  inquiries: {
    list: (params?: Record<string, any>) =>
      api.get('/admission/inquiries', { params }).then(r => r.data),
    get: (id: string) =>
      api.get(`/admission/inquiries/${id}`).then(r => r.data),
    create: (data: any) =>
      api.post('/admission/inquiries', data).then(r => r.data),
    update: (id: string, data: any) =>
      api.patch(`/admission/inquiries/${id}`, data).then(r => r.data),
    stats: (params?: { academic_year_id?: string }) =>
      api.get('/admission/inquiries/stats', { params }).then(r => r.data),
    addFollowUp: (id: string, data: any) =>
      api.post(`/admission/inquiries/${id}/follow-ups`, data).then(r => r.data),
    convertToApplication: (id: string) =>
      api.post(`/admission/inquiries/${id}/convert-to-application`).then(r => r.data),
    academicYears: () => api.get('/admission/academic-years').then(r => r.data),
    sources: {
      list: () => api.get('/admission/inquiry-sources').then(r => r.data),
      create: (name: string) => api.post('/admission/inquiry-sources', { name }).then(r => r.data),
    },
    documents: {
      list: (id: string) => api.get(`/admission/inquiries/${id}/documents`).then(r => r.data),
      upload: (id: string, data: any) => api.post(`/admission/inquiries/${id}/documents`, data).then(r => r.data),
      verify: (id: string, docId: string, is_verified: boolean) =>
        api.patch(`/admission/inquiries/${id}/documents/${docId}`, { is_verified }).then(r => r.data),
      delete: (id: string, docId: string) => api.delete(`/admission/inquiries/${id}/documents/${docId}`).then(r => r.data),
    },

  },
  applications: {
    list: (params?: Record<string, any>) =>
      api.get('/admission/applications', { params }).then(r => r.data),
    create: (data: any) =>
      api.post('/admission/applications', data).then(r => r.data),
    approve: (id: string, data: any) =>
      api.post(`/admission/applications/${id}/approve`, data).then(r => r.data),
    get: (id: string) => api.get(`/admission/applications/${id}`).then(r => r.data),
    documents: {
      list: (id: string) => api.get(`/admission/applications/${id}/documents`).then(r => r.data),
      upload: (id: string, data: any) => api.post(`/admission/applications/${id}/documents`, data).then(r => r.data),
      verify: (id: string, docId: string, is_verified: boolean) =>
        api.patch(`/admission/applications/${id}/documents/${docId}`, { is_verified }).then(r => r.data),
      delete: (id: string, docId: string) => api.delete(`/admission/applications/${id}/documents/${docId}`).then(r => r.data),
    },
    collectFee: (id: string, data: { amount: number; method: string; reference?: string }) =>
      api.post(`/admission/applications/${id}/collect-fee`, data).then(r => r.data),
    extendFeeHold: (id: string, data: { days: number; reason?: string }) =>
      api.post(`/admission/applications/${id}/extend-fee-hold`, data).then(r => r.data),
    issueOfferLetter: (id: string) =>
      api.post(`/admission/applications/${id}/issue-offer-letter`).then(r => r.data),
  },

  classes: () =>
    api.get('/admission/classes').then(r => r.data),

  seats: {
    list: () => api.get('/admission/admission-seats').then(r => r.data),
    update: (classId: string, data: { capacity?: number; frozen?: number; locked?: boolean; reason?: string }) =>
      api.patch(`/admission/admission-seats/${classId}`, data).then(r => r.data),
  },

  alerts: () => api.get('/admission/admission-alerts').then(r => r.data),

  classDisplayStyle: {
    get: () => api.get('/admission/class-display-style').then(r => r.data),
    update: (style: 'numeric' | 'roman') => api.patch('/admission/class-display-style', { style }).then(r => r.data),
  },

  settings: {
    get: () => api.get('/admission/admission-settings').then(r => r.data),
    update: (data: Partial<{
      admission_fee_hold_days: number
      admission_fee_hold_grace_days: number
      admission_waitlist_response_days: number
      admission_stage_aging_days: number
      admission_occupancy_warning_percent: number
      admission_occupancy_warning_days: number
    }>) => api.patch('/admission/admission-settings', data).then(r => r.data),
  },

  cycles: {
    list: () => api.get('/admission/admission-cycles').then(r => r.data),
    create: (data: { academic_year_id: string; opens_at?: string; closes_at?: string; notes?: string }) =>
      api.post('/admission/admission-cycles', data).then(r => r.data),
    delete: (id: string) => api.delete(`/admission/admission-cycles/${id}`).then(r => r.data),
  },

  classSettings: {
    list: () => api.get('/admission/class-settings').then(r => r.data),
    update: (classId: string, data: { entrance_mode?: string; pass_marks_percent?: number; admission_fee_amount?: number | null }) =>
      api.patch(`/admission/class-settings/${classId}`, data).then(r => r.data),
  },

  documentRequirements: {
    list: (classId?: string) => api.get('/admission/document-requirements', { params: { class_id: classId } }).then(r => r.data),
    create: (data: { class_id: string; document_type: string }) =>
      api.post('/admission/document-requirements', data).then(r => r.data),
    delete: (id: string) => api.delete(`/admission/document-requirements/${id}`).then(r => r.data),
  },

  slots: {
    list: (params?: { slot_type?: string; from?: string; to?: string; class_id?: string }) =>
      api.get('/admission/admission-slots', { params }).then(r => r.data),
    create: (data: any) => api.post('/admission/admission-slots', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/admission/admission-slots/${id}`, data).then(r => r.data),
    delete: (id: string) => api.delete(`/admission/admission-slots/${id}`).then(r => r.data),
    book: (id: string, data: { inquiry_id?: string; application_id?: string }) =>
      api.post(`/admission/admission-slots/${id}/book`, data).then(r => r.data),
  },

  slotBookings: {
    list: (params: { inquiry_id?: string; application_id?: string; slot_id?: string }) =>
      api.get('/admission/admission-slot-bookings', { params }).then(r => r.data),
    update: (id: string, data: { status?: string; result?: string; marks_obtained?: number; max_marks?: number }) =>
      api.patch(`/admission/admission-slot-bookings/${id}`, data).then(r => r.data),
    // Phase 6c: result-publishing workflow, auto-started when marks are
    // entered — same shared engine as workflowApi below, pointed at a
    // booking instead of an admission_application.
    workflowStatus: (id: string) => api.get(`/admission/admission-slot-bookings/${id}/workflow-status`).then(r => r.data),
    workflowAct: (id: string, status: 'approved' | 'rejected' | 'commented', notes?: string) =>
      api.post(`/admission/admission-slot-bookings/${id}/workflow-action`, { status, notes }).then(r => r.data),
  },
}

export const classesApi = {
  list: () => api.get('/admission/classes').then(r => r.data),
  strength: () => api.get('/admission/classes/strength').then(r => r.data),
  create: (data: { name: string; numeric_level?: number; stream?: string }) =>
    api.post('/admission/classes', data).then(r => r.data),
  update: (id: string, data: { name?: string; numeric_level?: number; stream?: string }) =>
    api.patch(`/admission/classes/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/admission/classes/${id}`).then(r => r.data),
  sections: {
    create: (classId: string, data: { name: string; max_strength?: number }) =>
      api.post(`/admission/classes/${classId}/sections`, data).then(r => r.data),
    update: (id: string, data: { name?: string; max_strength?: number }) =>
      api.patch(`/admission/sections/${id}`, data).then(r => r.data),
    delete: (id: string) => api.delete(`/admission/sections/${id}`).then(r => r.data),
  },
  subjects: {
    list: (classId?: string) => api.get('/admission/subjects', { params: { class_id: classId } }).then(r => r.data),
    create: (data: { name: string; class_id?: string; is_elective?: boolean }) =>
      api.post('/admission/subjects', data).then(r => r.data),
    delete: (id: string) => api.delete(`/admission/subjects/${id}`).then(r => r.data),
    rescope: (name: string, class_ids: string[]) =>
      api.post('/admission/subjects/rescope', { name, class_ids }).then(r => r.data),
  },
}

export const calendarApi = {
  holidays: {
    list: (year?: number) => api.get('/admission/holidays', { params: { year } }).then(r => r.data),
    upcoming: (from: string, to: string) => api.get('/admission/holidays', { params: { from, to } }).then(r => r.data),
    create: (data: { date: string; name: string }) =>
      api.post('/admission/holidays', data).then(r => r.data),
    delete: (id: string) => api.delete(`/admission/holidays/${id}`).then(r => r.data),
  },
  weeklyOff: {
    get: () => api.get('/admission/weekly-off').then(r => r.data),
    update: (weekly_off_days: number[]) =>
      api.patch('/admission/weekly-off', { weekly_off_days }).then(r => r.data),
  },
  lowAttendanceThreshold: {
    get: () => api.get('/admission/low-attendance-threshold').then(r => r.data),
    update: (low_attendance_threshold_pct: number) =>
      api.patch('/admission/low-attendance-threshold', { low_attendance_threshold_pct }).then(r => r.data),
  },
}

export const feeApi = {
  heads: {
    list: (params?: Record<string, any>) => api.get('/fees/heads', { params }).then(r => r.data),
    create: (data: any) => api.post('/fees/heads', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/fees/heads/${id}`, data).then(r => r.data),
    /** Retired rather than deleted when structure lines reference it. */
    remove: (id: string) => api.delete(`/fees/heads/${id}`).then(r => r.data),
  },
  // A structure is a NAMED, VERSIONED plan — lines + classes + cadence — not a
  // (class, head, amount) cell. There is deliberately no update(): a live plan is
  // superseded by a new version, so an invoice raised last term can still be
  // explained by the figures it was raised from.
  structures: {
    list: (params?: Record<string, any>) =>
      api.get('/fees/structures', { params }).then(r => r.data),
    get: (id: string) => api.get(`/fees/structures/${id}`).then(r => r.data),
    create: (data: any) => api.post('/fees/structures', data).then(r => r.data),
    newVersion: (id: string, data: any) =>
      api.post(`/fees/structures/${id}/versions`, data).then(r => r.data),
    setStatus: (id: string, status: 'draft' | 'active' | 'archived') =>
      api.patch(`/fees/structures/${id}/status`, { status }).then(r => r.data),
  },
  // Who is on which plan. The step between "here is what Class 5 pays" and "here
  // is Aarav's bill", which had no API and no screen.
  assignments: {
    list: (params?: Record<string, any>) => api.get('/fees/assignments', { params }).then(r => r.data),
    /** Writes nothing. Says exactly who gets billed and for how much. */
    preview: (data: any) => api.post('/fees/assignments/preview', data).then(r => r.data),
    create: (data: any) => api.post('/fees/assignments', data).then(r => r.data),
    /** The optional lines on a student's plan, and whether they have opted in. */
    optionals: (studentId: string) =>
      api.get(`/fees/assignments/${studentId}/optionals`).then(r => r.data),
    optIn: (studentId: string, structureLineId: string, note?: string) =>
      api.post(`/fees/assignments/${studentId}/optionals`, { structure_line_id: structureLineId, note })
        .then(r => r.data),
    optOut: (studentId: string, structureLineId: string) =>
      api.delete(`/fees/assignments/${studentId}/optionals/${structureLineId}`).then(r => r.data),
    /**
     * Re-categorise students already on a plan — RTE, staff ward, sibling.
     * Was only settable at assignment time, which made it useless for seats
     * identified partway through a year. `preview: true` writes nothing.
     */
    setCategory: (data: {
      fee_category: string; class_ids?: string[]; section_ids?: string[]
      student_ids?: string[]; academic_year_id?: string; preview?: boolean
    }) => api.patch('/fees/assignments/category', data).then(r => r.data),
  },
  // Bulk billing — the step that did not exist. preview writes nothing and
  // returns exactly what generate will do.
  billing: {
    periods: (academicYearId: string, frequency?: string) =>
      api.get('/fees/billing/periods', { params: { academic_year_id: academicYearId, frequency } }).then(r => r.data),
    preview: (data: any) => api.post('/fees/billing/preview', data).then(r => r.data),
    generate: (data: any) => api.post('/fees/billing/generate', data).then(r => r.data),
  },
  invoices: {
    list: (params?: Record<string, any>) => api.get('/fees/invoices', { params }).then(r => r.data),
    get: (id: string) => api.get(`/fees/invoices/${id}`).then(r => r.data),
    cancel: (id: string, reason?: string) =>
      api.patch(`/fees/invoices/${id}/cancel`, { reason }).then(r => r.data),
  },
  payments: {
    list: (params?: Record<string, any>) => api.get('/fees/payments', { params }).then(r => r.data),
    /**
     * The bank returned it. NOT a cancellation — cancelling says the money never
     * came, bouncing says it came, was credited, and was taken back. Reverses the
     * allocations so the dues reappear, and posts the mirror ledger entries.
     */
    bounce: (id: string, data: { reason?: string; bounce_fee?: number; bounced_on?: string }) =>
      api.post(`/fees/payments/${id}/bounce`, data).then(r => r.data),
    /**
     * ONE transaction, split across open invoices oldest-first by the server.
     * There is no per-invoice variant: a parent handing over ₹5,000 against three
     * invoices is one payment with three allocations and ONE receipt number.
     */
    collect: (data: any) => api.post('/fees/payments', data).then(r => r.data),
  },
  dues: (params?: Record<string, any>) => api.get('/fees/dues', { params }).then(r => r.data),
  collectionTrend: (months?: number) =>
    api.get('/fees/collection-trend', { params: { months } }).then(r => r.data),
  collectionTrendRange: (from: string, to: string) =>
    api.get('/fees/collection-trend', { params: { from, to } }).then(r => r.data),
  arrears: {
    list: (params?: Record<string, any>) => api.get('/fees/arrears', { params }).then(r => r.data),
    carryForward: (fromAcademicYearId: string, toAcademicYearId: string) =>
      api.post('/fees/arrears/carry-forward', {
        from_academic_year_id: fromAcademicYearId,
        to_academic_year_id: toAcademicYearId,
      }).then(r => r.data),
    recordPayment: (id: string, data: any) => api.post(`/fees/arrears/${id}/payment`, data).then(r => r.data),
    waive: (id: string, reason: string) => api.patch(`/fees/arrears/${id}/waive`, { reason }).then(r => r.data),
  },
  discounts: {
    list: (params?: Record<string, any>) => api.get('/fees/discounts', { params }).then(r => r.data),
    create: (data: any) => api.post('/fees/discounts', data).then(r => r.data),
    decide: (id: string, decision: 'approved' | 'rejected', note?: string) =>
      api.post(`/fees/discounts/${id}/decide`, { decision, note }).then(r => r.data),
    scholarships: {
      list: (params?: Record<string, any>) =>
        api.get('/fees/discounts/scholarships', { params }).then(r => r.data),
      create: (data: any) => api.post('/fees/discounts/scholarships', data).then(r => r.data),
    },
    // Moved under /discounts with the module split. These drive auto-approval;
    // an unconfigured role has a ceiling of 0, which is why the Setup screen now
    // surfaces them instead of the UI asserting a flat "under ₹2,000" rule that
    // was never what the backend did.
    limits: () => api.get('/fees/discounts/limits').then(r => r.data),
    updateLimit: (roleId: string, data: any) =>
      api.put(`/fees/discounts/limits/${roleId}`, data).then(r => r.data),

    /**
     * Standing policy per fee category — what "RTE" or "Sibling" actually does
     * to a bill. The rule is applied by the billing run when an invoice is
     * built; a hand-granted concession under `create` above remains the way to
     * handle one family's exception.
     */
    rules: {
      list: (academicYearId?: string) =>
        api.get('/fees/discounts/rules', { params: { academic_year_id: academicYearId } })
          .then(r => r.data),
      save: (data: any) => api.put('/fees/discounts/rules', data).then(r => r.data),
      remove: (id: string) => api.delete(`/fees/discounts/rules/${id}`).then(r => r.data),
    },
  },
  // Browse by class rather than searching by name — a school chasing dues asks
  // "where is 5-B", and there was no way to ask that.
  classes: {
    summary: (params?: Record<string, any>) => api.get('/fees/classes', { params }).then(r => r.data),
    students: (params: Record<string, any>) => api.get('/fees/classes/students', { params }).then(r => r.data),
  },
  receipts: {
    // There is no list route: the list of receipts is the list of payments.
    // `payments.list` accepts `search` on receipt_number and returns the
    // allocation count per receipt.
    get: (paymentId: string) => api.get(`/fees/receipts/${paymentId}`).then(r => r.data),
  },
  // Waivers, cancellations and refunds: raised by whoever collects, decided by
  // whoever manages the structure. Approval performs the action.
  requests: {
    list: (params?: Record<string, any>) => api.get('/fees/requests', { params }).then(r => r.data),
    create: (data: any) => api.post('/fees/requests', data).then(r => r.data),
    decide: (id: string, decision: 'approved' | 'rejected', note?: string) =>
      api.post(`/fees/requests/${id}/decide`, { decision, note }).then(r => r.data),
  },
  approvals: () => api.get('/fees/approvals').then(r => r.data),
  stats: (params?: Record<string, any>) => api.get('/fees/stats', { params }).then(r => r.data),
  /** One student's complete position: invoices, payments, arrears, ad-hoc, plan. */
  student: (studentId: string) => api.get(`/fees/students/${studentId}`).then(r => r.data),
  agingReport: (params?: Record<string, any>) => api.get('/fees/aging-report', { params }).then(r => r.data),
  // Paged over FAMILIES, not invoices: the server groups first and cuts the page
  // afterwards, so meta.total_outstanding stays the whole school's position while
  // data is one screenful.
  // RTE seats are excluded by default: whatever is outstanding on them is owed
  // by the state, not the family, and this list exists to decide who to phone.
  // Pass a category to look at one deliberately, or includeAll for an audit.
  defaulters: (
    minDaysOverdue?: number, page?: number, limit?: number,
    opts?: { category?: string; includeAll?: boolean },
  ) =>
    api.get('/fees/defaulters', {
      params: {
        min_days_overdue: minDaysOverdue, page, limit,
        category: opts?.category || undefined,
        include_all_categories: opts?.includeAll ? 'true' : undefined,
      },
    }).then(r => r.data),
  // preview writes nothing and reports what WOULD change — matching the
  // preview-then-commit shape billing and assignment already use. The sweep is
  // a school-wide money mutation and used to be one unconfirmed click.
  applyLateFees: (preview = false) =>
    api.post('/fees/apply-late-fees', { preview }).then(r => r.data),

  /** What this counter took today, for tallying the drawer against the cash box. */
  daybook: (date?: string) =>
    api.get('/fees/daybook', { params: { date } }).then(r => r.data),
  /** Seats by kind — RTE, staff ward, sibling — and what is carried on each. */
  /**
   * The one ledger in this module that is not a family's debt: what the state
   * owes for RTE seats, at the state's rate rather than the school's fee.
   */
  rte: {
    rates: (academicYearId?: string) =>
      api.get('/fees/rte/rates', { params: { academic_year_id: academicYearId } }).then(r => r.data),
    saveRate: (data: any) => api.put('/fees/rte/rates', data).then(r => r.data),
    removeRate: (id: string) => api.delete(`/fees/rte/rates/${id}`).then(r => r.data),

    claims: (params?: Record<string, any>) =>
      api.get('/fees/rte/claims', { params }).then(r => r.data),
    generate: (data: any) => api.post('/fees/rte/claims/generate', data).then(r => r.data),
    updateClaim: (id: string, data: any) =>
      api.patch(`/fees/rte/claims/${id}`, data).then(r => r.data),
    summary: (academicYearId?: string) =>
      api.get('/fees/rte/summary', { params: { academic_year_id: academicYearId } }).then(r => r.data),
  },

  byCategory: (academicYearId?: string) =>
    api.get('/fees/by-category', { params: { academic_year_id: academicYearId } }).then(r => r.data),
  /** Expected income by month, read forward off the plans' schedules. */
  forecast: (months?: number) =>
    api.get('/fees/forecast', { params: { months } }).then(r => r.data),

  /**
   * Paying online. Staff use it to send a family a link or take a card payment;
   * the parent portal uses the same endpoints for self-service.
   */
  gateway: {
    /** Money in flight — so a desk does not collect a fee a parent is mid-way through paying. */
    list: (params?: { student_id?: string; status?: string }) =>
      api.get('/fees/gateway/orders', { params }).then(r => r.data),
    createOrder: (data: { student_id?: string; amount?: number; invoice_ids?: string[] }) =>
      api.post('/fees/gateway/orders', data).then(r => r.data),
    get: (orderId: string) => api.get(`/fees/gateway/orders/${orderId}`).then(r => r.data),
  },
}

/**
 * A CSV download goes through the browser, not axios — the response is a file,
 * and the auth header has to ride along, so the blob is fetched and handed to a
 * synthetic link rather than opening a URL the server would 401.
 */
export async function downloadFeeCsv(path: string, params: Record<string, any>, filename: string) {
  const res = await api.get(path, { params: { ...params, format: 'csv' }, responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: revoking synchronously can cancel the download in
  // Safari before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Every query key the fee module uses. Recording a payment moves numbers on the
 * overview, the invoice list, the aging buckets, the defaulter list and the
 * dashboard trend — previously each mutation invalidated whichever subset its
 * author had in mind, so the payment modal refreshed dues while leaving Recovery
 * showing the old balance, and the late-fine sweep did the reverse.
 *
 * Fee data is small and read on demand; invalidating the family wholesale is
 * cheaper than being wrong about which screen a number appears on.
 */
export const FEE_QUERY_KEYS = [
  'fee-stats', 'fee-heads', 'fee-structures', 'fee-invoices', 'fee-invoice',
  'fee-dues', 'fee-payments', 'fee-discounts', 'fee-discount-limits',
  'fee-arrears', 'fee-aging', 'fee-defaulters', 'fee-student-summary',
  'fee-billing-preview', 'fee-billing-periods',
  'fee-classes', 'fee-class-students', 'fee-receipts', 'fee-receipt',
  'fee-requests', 'fee-approvals', 'fee-optional', 'fee-adhoc',
  'fee-structure', 'fee-assignments', 'fee-daybook', 'fee-forecast', 'fee-orders', 'fee-by-category',
  // Dashboard cards that read fee data. They live outside the module but go
  // stale for exactly the same reasons.
  'dashboard-fee-trend', 'dashboard-fee-followups',
] as const

export function invalidateFeeQueries(queryClient: { invalidateQueries: (f: any) => void }) {
  for (const key of FEE_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] })
}


export const adhocFeeApi = {
  list: (params?: any) =>
    api.get('/fees/adhoc', { params }).then(r => r.data),
  create: (data: any) =>
    api.post('/fees/adhoc', data).then(r => r.data),
  /** Raise an invoice for a charge that was never billed. */
  bill: (id: string) => api.post(`/fees/adhoc/${id}/bill`).then(r => r.data),
  /** Cancels the charge AND its invoice — a withdrawn trip must stop being owed. */
  cancel: (id: string) => api.patch(`/fees/adhoc/${id}/cancel`).then(r => r.data),
}
export const timetableApi = {
  get: (params?: any) => api.get('/students/timetable', { params }).then(r => r.data),
  // Whether the live timetable is locked (managed via the versioned block
  // view), so this flat editor can render read-only instead of failing on save.
  lockStatus: () => api.get('/students/timetable/lock-status').then(r => r.data),
  save: (periods: any[]) => api.post('/students/timetable', { periods }).then(r => r.data),
  bulkLunch: (data: { start_time: string; end_time: string; subject_name?: string; days?: number[]; class_ids?: string[] }) =>
    api.post('/students/timetable/bulk-lunch', data).then(r => r.data),
  delete: (id: string) => api.delete(`/students/timetable/${id}`).then(r => r.data),
  freeFaculty: (dayOfWeek: number, periodNumber?: number, date?: string) =>
    api.get('/students/timetable/free-faculty', { params: { day_of_week: dayOfWeek, period_number: periodNumber, date } }).then(r => r.data),
  attentionRequired: () =>
    api.get('/students/timetable/attention-required').then(r => r.data),
  substitutes: (dayOfWeek: number, periodNumber: number, subjectName?: string, excludeTeacherId?: string) =>
    api.get('/students/timetable/substitutes', {
      params: { day_of_week: dayOfWeek, period_number: periodNumber, subject_name: subjectName, exclude_teacher_id: excludeTeacherId },
    }).then(r => r.data),
}

export const resourcesApi = {
  list: (params?: any) => api.get('/students/resources', { params }).then(r => r.data),
  upload: (data: any) => api.post('/students/resources', data).then(r => r.data),
  delete: (id: string) => api.delete(`/students/resources/${id}`).then(r => r.data),
}

export const complaintsApi = {
  list: (params?: any) =>
    api.get('/students/complaints/all', { params }).then(r => r.data),
  stats: () =>
    api.get('/students/complaints/stats').then(r => r.data),
  create: (data: any) =>
    api.post('/students/complaints', data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch(`/students/complaints/${id}`, data).then(r => r.data),
  getComments: (id: string) =>
    api.get(`/students/complaints/${id}/comments`).then(r => r.data),
  addComment: (id: string, comment: string) =>
    api.post(`/students/complaints/${id}/comments`, { comment }).then(r => r.data),
}

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unread_only?: boolean; type?: string }) =>
    api.get('/notifications', { params }).then(r => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then(r => r.data),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then(r => r.data),
  dismiss: (id: string) => api.delete(`/notifications/${id}`).then(r => r.data),
  runFeeReminders: () => api.post('/notifications/run-fee-reminders').then(r => r.data),
}

export const teacherApi = {
  dashboard: () => api.get('/teacher/dashboard').then(r => r.data),
  homeworkOverview: () => api.get('/teacher/homework-overview').then(r => r.data),
  homeroomFeeDues: () => api.get('/teacher/homeroom-fee-dues').then(r => r.data),
  subjectPerformance: (section_id: string, subject_id: string) =>
    api.get('/teacher/subject-performance', { params: { section_id, subject_id } }).then(r => r.data),
  classTeacherAssignments: {
    list: (params?: { academic_year_id?: string }) => api.get('/teacher/class-teacher-assignments', { params }).then(r => r.data),
    create: (data: { teacher_id: string; section_id: string; academic_year_id: string }) =>
      api.post('/teacher/class-teacher-assignments', data).then(r => r.data),
    remove: (id: string) => api.delete(`/teacher/class-teacher-assignments/${id}`).then(r => r.data),
  },
}

export const principalApi = {
  dashboard: () => api.get('/principal/dashboard').then(r => r.data),
  staffAttendance: (type: 'teaching' | 'non_teaching') =>
    api.get('/principal/staff-attendance', { params: { type } }).then(r => r.data),
  lowAttendanceStudents: (params?: { class_id?: string; section_id?: string }) =>
    api.get('/principal/low-attendance-students', { params }).then(r => r.data),
  syllabusChapters: (class_id: string, subject_name: string) =>
    api.get('/principal/syllabus-chapters', { params: { class_id, subject_name } }).then(r => r.data),
}

export const hrmsApi = {
  staff: {
    list: (params?: any) => api.get('/hrms/staff', { params }).then(r => r.data),
    stats: () => api.get('/hrms/staff/stats').then(r => r.data),
    get: (id: string) => api.get(`/hrms/staff/${id}`).then(r => r.data),
    updateProfile: (id: string, data: any) => api.put(`/hrms/staff/${id}/profile`, data).then(r => r.data),
    uploadPhoto: (id: string, data: any) => api.post(`/hrms/staff/${id}/photo`, data).then(r => r.data),
    positionHistory: (id: string) => api.get(`/hrms/staff/${id}/position-history`).then(r => r.data),
    promote: (id: string, data: any) => api.post(`/hrms/staff/${id}/promote`, data).then(r => r.data),
    probationConfirm: (id: string) => api.post(`/hrms/staff/${id}/probation/confirm`).then(r => r.data),
    probationExtend: (id: string, new_probation_end_date: string) => api.post(`/hrms/staff/${id}/probation/extend`, { new_probation_end_date }).then(r => r.data),
    documents: {
      list: (userId: string) => api.get(`/hrms/staff/${userId}/documents`).then(r => r.data),
      upload: (userId: string, data: any) => api.post(`/hrms/staff/${userId}/documents`, data).then(r => r.data),
      delete: (userId: string, docId: string) => api.delete(`/hrms/staff/${userId}/documents/${docId}`).then(r => r.data),
      acknowledge: (userId: string, docId: string) => api.post(`/hrms/staff/${userId}/documents/${docId}/acknowledge`).then(r => r.data),
    },
    orgChart: () => api.get('/hrms/staff/org-chart').then(r => r.data),
  },
  documentsExpiring: () => api.get('/hrms/documents/expiring').then(r => r.data),
  exit: {
    get: (userId: string) => api.get(`/hrms/staff/${userId}/exit`).then(r => r.data),
    initiate: (userId: string, data: any) => api.post(`/hrms/staff/${userId}/exit`, data).then(r => r.data),
    toggleChecklistItem: (exitId: string, itemId: string, data: any) => api.patch(`/hrms/exit/${exitId}/checklist/${itemId}`, data).then(r => r.data),
    submitSettlement: (exitId: string) => api.post(`/hrms/exit/${exitId}/submit-settlement`).then(r => r.data),
    workflowAction: (exitId: string, data: any) => api.post(`/hrms/exit/${exitId}/workflow-action`, data).then(r => r.data),
  },
  leaveTypes: {
    list: () => api.get('/hrms/leave-types').then(r => r.data),
    create: (data: any) => api.post('/hrms/leave-types', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/leave-types/${id}`, data).then(r => r.data),
    delete: (id: string) => api.delete(`/hrms/leave-types/${id}`).then(r => r.data),
  },
  leaveRequests: {
    list: (params?: any) => api.get('/hrms/leave-requests', { params }).then(r => r.data),
    stats: () => api.get('/hrms/leave-requests/stats').then(r => r.data),
    create: (data: any) => api.post('/hrms/leave-requests', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/leave-requests/${id}`, data).then(r => r.data),
    cancel: (id: string, reason?: string) => api.delete(`/hrms/leave-requests/${id}`, { data: { reason } }).then(r => r.data),
  },
  leaveBalances: (userId: string, year?: number) =>
    api.get(`/hrms/leave-balances/${userId}`, { params: { year } }).then(r => r.data),
  compOff: {
    list: (params?: any) => api.get('/hrms/comp-off', { params }).then(r => r.data),
    request: (data: any) => api.post('/hrms/comp-off', data).then(r => r.data),
    workflowAction: (id: string, status: 'approved' | 'rejected', notes?: string) =>
      api.post(`/hrms/comp-off/${id}/workflow-action`, { status, notes }).then(r => r.data),
  },
  leavePolicy: {
    runAccrual: () => api.post('/hrms/leave-accrual/run').then(r => r.data),
    runYearEnd: (forYear?: number) => api.post('/hrms/leave-year-end/run', { for_year: forYear }).then(r => r.data),
  },
  salaryStructure: {
    get: (userId: string) => api.get(`/hrms/salary-structure/${userId}`).then(r => r.data),
    set: (data: any) => api.put('/hrms/salary-structure', data).then(r => r.data),
  },
  payslips: {
    list: (params?: any) => api.get('/hrms/payslips', { params }).then(r => r.data),
    get: (id: string) => api.get(`/hrms/payslips/${id}`).then(r => r.data),
    generate: (data: any) => api.post('/hrms/payslips/generate', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/payslips/${id}`, data).then(r => r.data),
    approve: (id: string) => api.post(`/hrms/payslips/${id}/approve`).then(r => r.data),
    requestCorrection: (id: string, data: { reason: string; corrected?: Record<string, any>; adjustment_amount?: number }) =>
      api.post(`/hrms/payslips/${id}/corrections`, data).then(r => r.data),
    markFailed: (id: string, data: { reason: string; bank_reference?: string }) =>
      api.post(`/hrms/payslips/${id}/mark-failed`, data).then(r => r.data),
  },
  taxDeclarations: {
    get: (params?: { user_id?: string; academic_year_id?: string }) =>
      api.get('/hrms/tax-declarations', { params }).then(r => r.data),
    save: (data: { section_80c: number; hra_exemption: number; other_exemptions: number; academic_year_id?: string }) =>
      api.put('/hrms/tax-declarations', data).then(r => r.data),
    window: {
      get: (params?: { academic_year_id?: string }) => api.get('/hrms/tax-declaration-window', { params }).then(r => r.data),
      save: (data: { lock_date: string; academic_year_id?: string }) => api.put('/hrms/tax-declaration-window', data).then(r => r.data),
    },
  },
  taxReconciliation: {
    get: (params?: { user_id?: string; academic_year_id?: string }) =>
      api.get('/hrms/tax-reconciliation', { params }).then(r => r.data),
  },
  dutyLog: {
    list: (params?: { user_id?: string; month?: number; year?: number; approved_only?: boolean }) =>
      api.get('/hrms/duty-log', { params }).then(r => r.data),
    create: (data: { user_id: string; date: string; session_type: string; description?: string; rate: number }) =>
      api.post('/hrms/duty-log', data).then(r => r.data),
    approve: (id: string) => api.patch(`/hrms/duty-log/${id}/approve`).then(r => r.data),
    delete: (id: string) => api.delete(`/hrms/duty-log/${id}`).then(r => r.data),
  },
  salaryArrears: {
    list: (params?: { user_id?: string; status?: string; applied_to_payslip_id?: string }) =>
      api.get('/hrms/salary-arrears', { params }).then(r => r.data),
    create: (data: { user_id: string; from_month: number; from_year: number; to_month: number; to_year: number; amount: number; reason: string }) =>
      api.post('/hrms/salary-arrears', data).then(r => r.data),
    decide: (id: string, decision: 'approved' | 'rejected', note?: string) =>
      api.post(`/hrms/salary-arrears/${id}/decide`, { decision, note }).then(r => r.data),
  },
  payslipCorrections: {
    list: (params?: any) => api.get('/hrms/payslip-corrections', { params }).then(r => r.data),
    decide: (id: string, decision: 'approved' | 'rejected', note?: string) =>
      api.post(`/hrms/payslip-corrections/${id}/decide`, { decision, note }).then(r => r.data),
  },
  payroll: {
    summary: (params?: any) => api.get('/hrms/payroll/summary', { params }).then(r => r.data),
    settings: {
      get: () => api.get('/hrms/payroll/settings').then(r => r.data),
      update: (data: any) => api.put('/hrms/payroll/settings', data).then(r => r.data),
    },
    // hrms routes only accept the Authorization header (not ?token=), so
    // this can't be a plain <a href> link like the documents/ print
    // routes — fetch it through the authenticated client and trigger a
    // browser download from the blob instead.
    downloadBankExport: async (month: number, year: number) => {
      const res = await api.get('/hrms/payroll/bank-export', { params: { month, year }, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `bank-disbursement-${year}-${String(month).padStart(2, '0')}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    },
  },
  loans: {
    list: (userId?: string) => api.get('/hrms/loans', { params: { user_id: userId } }).then(r => r.data),
    create: (data: any) => api.post('/hrms/loans', data).then(r => r.data),
    payoff: (id: string, note?: string) => api.post(`/hrms/loans/${id}/payoff`, { note }).then(r => r.data),
    writeOff: (id: string, note: string) => api.post(`/hrms/loans/${id}/write-off`, { note }).then(r => r.data),
    cancel: (id: string) => api.post(`/hrms/loans/${id}/cancel`).then(r => r.data),
  },
  bonuses: {
    list: (month: number, year: number) => api.get('/hrms/bonuses', { params: { month, year } }).then(r => r.data),
    create: (data: { user_ids: string[]; month: number; year: number; amount: number; reason: string }) =>
      api.post('/hrms/bonuses', data).then(r => r.data),
    delete: (id: string) => api.delete(`/hrms/bonuses/${id}`).then(r => r.data),
  },
  attendance: {
    list: (params?: any) => api.get('/hrms/attendance', { params }).then(r => r.data),
    save: (data: any) => api.post('/hrms/attendance', data).then(r => r.data),
    report: (month: number, year: number, department?: string) =>
      api.get('/hrms/attendance/report', { params: { month, year, department: department || undefined } }).then(r => r.data),
    // SchoolKnot biometric sync (demo integration, config-gated per school).
    syncStatus: () => api.get('/hrms/attendance/sync/status').then(r => r.data),
    // `mapping` is the admin's browser-held email->{school,reg} map; when
    // present it overrides the server default. Kept out of the DB by design.
    sync: (date: string, mapping?: Record<string, { school: string; reg: string }>) =>
      api.post('/hrms/attendance/sync', { date, mapping }).then(r => r.data),
    schoolknotRoster: (date?: string) =>
      api.get('/hrms/attendance/schoolknot/roster', { params: { date } }).then(r => r.data),
  },
  shifts: {
    list: () => api.get('/hrms/shifts').then(r => r.data),
    create: (data: any) => api.post('/hrms/shifts', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/shifts/${id}`, data).then(r => r.data),
    delete: (id: string) => api.delete(`/hrms/shifts/${id}`).then(r => r.data),
  },
  regularizations: {
    list: (params?: any) => api.get('/hrms/attendance/regularizations', { params }).then(r => r.data),
    request: (data: any) => api.post('/hrms/attendance/regularize', data).then(r => r.data),
    workflowAction: (id: string, status: 'approved' | 'rejected', notes?: string) =>
      api.post(`/hrms/attendance/regularizations/${id}/workflow-action`, { status, notes }).then(r => r.data),
  },
  jobPostings: {
    list: (params?: any) => api.get('/hrms/job-postings', { params }).then(r => r.data),
    create: (data: any) => api.post('/hrms/job-postings', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/job-postings/${id}`, data).then(r => r.data),
  },
  applications: {
    list: (params?: any) => api.get('/hrms/applications', { params }).then(r => r.data),
    stats: () => api.get('/hrms/applications/stats').then(r => r.data),
    get: (id: string) => api.get(`/hrms/applications/${id}`).then(r => r.data),
    create: (data: any) => api.post('/hrms/applications', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/applications/${id}`, data).then(r => r.data),
    submitScorecard: (id: string, data: { rating: number, notes?: string }) => api.post(`/hrms/applications/${id}/interviews`, data).then(r => r.data),
  },
  rolePermissions: {
    list: () => api.get('/hrms/role-permissions').then(r => r.data),
    set: (data: any) => api.put('/hrms/role-permissions', data).then(r => r.data),
  },
  reports: {
    headcount: (department?: string) => api.get('/hrms/reports/headcount', { params: { department: department || undefined } }).then(r => r.data),
    leaveSummary: (year?: number, department?: string) => api.get('/hrms/reports/leave-summary', { params: { year, department: department || undefined } }).then(r => r.data),
    payrollSummary: (year?: number, department?: string) => api.get('/hrms/reports/payroll-summary', { params: { year, department: department || undefined } }).then(r => r.data),
    analytics: (year?: number, department?: string, compare?: boolean) =>
      api.get('/hrms/reports/analytics', { params: { year, department: department || undefined, compare: compare || undefined } }).then(r => r.data),
  },
}



export const teamApi = {
  list: () => api.get('/team').then(r => r.data),
  invite: (data: any) => api.post('/team/invite', data).then(r => r.data),
  resetLogin: (id: string, password: string) => api.post(`/team/${id}/reset-login`, { password }).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/team/${id}`, data).then(r => r.data),
  deactivate: (id: string) => api.delete(`/team/${id}`).then(r => r.data),
  extraRoles: () => api.get('/team/extra-roles').then(r => r.data),
  assignRole: (userId: string, roleId: string, departmentScope?: string, stipendAmount?: number) =>
    api.post(`/team/${userId}/roles`, { role_id: roleId, department_scope: departmentScope || undefined, stipend_amount: stipendAmount || undefined }).then(r => r.data),
  removeRole: (userId: string, roleId: string) =>
    api.delete(`/team/${userId}/roles/${roleId}`).then(r => r.data),
  setRoleStipend: (userId: string, roleId: string, stipendAmount: number | null) =>
    api.patch(`/team/${userId}/roles/${roleId}/stipend`, { stipend_amount: stipendAmount }).then(r => r.data),
}



export const workflowApi = {
  getStatus: (applicationId: string) =>
    api.get(`/admission/applications/${applicationId}/workflow-status`).then(r => r.data),

  // section_id is required on the approval that completes the workflow — that
  // action creates the student, and a student without a section is invisible to
  // every section-scoped screen. override_document_gap/override_reason are
  // Phase 5's Principal-only override of the document-completeness gate —
  // ignored server-side (and harmless to send) when there's no gap to override.
  act: (
    applicationId: string, status: 'approved' | 'rejected' | 'escalated' | 'commented', notes?: string, section_id?: string,
    override?: { override_document_gap: boolean; override_reason?: string },
  ) =>
    api.post(`/admission/applications/${applicationId}/workflow-action`, { status, notes, section_id, ...override }).then(r => r.data),

  start: (applicationId: string) =>
    api.post(`/admission/applications/${applicationId}/start-workflow`).then(r => r.data),
}

export const rbacApi = {
  permissionsMe: () => api.get('/rbac/permissions/me').then(r => r.data),
  roles: {
    list: () => api.get('/rbac/roles').then(r => r.data),
    getPermissions: (roleId: string) => api.get(`/rbac/roles/${roleId}/permissions`).then(r => r.data),
    setPermissions: (roleId: string, permission_codes: string[]) =>
      api.put(`/rbac/roles/${roleId}/permissions`, { permission_codes }).then(r => r.data),
  },
  permissions: {
    list: () => api.get('/rbac/permissions').then(r => r.data),
  },
  userRoles: (userId: string) => api.get(`/rbac/users/${userId}/roles`).then(r => r.data),
}

export const homeworkApi = {
  list: (params?: { class_id?: string; section_id?: string; subject_name?: string }) =>
    api.get('/academics/homework', { params }).then(r => r.data),
  create: (data: any) => api.post('/academics/homework', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/academics/homework/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/academics/homework/${id}`).then(r => r.data),
  submit: (id: string, data: { submission_text?: string; file_base64?: string; file_name?: string; mime_type?: string }) =>
    api.post(`/academics/homework/${id}/submit`, data).then(r => r.data),
  submitForStudent: (id: string, studentId: string, data: { submission_text?: string; file_base64?: string; file_name?: string; mime_type?: string }) =>
    api.post(`/academics/homework/${id}/students/${studentId}/submit`, data).then(r => r.data),
  roster: (id: string) => api.get(`/academics/homework/${id}/students`).then(r => r.data),
  remind: (id: string) => api.post(`/academics/homework/${id}/remind`).then(r => r.data),
  grade: (id: string, studentId: string, data: { marks_obtained?: number | null; max_marks?: number | null; feedback?: string | null }) =>
    api.patch(`/academics/homework/${id}/students/${studentId}/grade`, data).then(r => r.data),
  settings: {
    get: () => api.get('/academics/homework-settings').then(r => r.data),
    update: (data: { homework_accept_late_submissions?: boolean; homework_late_grace_days?: number; homework_resubmission_allowed?: boolean }) =>
      api.patch('/academics/homework-settings', data).then(r => r.data),
  },
}

export const syllabusApi = {
  list: (params?: { class_id?: string; section_id?: string; subject_name?: string }) =>
    api.get('/academics/syllabus', { params }).then(r => r.data),
  stats: (params?: { class_id?: string; section_id?: string }) =>
    api.get('/academics/syllabus/stats', { params }).then(r => r.data),
  createChapters: (data: any) => api.post('/academics/syllabus', data).then(r => r.data),
  importChapters: (file: string) => api.post('/academics/syllabus/import-chapters', { file }).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/academics/syllabus/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/academics/syllabus/${id}`).then(r => r.data),
  notes: {
    list: (params?: { class_id?: string; subject_name?: string; from?: string; to?: string }) =>
      api.get('/academics/progress-notes', { params }).then(r => r.data),
    create: (data: any) => api.post('/academics/progress-notes', data).then(r => r.data),
    delete: (id: string) => api.delete(`/academics/progress-notes/${id}`).then(r => r.data),
  },
  documents: {
    list: (params?: { class_id?: string; section_id?: string; subject_name?: string }) =>
      api.get('/academics/syllabus/documents', { params }).then(r => r.data),
    upload: (data: { class_id: string; section_id?: string; subject_name: string; document_name: string; file_base64: string; file_name: string; mime_type?: string }) =>
      api.post('/academics/syllabus/documents', data).then(r => r.data),
    delete: (id: string) => api.delete(`/academics/syllabus/documents/${id}`).then(r => r.data),
  },
}

export const academicsApi = {
  myClasses: () => api.get('/academics/my-classes').then(r => r.data),
}

