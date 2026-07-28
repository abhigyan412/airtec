import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'
import { runFeeReminders } from './shared/utils/feeReminders'

import authRoutes from './modules/auth/routes'
import sisRoutes from './modules/sis/routes'
import hrmsRoutes from './modules/hrms/routes'
import admissionRoutes from './modules/admission/routes'
import feeRoutes from './modules/fee/routes'
import examRoutes from './modules/exam/routes'
import documentRoutes from './modules/documents/routes'
import { errorHandler, notFoundHandler } from './shared/utils/helpers'
import teamRoutes from './modules/team/routes'
import rbacRoutes from './modules/rbac/routes'
import academicsRoutes from './modules/academics/routes'
import notificationsRoutes from './modules/notifications/routes'



const app = express()
const PORT = process.env.PORT ?? 4000

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000', credentials: true }))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }))
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300 }))

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'airtec-api' }))

app.use('/api/auth', authRoutes)
app.use('/api/students', sisRoutes)
app.use('/api/admission', admissionRoutes)
app.use('/api/fees', feeRoutes)
app.use('/api/exams', examRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/hrms', hrmsRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/rbac', rbacRoutes)
app.use('/api/academics', academicsRoutes)
app.use('/api/notifications', notificationsRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

// Daily fee due/overdue reminder sweep, 7:00 AM server time, across
// every school (there's no per-request school_id here — this is the
// unattended background job; the admin-triggered POST
// /notifications/run-fee-reminders endpoint is the per-school
// equivalent for testing or hosts where a long-lived cron isn't
// guaranteed to actually fire).
cron.schedule('0 7 * * *', () => {
  runFeeReminders()
    .then(result => console.log(`[fee-reminders] checked ${result.checked} invoices, notified for ${result.notified}`))
    .catch(err => console.error('[fee-reminders] failed:', err))
})

app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────┐
  │   AIRTEC API running on :${PORT}       │
  └─────────────────────────────────────┘
  `)
})

export default app