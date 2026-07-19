import { defineConfig } from 'vitest/config'

// These tests hit the real Supabase project (see individual test files
// for why — the historical bugs here were about actual DB state, not
// logic a mock would catch), so timeouts need real network headroom.
export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
