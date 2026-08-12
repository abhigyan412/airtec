// The process runs on the school's clock.
//
// Imported for its side effect, immediately after dotenv and before anything
// else, because Node resolves TZ lazily on the first local-time operation and
// changing it afterwards gives you two different "todays" in one process.
//
// Why this matters more here than in most products: every date the fee module
// computes is a school's date, and the container it runs in defaults to UTC,
// which is 5 hours 30 minutes behind the school.
//
//   * toLocalDateStr() reads the PROCESS timezone. Under UTC, "local" meant UTC
//     throughout the module, and several comments claiming IST-correctness
//     described an intent the code did not implement.
//   * The Day Book showed the previous day's takings until 05:30 every morning.
//   * Collections between 18:30 and midnight filed into the NEXT day, and on
//     31 March into the next FINANCIAL YEAR — the one date an Indian school
//     cannot get wrong.
//
// Setting TZ alone is not sufficient and was not done alone: the query bounds
// that used to read `${date}T00:00:00` were naive strings, which Postgres
// resolves in the DATABASE's timezone (UTC on Supabase) regardless of what this
// process thinks. Those now carry an explicit offset — see dayStartISO and
// dayEndISO in academicCalendar.ts.

process.env.TZ = process.env.TZ || 'Asia/Kolkata'

/** The school's IANA zone. One place to change it, one place to read it. */
export const SCHOOL_TIMEZONE = process.env.TZ
