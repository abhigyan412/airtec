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
      'principal@rashtrabharti.school': '4680', // Mohd. Wajihul Islam
      'krishna@no-login.invalid': '72',
      'basundhara@no-login.invalid': '73',
      'artipal@no-login.invalid': '4727',
      'payal@no-login.invalid': '4728',
      'poojarai@no-login.invalid': '90',
      'reetika@no-login.invalid': '4726',
      'heena@no-login.invalid': '95',
      'nehajoshi@no-login.invalid': '74',
      'nehamishra@no-login.invalid': '87',
      'sajida@no-login.invalid': '63',
      'mamta@no-login.invalid': '4707',
      'nehasingh@no-login.invalid': '91',
      'mrinalini@no-login.invalid': '85',
      'nupur@no-login.invalid': '4697',
      'shivam@no-login.invalid': '86',
      'kunal@no-login.invalid': '4725',
      'komal@no-login.invalid': '79',
      'ayushi@no-login.invalid': '59',
      'priyanka@no-login.invalid': '45',
      'vishnu@no-login.invalid': '56',
      'nehasri@no-login.invalid': '20',   // NEHA SRIVASTAVA (vs the other Nehas)
      'shabeena@no-login.invalid': '449', // SHABEENA SHAHNAZ (vs SHABEENA, TA013)
    },
  },
}

export function getSchoolknotConfig(schoolId: string): SchoolknotSchoolConfig | null {
  return SCHOOLKNOT_CONFIG[schoolId] ?? null
}
