import { Router } from 'express'
import { authenticate } from '../../shared/middleware/auth'

import settings from './settings.routes'
import catalog from './catalog.routes'
import acquisition from './acquisition.routes'
import circulation from './circulation.routes'

// The library module, split by sub-domain from day one (catalog/
// circulation/fines/acquisition land in their own files as each phase
// ships) rather than growing into a single-file dumping ground the way
// hrms/routes.ts and admission/routes.ts did.
//
// Authentication is applied once here; authorization is not — every
// route declares its own library.* permission guard.

const router = Router()
router.use(authenticate)

router.use('/settings', settings)
router.use('/catalog', catalog)
router.use('/acquisition', acquisition)
router.use('/circulation', circulation)

export default router
