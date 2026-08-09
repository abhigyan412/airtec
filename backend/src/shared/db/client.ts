import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import ws from 'ws'
const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
}

// Service role client — bypasses RLS for server-side operations
// Always validate school_id manually in service layer
export const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: ws,
  },
})

// Throwaway auth-only client factory — for signInWithPassword/refreshSession.
// Those two GoTrue calls (unlike auth.admin.*, which are plain REST calls)
// mutate whatever client instance they're called on: they overwrite that
// client's in-memory session, and every later request through it starts
// authorizing as that session's user instead of the apikey it was built
// with. Calling them on the shared `supabase` singleton above silently
// downgraded EVERY concurrent request on the whole backend — for every
// school, not just the one logging in — from service-role to whichever
// user last logged in, until the next login overwrote it again. RLS being
// disabled on most tables masked this; it surfaced as an intermittent,
// unrelated-looking "row violates row-level security policy" on the first
// table/bucket that actually had RLS enforced. A fresh client per call
// has no shared state to corrupt, and never needs to persist a session —
// only the tokens in its response are ever used.
export const createAuthClient = () => {
  return createClient<Database>(supabaseUrl, process.env.SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: ws,
    },
  })
}

// User-scoped client factory — respects RLS
export const createUserClient = (accessToken: string) => {
  return createClient<Database>(supabaseUrl, process.env.SUPABASE_ANON_KEY!, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
