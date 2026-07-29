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
// Two separate frontend apps call this API: the staff admin app and the
// parent/student family app. Each var accepts a COMMA-SEPARATED list, so
// one deployment can serve several hostnames (apex + www, a preview
// domain, a custom domain) without a code change — previously each var
// held exactly one origin, so any additional domain got a blanket
// "not allowed by CORS" with no way to add it from config.
//
// ALLOWED_ORIGINS is the catch-all if you'd rather not think about which
// app a hostname belongs to.
const parseOrigins = (...values: (string | undefined)[]) =>
  values
    .flatMap(v => (v ?? '').split(','))
    .map(s => s.trim().replace(/\/$/, ''))   // tolerate a trailing slash
    .filter(Boolean)

const configuredOrigins = parseOrigins(
  process.env.ALLOWED_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.FAMILY_FRONTEND_URL,
)

// Local dev origins stay allowed unless this is production, so setting
// the prod domains doesn't break everyone's laptop.
const allowedOrigins = Array.from(new Set([
  ...configuredOrigins,
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:3001']),
]))

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = same-origin, curl, or a server-side call.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true)
    // Log the rejection: the browser only ever shows a generic CORS
    // failure, which is impossible to diagnose from the client side.
    console.warn(`[cors] blocked origin ${origin} — allowed: ${allowedOrigins.join(', ') || '(none configured)'}`)
    // Deny by withholding the CORS headers rather than throwing. Throwing
    // turned every unlisted origin into a 500 from the error handler,
    // which reads like the API is broken; the browser blocks the response
    // either way, and the warning above is the real diagnostic.
    callback(null, false)
  },
  credentials: true,
}))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))

// Brute-force protection, scoped to the endpoints where a guess is
// actually worth something. It used to sit on all of /api/auth, which
// swept in /auth/me — fired on every single page load — and /auth/refresh,
// the silent re-auth path. Twenty requests per 15 minutes is nothing for
// those two (a dozen page loads exhausts it), and since the limiter keys
// on IP, everyone behind one office NAT shared the same tiny budget:
// normal use locked itself out with 429s that look exactly like a broken
// login.
const credentialLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })
app.use('/api/auth/login', credentialLimiter)
app.use('/api/auth/register-school', credentialLimiter)

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
  // Printed because a CORS rejection is invisible from the browser — it
  // surfaces as a generic network failure with no hint of what the server
  // would have accepted.
  console.log(`  CORS allows: ${allowedOrigins.join(', ') || '(nothing configured — set ALLOWED_ORIGINS)'}\n`)
})

export default app