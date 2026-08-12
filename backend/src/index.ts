import 'dotenv/config'
// Side-effect import: pins the process to the school's timezone before anything
// else in this process asks what day it is. Must stay directly below dotenv.
import './shared/utils/timezone'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'
import { SCHOOL_TIMEZONE } from './shared/utils/timezone'
import { toLocalDateStr } from './shared/utils/academicCalendar'
import { activeProvider, paymentConfigError } from './modules/fee/lib/providers'
import { runFeeReminders } from './shared/utils/feeReminders'
import { runDeliveries } from './shared/utils/delivery'
import { runLeaveAccrual, runLeaveYearEnd } from './shared/utils/leavePolicy'
import { runHrAlerts } from './shared/utils/hrAlerts'
import { runAbscondedSweep } from './shared/utils/absconded'

import authRoutes from './modules/auth/routes'
import sisRoutes from './modules/sis/routes'
import hrmsRoutes from './modules/hrms/routes'
import admissionRoutes from './modules/admission/routes'
import feeRoutes, { feeWebhookRoutes } from './modules/fee'
import { reapStaleOrders } from './modules/fee/gateway'
import examRoutes from './modules/exam/routes'
import documentRoutes from './modules/documents/routes'
import { errorHandler, notFoundHandler } from './shared/utils/helpers'
import teamRoutes from './modules/team/routes'
import rbacRoutes from './modules/rbac/routes'
import academicsRoutes from './modules/academics/routes'
import notificationsRoutes from './modules/notifications/routes'
import teacherRoutes from './modules/teacher/routes'
import principalRoutes from './modules/principal/routes'



const app = express()
const PORT = process.env.PORT ?? 4000

app.use(helmet({ contentSecurityPolicy: false }))
// Both frontends proxy /api through their own Next server (see the
// rewrites in each next.config.js), so the browser only ever talks to
// the app's own origin and these requests reach us with no Origin header
// at all — nothing to allowlist, whatever domain the app is served from.
//
// This is only load-bearing for something calling the API cross-origin:
// a build where NEXT_PUBLIC_API_URL was set to an absolute backend URL
// instead of /api (which silently opts out of the proxy), or a separately
// hosted client. Comma-separated, so one deployment can name several
// hostnames without a code change.
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
// Payment webhooks are verified by HMAC over the RAW body, so they must reach
// the handler unparsed — express.json() would re-serialise and the hash would no
// longer match what the provider signed. Mounted ahead of the parser, and ahead
// of the fee module's `authenticate`, because a payment provider has no login.
//
// It needs its own limiter, because mounting it here means the global /api
// limiter further down never sees it — Express matches in registration order and
// this router terminates the request. That left the one unauthenticated,
// publicly reachable, money-moving endpoint in the product with no rate limit at
// all: unbounded HMAC guessing, one crypto compare per attempt, free.
//
// 60/minute is generous for a provider (Razorpay's retry schedule is minutes
// apart) and useless for a guesser.
app.use(
  '/api/fees/gateway/webhook',
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  express.raw({ type: '*/*', limit: '1mb' }),
  feeWebhookRoutes,
)

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
app.use('/api/teacher', teacherRoutes)
app.use('/api/principal', principalRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

// Unresolved payment orders. Hourly, because the number worth watching is not
// how many expired but whether ANY are expiring — a steady trickle means orders
// are being created and never captured, which is what a rotated webhook secret
// or a misconfigured provider dashboard looks like from the inside.
cron.schedule('30 * * * *', () => {
  reapStaleOrders()
    .then(r => { if (r.expired) console.log(`[gateway] reaper expired ${r.expired} order(s)`) })
    .catch(err => console.error('[gateway] reaper failed:', err))
})

// Daily fee due/overdue reminder sweep, 7:00 AM server time, across
// every school (there's no per-request school_id here — this is the
// unattended background job; the admin-triggered POST
// /notifications/run-fee-reminders endpoint is the per-school
// equivalent for testing or hosts where a long-lived cron isn't
// guaranteed to actually fire).
cron.schedule('0 7 * * *', () => {
  runFeeReminders()
    // skipped_not_owed_by_family is printed because it is the signal that a
    // student is miscategorised — the number the sweep's own comment says to
    // watch, and which nothing ever showed anybody.
    .then(result => console.log(
      `[fee-reminders] checked ${result.checked} invoices, notified for ${result.notified}, ` +
      `skipped ${result.skipped_not_owed_by_family} not owed by the family`))
    .catch(err => console.error('[fee-reminders] failed:', err))
})

// Drain the delivery outbox every minute. createNotification() also nudges
// it via setImmediate, so this tick is the safety net for retries and for
// anything enqueued while the worker was busy — not the primary path.
//
// Same caveat as the fee sweep above: an in-process schedule only runs
// while the process is up, which on a host that sleeps when idle means it
// may never fire. POST /notifications/run-deliveries is the external-
// scheduler equivalent (design.md §7).
cron.schedule('* * * * *', () => {
  runDeliveries().catch(err => console.error('[delivery] tick failed:', err?.message))
})

// Monthly leave accrual, 1st of the month, across every school. Same
// unattended-sweep + manual-trigger-is-the-real-safety-net caveat as
// the two jobs above — POST /hrms/leave-accrual/run is the per-school
// equivalent.
cron.schedule('0 2 1 * *', () => {
  runLeaveAccrual()
    .then(result => console.log(`[leave-accrual] checked ${result.checked} leave types, credited ${result.credited} balances`))
    .catch(err => console.error('[leave-accrual] failed:', err))
})

// Year-end leave carry-forward/encashment processing, Jan 1st, across
// every school, for the year that just ended. POST /hrms/leave-year-end/run
// is the per-school equivalent.
cron.schedule('0 3 1 1 *', () => {
  runLeaveYearEnd()
    .then(result => console.log(`[leave-year-end] checked ${result.checked} leave types, processed ${result.processed} balances`))
    .catch(err => console.error('[leave-year-end] failed:', err))
})

// Daily HR alerts sweep (probation ending, documents/contracts
// expiring, work anniversaries), 8:00 AM server time, across every
// school. Same unattended-sweep + manual-trigger-is-the-real-safety-net
// caveat as the jobs above — POST /hrms/hr-alerts/run is the per-school
// equivalent.
cron.schedule('0 8 * * *', () => {
  runHrAlerts()
    .then(result => console.log(`[hr-alerts] probation:${result.probationNotified} documents:${result.documentsNotified} anniversaries:${result.anniversariesNotified}`))
    .catch(err => console.error('[hr-alerts] failed:', err))
})

// Daily absconded-staff sweep, 8:15 AM server time (just after HR
// alerts), across every school. POST /hrms/absconded/run is the
// per-school manual equivalent.
cron.schedule('15 8 * * *', () => {
  runAbscondedSweep()
    .then(result => console.log(`[absconded] flagged:${result.flagged} auto-set:${result.autoSet}`))
    .catch(err => console.error('[absconded] failed:', err))
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
  console.log(`  CORS allows: ${allowedOrigins.join(', ') || '(nothing configured — set ALLOWED_ORIGINS)'}`)
  console.log(`  Timezone:    ${SCHOOL_TIMEZONE} (today is ${toLocalDateStr(new Date())})`)

  // Said at boot rather than discovered by a parent. A misconfigured gateway
  // does not stop the rest of the ERP — attendance and exams have nothing to do
  // with Razorpay — but it must not be silent either, because the failure mode
  // it replaces was a deployment quietly running the simulator.
  const gatewayProblem = paymentConfigError()
  if (gatewayProblem) {
    console.error(`  PAYMENTS:    DISABLED — ${gatewayProblem}\n`)
  } else {
    const provider = activeProvider()
    console.log(
      `  Payments:    ${provider.name}${provider.isSimulated ? ' (SIMULATED — moves no money)' : ''}\n`,
    )
  }
})

export default app