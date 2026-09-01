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
      'principal.rashtrabharti@gmail.com': '4680', // Mohd. Wajihul Islam
      'krishna.rashtrabharti@gmail.com': '72',
      'basundhara.rashtrabharti@gmail.com': '73',
      'artipal.rashtrabharti@gmail.com': '4727',
      'payal.rashtrabharti@gmail.com': '4728',
      'poojarai.rashtrabharti@gmail.com': '90',
      'reetika.rashtrabharti@gmail.com': '4726',
      'heena.rashtrabharti@gmail.com': '95',
      'nehajoshi.rashtrabharti@gmail.com': '74',
      'nehamishra.rashtrabharti@gmail.com': '87',
      'sajida.rashtrabharti@gmail.com': '63',
      'mamta.rashtrabharti@gmail.com': '4707',
      'nehasingh.rashtrabharti@gmail.com': '91',
      'mrinalini.rashtrabharti@gmail.com': '85',
      'nupur.rashtrabharti@gmail.com': '4697',
      'shivam.rashtrabharti@gmail.com': '86',
      'kunal.rashtrabharti@gmail.com': '4725',
      'komal.rashtrabharti@gmail.com': '79',
      'ayushi.rashtrabharti@gmail.com': '59',
      'priyanka.rashtrabharti@gmail.com': '45',
      'vishnu.rashtrabharti@gmail.com': '56',
      'nehasri.rashtrabharti@gmail.com': '20',
      'shabeena.rashtrabharti@gmail.com': '449',
    },
  },
}

export function getSchoolknotConfig(schoolId: string): SchoolknotSchoolConfig | null {
  return SCHOOLKNOT_CONFIG[schoolId] ?? null
}
