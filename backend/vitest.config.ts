import { defineConfig } from 'vitest/config'

// These tests hit the real Supabase project (see individual test files
// for why — the historical bugs here were about actual DB state, not
// logic a mock would catch), so timeouts need real network headroom.
//
// fileParallelism is off because the live-data invariant test scans the
// entire roles/schools/role_permissions_v2 tables while other test files
// concurrently create and tear down disposable fixture schools — running
// in parallel lets the invariant test catch a fixture mid-flight and fail
// on state that never persisted.
export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
})
