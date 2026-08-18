// ═══════════════════════════════════════════════════════════════
// Timetable engine — pure logic, no I/O.
// ═══════════════════════════════════════════════════════════════
//
// Ported verbatim from the edut codebase
// (packages/modules/academics/src/services/engine), where it runs against
// Prisma/Fastify. The only edit made during the port was stripping the
// ".js" suffix from relative import specifiers, because this backend is
// CommonJS + node resolution rather than ESM/NodeNext.
//
// KEEP IT THAT WAY. Nothing in this directory may import the Supabase
// client, Express, or anything else with I/O — the whole reason ~2,200
// lines of scheduling logic could move between two unrelated stacks
// untouched is that it only ever takes an EngineInput and returns a
// result. Assembling that input from the database is the caller's job
// (see ../engineInput.ts). purity.test.ts enforces this.
//
// Algorithm, per the design doc:
//   1. feasibility — refuse early, naming the bottleneck
//   2. place locked cells, then external occupancy from other sections
//   3. place doubles (adjacent, never spanning a break)
//   4. place singles most-constrained-first, with ejection + swap repair
//   5. improve via seeded local search minimising a weighted soft penalty
//   6. report conflicts and a quality score (lower is better)

export * from "./types";
export * from "./feasibility";
export * from "./conflicts";
export * from "./generate";
