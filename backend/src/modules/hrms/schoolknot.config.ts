// ── SchoolKnot sync config (DEMO — code-level, no DB schema) ──────────
//
// Rashtra Bharti's staff punch across TWO SchoolKnot schools — RBPIC (SC3102)
// and Trinity (SC3104). Each mapping carries which school the reg_id belongs
// to, so the sync fetches both feeds and reads each person from where they
// actually punch. Built by hand from a month of biometric data (see the
// verify_punch_schools run): every reg_id below is a person who genuinely
// punched under it. Staff who punch at neither (or have no device) are simply
// omitted and skipped by the sync.
//
// Keyed by airtec school_id; no entry, no sync.

export interface SchoolknotSchoolConfig {
  /** Every SchoolKnot school this airtec school's staff punch at. */
  schoolknotSchoolIds: string[]
  /** airtec staff login email -> the SchoolKnot school + device reg_id. */
  regByEmail: Record<string, { school: string; reg: string }>
}

export const SCHOOLKNOT_CONFIG: Record<string, SchoolknotSchoolConfig> = {
  // Rashtra Bharti Public Inter College
  'd400bc23-9534-4410-af92-5563990f2b27': {
    schoolknotSchoolIds: ['SC3102', 'SC3104'],
    regByEmail: {
      // ── RBPIC (SC3102) ──────────────────────────────────────────
      'ankitsingh.rashtrabharti@gmail.com': { school: 'SC3102', reg: '66' },        // Ankit Singh
      'anshuk.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4731' },          // Anshuk
      'ayushi.rashtrabharti@gmail.com': { school: 'SC3102', reg: '59' },            // Ayushi Awasthi
      'deepikashukla.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4702' },   // Deepika Shukla
      'komal.rashtrabharti@gmail.com': { school: 'SC3102', reg: '79' },             // Komal Rai
      'krishna.rashtrabharti@gmail.com': { school: 'SC3102', reg: '72' },           // Krishna Sharma
      'kunal.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4725' },           // Kunal Vishwakarma
      'latasingh.rashtrabharti@gmail.com': { school: 'SC3102', reg: '92' },         // Lata Singh
      'mamta.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4707' },           // Mamta Srivastava
      'mansijaiswal.rashtrabharti@gmail.com': { school: 'SC3102', reg: '39' },      // Mansi Jaiswal
      'mrinalini.rashtrabharti@gmail.com': { school: 'SC3102', reg: '85' },         // Mrinalini Pandey
      'narendranathchaturvedi.rashtrabharti@gmail.com': { school: 'SC3102', reg: '458' }, // Narendra Nath Chaturvedi
      'nehasri.rashtrabharti@gmail.com': { school: 'SC3102', reg: '20' },           // Neha Srivastava
      'nupur.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4697' },           // Nupur Singh
      'payal.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4728' },           // Payal Rajput
      'prabhaawasthi.rashtrabharti@gmail.com': { school: 'SC3102', reg: 'TA011' },  // Prabha Awasthi
      'prashantsrivastava.rashtrabharti@gmail.com': { school: 'SC3102', reg: '16' },// Prashant Srivastava
      'principal.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4680' },       // Mohd. Wajihul Islam
      'priyanka.rashtrabharti@gmail.com': { school: 'SC3102', reg: '45' },          // Priyanka Mishra
      'rahultiwari.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4692' },     // Rahul Tiwari
      'rajendrashukla.rashtrabharti@gmail.com': { school: 'SC3102', reg: 'TA008' }, // Rajendra Shukla
      'reetika.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4726' },         // Reetika Kanoujiya (enrolled at RBPIC; no punches last month)
      'ruchigupta.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4695' },      // Ruchi Gupta
      'sambhavi.rashtrabharti@gmail.com': { school: 'SC3102', reg: 'TA009' },       // Sambhavi
      'shanti.rashtrabharti@gmail.com': { school: 'SC3102', reg: '35' },            // Shanti
      'shivam.rashtrabharti@gmail.com': { school: 'SC3102', reg: '86' },            // Shivam Gupta
      'shraddhakushwaha.rashtrabharti@gmail.com': { school: 'SC3102', reg: '71' },  // Shraddha Kushwaha
      'swatisrivastava.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4696' }, // Swati Srivastava
      'umasingh.rashtrabharti@gmail.com': { school: 'SC3102', reg: '4678' },        // Uma Singh
      'vishnu.rashtrabharti@gmail.com': { school: 'SC3102', reg: '56' },            // Vishnu Kant Raj
      'vivekkumarshukla.rashtrabharti@gmail.com': { school: 'SC3102', reg: '64' },  // Vivek Kumar Shukla

      // ── Trinity (SC3104) ────────────────────────────────────────
      'artipal.rashtrabharti@gmail.com': { school: 'SC3104', reg: '4732' },         // Arti Pal
      'artiyadav.rashtrabharti@gmail.com': { school: 'SC3104', reg: '17' },         // Arti Yadav
      'basundhara.rashtrabharti@gmail.com': { school: 'SC3104', reg: '68' },        // Basundhara
      'beenatiwari.rashtrabharti@gmail.com': { school: 'SC3104', reg: '25' },       // Beena Tiwari
      'chhayatrivedi.rashtrabharti@gmail.com': { school: 'SC3104', reg: '27' },     // Chhaya Trivedi
      'heena.rashtrabharti@gmail.com': { school: 'SC3104', reg: '92' },             // Heena Kausar
      'jagriti.rashtrabharti@gmail.com': { school: 'SC3104', reg: '4710' },         // Jagriti Chaturvedi
      'nehajoshi.rashtrabharti@gmail.com': { school: 'SC3104', reg: '67' },         // Neha Joshi
      'nehamishra.rashtrabharti@gmail.com': { school: 'SC3104', reg: '102' },       // Neha Mishra
      'nehasingh.rashtrabharti@gmail.com': { school: 'SC3104', reg: '104' },        // Neha Singh
      'poojarai.rashtrabharti@gmail.com': { school: 'SC3104', reg: '103' },         // Pooja Rai
      'pratiksha.rashtrabharti@gmail.com': { school: 'SC3104', reg: '4708' },       // Pratiksha Srivastava
      'preeti.rashtrabharti@gmail.com': { school: 'SC3104', reg: '57' },            // Preeti Kumari
      'sajida.rashtrabharti@gmail.com': { school: 'SC3104', reg: '56' },            // Sajida Bano
      'shabeena.rashtrabharti@gmail.com': { school: 'SC3104', reg: '449' },         // Shabeena Shahnaz
      'shalinipandey.rashtrabharti@gmail.com': { school: 'SC3104', reg: '15' },     // Shalini Pandey
      'vandana.rashtrabharti@gmail.com': { school: 'SC3104', reg: 'TA004' },        // Vandana Kashyap
      'vijayranjana.rashtrabharti@gmail.com': { school: 'SC3104', reg: '21' },      // Vijay Ranjana
    },
  },
}

export function getSchoolknotConfig(schoolId: string): SchoolknotSchoolConfig | null {
  return SCHOOLKNOT_CONFIG[schoolId] ?? null
}
