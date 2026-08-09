-- Optional fees: record WHO opted in.
--
-- fee_structures.is_optional has existed since the baseline schema and has never
-- done anything. Nothing in the billing path reads it — resolveBilling() filters
-- structures by fee head and cadence only — so a fee marked optional is billed to
-- every student in the class exactly like a mandatory one.
--
-- That is live in this database today: the seed marks Transport Fee optional at
-- 1,500/month across all 12 classes, so every student is billed for a bus they
-- may not take.
--
-- The flag alone cannot fix it. "This fee is opt-in" is a property of the fee;
-- "these forty children take the bus" is a property of the students, and there
-- was nowhere to put it. This is that place.
--
-- Shape: one row = one student has opted into one optional class amount. Absence
-- of a row means not opted in, so the safe default (do not bill) needs no
-- backfill and no migration of existing data.

CREATE TABLE IF NOT EXISTS public.fee_optional_opt_ins (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id        uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    fee_structure_id  uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,

    -- Free text for the desk: "Route 4, from July", "half-year only".
    note              text,
    opted_in_by       uuid REFERENCES public.users(id),
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Opting in twice is not a second subscription. Without this, a double-click
-- bills the student for the bus twice.
CREATE UNIQUE INDEX IF NOT EXISTS fee_optional_opt_ins_uniq
    ON public.fee_optional_opt_ins (student_id, fee_structure_id);

-- The billing resolver's access pattern: "of these N students, who opted into
-- any of these structures".
CREATE INDEX IF NOT EXISTS idx_fee_optional_opt_ins_lookup
    ON public.fee_optional_opt_ins (school_id, fee_structure_id, student_id);

CREATE INDEX IF NOT EXISTS idx_fee_optional_opt_ins_student
    ON public.fee_optional_opt_ins (student_id);

COMMENT ON TABLE public.fee_optional_opt_ins IS
    'Students who have opted into an optional fee (fee_structures.is_optional). No row = not billed. Read by the billing resolver; see backend/src/modules/fee/lib/resolve.ts.';
