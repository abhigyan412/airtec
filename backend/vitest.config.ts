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
    // Several modules import the Supabase client at module scope, which
    // throws without credentials — load .env for every test file rather
    // than repeating `import 'dotenv/config'` in each one.
    setupFiles: ['dotenv/config'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Scope: the shared layer — utilities and middleware. This is where
      // the real invariants live (document numbering, delivery, auth,
      // permissions, workflow transitions) and what every route depends
      // on, so a regression here breaks many endpoints at once.
      //
      // The route modules (~7k of the ~11k source lines) are deliberately
      // outside the threshold. They are thin Express wrappers whose bodies
      // are almost entirely Supabase query construction; driving them to
      // 90% means a live-DB round trip per branch, which buys slow, flaky
      // tests that mostly assert the query builder still builds queries.
      // Where a route did contain real logic it was extracted into
      // shared/ and is covered here — buildStudentSearchFilter is the
      // model for that.
      include: ['src/shared/**/*.ts'],
      exclude: ['src/shared/types/**', 'src/shared/db/**', '**/__tests__/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
      },
    },
  },
})
