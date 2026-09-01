// ── SchoolKnot sync config (DEMO — code-level, no DB schema) ──────────
//
// This is a temporary integration for a week-long demo. Deliberately a code
// file, not database columns: teardown is `git rm` of the three schoolknot.*
// files + the route/api/UI hooks, with nothing left behind in the schema.
//
// Keyed by airtec school_id. A school appears here ONLY if it should sync,
// which is what scopes the feature to Rashtra Bharti — no entry, no button.
//
// `regByEmail` maps an airtec staff login email -> SchoolKnot device reg_id.
// Email (not user_id) so the map stays readable and portable across environments.
// The 21 entries below are the confident name matches; the handful of airtec
// staff with no clean SchoolKnot counterpart (and the ambiguous Neha/Shabeena
// rows) are intentionally omitted — an unmapped person is simply skipped.

export interface SchoolknotSchoolConfig {
  /** SchoolKnot's own school id, e.g. "SC3102". */
  schoolknotSchoolId: string
  /** airtec staff email -> SchoolKnot reg_id. */
  regByEmail: Record<string, string>
}

export const SCHOOLKNOT_CONFIG: Record<string, SchoolknotSchoolConfig> = {
  // Rashtra Bharti Public Inter College
  'd400bc23-9534-4410-af92-5563990f2b27': {
    schoolknotSchoolId: 'SC3102',
    regByEmail: {
      'principal@gmail.com': '4680', // Mohd. Wajihul Islam
      'krishna@gmail.com': '72',
      'basundhara@gmail.com': '73',
      'artipal@gmail.com': '4727',
      'payal@gmail.com': '4728',
      'poojarai@gmail.com': '90',
      'reetika@gmail.com': '4726',
      'heena@gmail.com': '95',
      'nehajoshi@gmail.com': '74',
      'nehamishra@gmail.com': '87',
      'sajida@gmail.com': '63',
      'mamta@gmail.com': '4707',
      'nehasingh@gmail.com': '91',
      'mrinalini@gmail.com': '85',
      'nupur@gmail.com': '4697',
      'shivam@gmail.com': '86',
      'kunal@gmail.com': '4725',
      'komal@gmail.com': '79',
      'ayushi@gmail.com': '59',
      'priyanka@gmail.com': '45',
      'vishnu@gmail.com': '56',
      'nehasri@gmail.com': '20',   // NEHA SRIVASTAVA (vs the other Nehas)
      'shabeena@gmail.com': '449', // SHABEENA SHAHNAZ (vs SHABEENA, TA013)
    },
  },
}

export function getSchoolknotConfig(schoolId: string): SchoolknotSchoolConfig | null {
  return SCHOOLKNOT_CONFIG[schoolId] ?? null
}
