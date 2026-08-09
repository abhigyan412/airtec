import { Router } from 'express'
import { authenticate } from '../../shared/middleware/auth'

import heads from './heads'
import structures from './structures'
import assignments from './assignments'
import billing from './billing'
import invoices from './invoices'
import payments from './payments'
import receipts from './receipts'
import discounts from './discounts'
import adhoc from './adhoc'
import requests, { approvalsRouter } from './requests'
import recovery from './recovery'
import gateway, { webhookRouter } from './gateway'
import daybook from './daybook'
import reports from './reports'
import rte from './rte'

// The fee module, rebuilt on the assignment/allocation model.
//
// Grouped by the job each set of endpoints does, which is also how the UI is
// organised: catalogue → plan → assign → bill → collect → recover.
//
// Authentication is applied once here. Authorization is NOT: every route
// declares its own fee.* permission or scope guard, because this module serves
// staff, class teachers and families, and a single blanket rule at this level is
// what previously let /fees/invoices and /fees/defaulters go out to anyone with
// a login.

const router = Router()
router.use(authenticate)

router.use('/heads', heads)               // what the school charges for
router.use('/structures', structures)     // named, versioned plans
router.use('/assignments', assignments)   // who is on which plan (+ optional lines)
router.use('/billing', billing)           // periods, preview, generate
router.use('/invoices', invoices)
router.use('/payments', payments)         // collect: one payment, N allocations
router.use('/receipts', receipts)
router.use('/gateway', gateway)          // pay online: order → provider → capture
router.use('/discounts', discounts)       // concessions, ceilings, scholarships
router.use('/adhoc', adhoc)               // one-off charges, billed as invoices
router.use('/requests', requests)         // waivers, cancellations, refunds
router.use('/approvals', approvalsRouter) // one queue for all of the above
// The one ledger here that is NOT a family's debt: what the state owes for RTE
// seats. Separate because everything else in this module answers "who owes us",
// and the answer there is a government.
router.use('/rte', rte)

// Mounted at the root: /dues, /aging-report, /defaulters, /arrears/*,
// /apply-late-fees, /stats, /classes, /students/:id, /collection-trend.
router.use('/', daybook)   // /daybook, /forecast
router.use('/', recovery)
router.use('/', reports)

/**
 * The provider callback, exported separately so index.ts can mount it AHEAD of
 * the JSON parser and of `authenticate` above — a payment provider has no login,
 * and its signature covers the raw bytes.
 */
export const feeWebhookRoutes = webhookRouter

export default router
