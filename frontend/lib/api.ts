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
  reportCard: (examId: string, studentId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''
    return `${API_BASE}/documents/report-card/${examId}/${studentId}?token=${token}`
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
    stats: () =>
      api.get('/admission/inquiries/stats').then(r => r.data),
    addFollowUp: (id: string, data: any) =>
      api.post(`/admission/inquiries/${id}/follow-ups`, data).then(r => r.data),
    convertToApplication: (id: string) =>
      api.post(`/admission/inquiries/${id}/convert-to-application`).then(r => r.data),
    academicYears: () => api.get('/admission/academic-years').then(r => r.data),
    sources: {
      list: () => api.get('/admission/inquiry-sources').then(r => r.data),
      create: (name: string) => api.post('/admission/inquiry-sources', { name }).then(r => r.data),
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
  },
  
  classes: () =>
    api.get('/admission/classes').then(r => r.data),
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
    list: () => api.get('/fees/heads').then(r => r.data),
    create: (data: any) => api.post('/fees/heads', data).then(r => r.data),
  },
  structures: {
    list: (params?: Record<string, any>) =>
      api.get('/fees/structures', { params }).then(r => r.data),
    create: (data: any) =>
      api.post('/fees/structures', data).then(r => r.data),
    update: (id: string, data: any) =>
      api.patch(`/fees/structures/${id}`, data).then(r => r.data),
  },
  invoices: {
    list: (params?: Record<string, any>) =>
      api.get('/fees/invoices', { params }).then(r => r.data),
    create: (data: any) =>
      api.post('/fees/invoices', data).then(r => r.data),
  },
  payments: {
    record: (data: any) =>
      api.post('/fees/payments', data).then(r => r.data),
  },
  dues: (params?: Record<string, any>) =>
    api.get('/fees/dues', { params }).then(r => r.data),
  collectionTrend: (months?: number) =>
    api.get('/fees/collection-trend', { params: { months } }).then(r => r.data),
  collectionTrendRange: (from: string, to: string) =>
    api.get('/fees/collection-trend', { params: { from, to } }).then(r => r.data),
  arrears: {
    list: (params?: Record<string, any>) =>
      api.get('/fees/arrears', { params }).then(r => r.data),
    carryForward: (fromAcademicYearId: string, toAcademicYearId: string) =>
      api.post('/fees/arrears/carry-forward', {
        from_academic_year_id: fromAcademicYearId,
        to_academic_year_id: toAcademicYearId,
      }).then(r => r.data),
    recordPayment: (id: string, data: any) =>
      api.post(`/fees/arrears/${id}/payment`, data).then(r => r.data),
    waive: (id: string, reason: string) =>
      api.patch(`/fees/arrears/${id}/waive`, { reason }).then(r => r.data),
  },
   discounts: {
    list: (params?: Record<string, any>) =>
      api.get('/fees/discounts', { params }).then(r => r.data),
    create: (data: any) =>
      api.post('/fees/discounts', data).then(r => r.data),
    workflowStatus: (id: string) =>
      api.get(`/fees/discounts/${id}/workflow-status`).then(r => r.data),
    workflowAction: (id: string, status: 'approved' | 'rejected', notes?: string) =>
      api.post(`/fees/discounts/${id}/workflow-action`, { status, notes }).then(r => r.data),
  
  },
  stats: (params?: Record<string, any>) =>
    api.get('/fees/stats', { params }).then(r => r.data),
  studentSummary: (studentId: string) =>
    api.get(`/fees/student-summary/${studentId}`).then(r => r.data),

  agingReport: () => api.get('/fees/aging-report').then(r => r.data),
  defaulters: (minDaysOverdue?: number) =>
    api.get('/fees/defaulters', { params: { min_days_overdue: minDaysOverdue } }).then(r => r.data),
  discountLimits: {
    list: () => api.get('/fees/discount-limits').then(r => r.data),
    update: (roleId: string, data: any) => api.put(`/fees/discount-limits/${roleId}`, data).then(r => r.data),
  },
  applyLateFines: () => api.post('/fees/apply-late-fines').then(r => r.data),
  installments: {
    list: (invoiceId: string) => api.get(`/fees/invoices/${invoiceId}/installments`).then(r => r.data),
    create: (invoiceId: string, installments: any[]) =>
      api.post(`/fees/invoices/${invoiceId}/installments`, { installments }).then(r => r.data),
    pay: (installmentId: string, data: any) =>
      api.post(`/fees/installments/${installmentId}/pay`, data).then(r => r.data),
  },
 
}


export const adhocFeeApi = {
  list: (params?: any) =>
    api.get('/fees/adhoc', { params }).then(r => r.data),
  create: (data: any) =>
    api.post('/fees/adhoc', data).then(r => r.data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/fees/adhoc/${id}`, { status }).then(r => r.data),
}
export const timetableApi = {
  get: (params?: any) => api.get('/students/timetable', { params }).then(r => r.data),
  save: (periods: any[]) => api.post('/students/timetable', { periods }).then(r => r.data),
  delete: (id: string) => api.delete(`/students/timetable/${id}`).then(r => r.data),
  freeFaculty: (dayOfWeek: number, periodNumber?: number) =>
    api.get('/students/timetable/free-faculty', { params: { day_of_week: dayOfWeek, period_number: periodNumber } }).then(r => r.data),
  attentionRequired: () =>
    api.get('/students/timetable/attention-required').then(r => r.data),
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
  list: (params?: { page?: number; limit?: number; unread_only?: boolean }) =>
    api.get('/notifications', { params }).then(r => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then(r => r.data),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then(r => r.data),
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
  },
  leaveTypes: {
    list: () => api.get('/hrms/leave-types').then(r => r.data),
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
  salaryStructure: {
    get: (userId: string) => api.get(`/hrms/salary-structure/${userId}`).then(r => r.data),
    set: (data: any) => api.put('/hrms/salary-structure', data).then(r => r.data),
  },
  payslips: {
    list: (params?: any) => api.get('/hrms/payslips', { params }).then(r => r.data),
    generate: (data: any) => api.post('/hrms/payslips/generate', data).then(r => r.data),
    update: (id: string, data: any) => api.patch(`/hrms/payslips/${id}`, data).then(r => r.data),
    approve: (id: string) => api.post(`/hrms/payslips/${id}/approve`).then(r => r.data),
  },
  payroll: {
    summary: (params?: any) => api.get('/hrms/payroll/summary', { params }).then(r => r.data),
  },
  attendance: {
    list: (params?: any) => api.get('/hrms/attendance', { params }).then(r => r.data),
    save: (data: any) => api.post('/hrms/attendance', data).then(r => r.data),
    report: (month: number, year: number, department?: string) =>
      api.get('/hrms/attendance/report', { params: { month, year, department: department || undefined } }).then(r => r.data),
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
  },
  rolePermissions: {
    list: () => api.get('/hrms/role-permissions').then(r => r.data),
    set: (data: any) => api.put('/hrms/role-permissions', data).then(r => r.data),
  },
  reports: {
    headcount: () => api.get('/hrms/reports/headcount').then(r => r.data),
    leaveSummary: (year?: number) => api.get('/hrms/reports/leave-summary', { params: { year } }).then(r => r.data),
    payrollSummary: (year?: number) => api.get('/hrms/reports/payroll-summary', { params: { year } }).then(r => r.data),
  },
}



export const teamApi = {
  list: () => api.get('/team').then(r => r.data),
  invite: (data: any) => api.post('/team/invite', data).then(r => r.data),
  resetLogin: (id: string, password: string) => api.post(`/team/${id}/reset-login`, { password }).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/team/${id}`, data).then(r => r.data),
  deactivate: (id: string) => api.delete(`/team/${id}`).then(r => r.data),
  extraRoles: () => api.get('/team/extra-roles').then(r => r.data),
  assignRole: (userId: string, roleId: string) =>
    api.post(`/team/${userId}/roles`, { role_id: roleId }).then(r => r.data),
  removeRole: (userId: string, roleId: string) =>
    api.delete(`/team/${userId}/roles/${roleId}`).then(r => r.data),
}



export const workflowApi = {
  getStatus: (applicationId: string) =>
    api.get(`/admission/applications/${applicationId}/workflow-status`).then(r => r.data),

  act: (applicationId: string, status: 'approved' | 'rejected' | 'escalated' | 'commented', notes?: string) =>
    api.post(`/admission/applications/${applicationId}/workflow-action`, { status, notes }).then(r => r.data),

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
  delete: (id: string) => api.delete(`/academics/homework/${id}`).then(r => r.data),
}

export const syllabusApi = {
  list: (params?: { class_id?: string; section_id?: string; subject_name?: string }) =>
    api.get('/academics/syllabus', { params }).then(r => r.data),
  stats: (params?: { class_id?: string; section_id?: string }) =>
    api.get('/academics/syllabus/stats', { params }).then(r => r.data),
  createChapters: (data: any) => api.post('/academics/syllabus', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/academics/syllabus/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/academics/syllabus/${id}`).then(r => r.data),
  notes: {
    list: (params?: { class_id?: string; subject_name?: string; from?: string; to?: string }) =>
      api.get('/academics/progress-notes', { params }).then(r => r.data),
    create: (data: any) => api.post('/academics/progress-notes', data).then(r => r.data),
    delete: (id: string) => api.delete(`/academics/progress-notes/${id}`).then(r => r.data),
  },
}

export const academicsApi = {
  myClasses: () => api.get('/academics/my-classes').then(r => r.data),
}

