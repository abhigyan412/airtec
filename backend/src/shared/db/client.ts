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
