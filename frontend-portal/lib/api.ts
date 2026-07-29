import axios, { AxiosError } from 'axios'

// This app only ever calls a small, read-mostly slice of the backend
// API — the same one used by the (portal) route group before the
// staff/family split. Trimmed down from the staff app's much larger
// lib/api.ts rather than sharing it wholesale, since this app has no
// use for admission/HR/RBAC/etc. Deliberately duplicated, not shared
// via a workspace package — see the split's design note if this ever
// needs revisiting (auth/API-client drift between the two apps is the
// tradeoff being made here).

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
}

export const studentsApi = {
  me: () => api.get('/students/me').then(r => r.data),
  getAttendanceReport: (classId: string, month: number, year: number, sectionId?: string) =>
    api.get('/students/attendance/report', { params: { class_id: classId, month, year, section_id: sectionId || undefined } }).then(r => r.data),
  getAttendanceReportRange: (classId: string, from: string, to: string, sectionId?: string) =>
    api.get('/students/attendance/report', { params: { class_id: classId, from, to, section_id: sectionId || undefined } }).then(r => r.data),
}

export const academicYearsApi = {
  list: () => api.get('/admission/academic-years').then(r => r.data),
}

export const feeApi = {
  studentSummary: (studentId: string) =>
    api.get(`/fees/student-summary/${studentId}`).then(r => r.data),
}

export const homeworkApi = {
  list: (params?: { class_id?: string; section_id?: string; subject_name?: string }) =>
    api.get('/academics/homework', { params }).then(r => r.data),
}

export const timetableApi = {
  get: (params?: any) => api.get('/students/timetable', { params }).then(r => r.data),
}

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unread_only?: boolean }) =>
    api.get('/notifications', { params }).then(r => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then(r => r.data),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then(r => r.data),
}
