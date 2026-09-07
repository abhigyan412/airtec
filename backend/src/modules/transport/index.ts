import { Router } from 'express'
import { authenticate } from '../../shared/middleware/auth'

import settings from './settings.routes'

// The transport module, split by sub-domain from day one (fleet/network/
// trips land in later phases as their own files) rather than growing into
// a single-file dumping ground the way hrms/routes.ts and
// admission/routes.ts did.
//
// Authentication is applied once here; authorization is not — every route
// declares its own transport.* permission guard.

const router = Router()
router.use(authenticate)

router.use('/settings', settings)

export default router
