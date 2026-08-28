import axios, { AxiosError } from 'axios'

// This app only ever calls a small, read-mostly slice of the backend
// API — the same one used by the (portal) route group before the
// staff/family split. Trimmed down from the staff app's much larger
// lib/api.ts rather than sharing it wholesale, since this app has no
// use for admission/HR/RBAC/etc. Deliberately duplicated, not shared
// via a workspace package — see the split's design note if this ever
// needs revisiting (auth/API-client drift between the two apps is the
// tradeoff being made here).

// Same-origin by default: the browser hits this Next server at /api and
// the rewrite in next.config.js proxies it to the backend. Keeps the app
// on one origin, so no CORS allowlist entry is needed per deployed
// hostname. Override only if you deliberately want cross-origin calls.
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
// screen mid-session. On a 401 we spend the stored refresh_token once,
// then replay the original request.
//
// The in-flight promise is shared: a page fires several queries at once
// and they all 401 together — they must queue behind ONE refresh, or
// they'd each burn the refresh token and the losers would fail against
// an already-rotated token.
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
  /**
   * The family's whole fee position. Was pointed at /fees/student-summary, which
   * the fee rewrite removed — the route is /fees/students/:id and it is the same
   * read the school's own Collect screen uses, so the two can never disagree
   * about what is owed.
   */
  student: (studentId: string) =>
    api.get(`/fees/students/${studentId}`).then(r => r.data),

  /**
   * Paying online.
   *
   * The amount is a suggestion — the server re-derives it from what is actually
   * outstanding and caps it — and the student is taken from the caller's own
   * scope, never from anything this client sends.
   */
  gateway: {
    createOrder: (data?: { amount?: number; invoice_ids?: string[] }) =>
      api.post('/fees/gateway/orders', data ?? {}).then(r => r.data),
    get: (orderId: string) =>
      api.get(`/fees/gateway/orders/${orderId}`).then(r => r.data),
    /** Stands in for a checkout page while no provider is configured. */
    simulate: (orderId: string, outcome: 'paid' | 'failed' = 'paid') =>
      api.post(`/fees/gateway/orders/${orderId}/simulate`, { outcome }).then(r => r.data),
  },
}

export const homeworkApi = {
  list: (params?: { class_id?: string; section_id?: string; subject_name?: string }) =>
    api.get('/academics/homework', { params }).then(r => r.data),
  submit: (id: string, data: { submission_text?: string; file_base64?: string; file_name?: string; mime_type?: string }) =>
    api.post(`/academics/homework/${id}/submit`, data).then(r => r.data),
  settings: {
    get: () => api.get('/academics/homework-settings').then(r => r.data),
  },
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
