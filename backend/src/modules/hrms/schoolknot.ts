// ── SchoolKnot biometric adapter ────────────────────────────────────
//
// The one seam that talks to SchoolKnot. Everything else in the sync deals
// in airtec users and staff_attendance rows and knows nothing about the
// provider — same shape as the payment-provider adapter in the fee module.
//
// The captured browser request carried no auth (only content-type + CORS
// headers), so none is sent. If SchoolKnot ever starts requiring a session
// cookie, add it here from an env var; no caller changes.

const BASE_URL = process.env.SCHOOLKNOT_BASE_URL || 'https://analytics.schoolknot.com'
const PATH = '/staff_attendance/get_staff_attendance'
const TIMEOUT_MS = 30_000

/** One staff row as SchoolKnot returns it. Only the fields we use are typed. */
export interface SchoolknotRow {
  reg_id: string
  biometric_id: string | null
  first_name: string | null
  in_time: string | null       // 'HH:MM:SS' local, or null when no punch
  out_time: string | null
  status: number | string      // employee CATEGORY (1/2), not present/absent
}

/**
 * Fetch one day's staff attendance for a SchoolKnot school id (e.g. "SC3102").
 * Returns the raw roster rows; deriving present/absent is the caller's job.
 * Throws on transport failure or a non-"success" payload so the route can
 * turn either into a clear 502 rather than silently writing nothing.
 */
export async function fetchSchoolknotDay(schoolknotSchoolId: string, date: string): Promise<SchoolknotRow[]> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        origin: 'https://schoolknot.com',
        referer: 'https://schoolknot.com/',
      },
      body: JSON.stringify({ school_id: schoolknotSchoolId, date, status: '', department: '' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' ? `no response in ${TIMEOUT_MS / 1000}s` : (err?.message ?? 'network error')
    throw new Error(`Could not reach SchoolKnot: ${reason}`)
  }

  if (!res.ok) throw new Error(`SchoolKnot responded ${res.status} ${res.statusText}`)

  let payload: any
  try { payload = await res.json() } catch { throw new Error('SchoolKnot returned a non-JSON response') }

  if (payload?.status !== 'success') {
    throw new Error(`SchoolKnot returned status=${JSON.stringify(payload?.status ?? null)}`)
  }
  return (payload.data ?? []) as SchoolknotRow[]
}
