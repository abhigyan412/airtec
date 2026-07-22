import axios, { AxiosError } from 'axios'

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

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

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('airtec_token')
      localStorage.removeItem('airtec_user')
      window.location.href = '/auth/login'
    }
    return Promise.reject(error)
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

export const studentsApi = {
  list: (params?: Record<string, any>) =>
    api.get('/students', { params }).then(r => r.data),
  get: (id: string) =>
    api.get(`/students/${id}`).then(r => r.data),
  create: (data: any) =>
    api.post('/students', data).then(r => r.data),
  update: (id: string, data: any) =>
    api.patch(`/students/${id}`, data).then(r => r.data),
  stats: () =>
    api.get('/students/stats/dashboard').then(r => r.data),
  bulkPromote: (data: any) =>
    api.post('/students/bulk/promote', data).then(r => r.data),
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
  getClassAttendance: (classId: string, date: string, sectionId?: string) =>
    api.get('/students/attendance/class', { params: { class_id: classId, date, section_id: sectionId } }).then(r => r.data),
  saveAttendance: (data: any) =>
    api.post('/students/attendance', data).then(r => r.data),
  tc: {
    request: (id: string, data: any) => api.post(`/students/${id}/tc`, data).then(r => r.data),
    list: (id: string) => api.get(`/students/${id}/tc`).then(r => r.data),
    workflowStatus: (id: string, tcId: string) =>
      api.get(`/students/${id}/tc/${tcId}/workflow-status`).then(r => r.data),
    workflowAction: (id: string, tcId: string, status: 'approved' | 'rejected', notes?: string) =>
      api.post(`/students/${id}/tc/${tcId}/workflow-action`, { status, notes }).then(r => r.data),
  },
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

