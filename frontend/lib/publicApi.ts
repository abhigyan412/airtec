import axios from 'axios'
import { API_BASE } from './api'

// Deliberately a separate axios instance from `api` in lib/api.ts, not a
// reused one scoped to a different baseURL — that instance attaches a
// bearer token from localStorage if one exists and hard-logs-out the
// browser on a 401. Neither behavior belongs on a public, logged-out page:
// a staff member who happens to open this link in the same browser they're
// signed in on must never have their session touched by it.
const publicApi = axios.create({
  baseURL: `${API_BASE}/public`,
  headers: { 'Content-Type': 'application/json' },
})

export const publicAdmissionApi = {
  info: (schoolId: string) =>
    publicApi.get(`/schools/${schoolId}/admission-info`).then(r => r.data),
  submitInquiry: (schoolId: string, data: {
    student_name: string; date_of_birth?: string; gender?: string
    parent_name: string; parent_phone: string; parent_email?: string
    applying_for_class_id?: string; previous_school?: string; notes?: string
    company?: string
  }) => publicApi.post(`/schools/${schoolId}/inquiries`, data).then(r => r.data),
  status: (schoolId: string, inquiryId: string) =>
    publicApi.get(`/schools/${schoolId}/inquiries/${inquiryId}/status`).then(r => r.data),
  uploadDocument: (schoolId: string, inquiryId: string, data: {
    file_base64: string; file_name: string; mime_type?: string; document_type: string
  }) => publicApi.post(`/schools/${schoolId}/inquiries/${inquiryId}/documents`, data).then(r => r.data),
  slots: (schoolId: string, inquiryId: string) =>
    publicApi.get(`/schools/${schoolId}/inquiries/${inquiryId}/slots`).then(r => r.data),
  bookSlot: (schoolId: string, inquiryId: string, slotId: string) =>
    publicApi.post(`/schools/${schoolId}/inquiries/${inquiryId}/slots/${slotId}/book`).then(r => r.data),
}
