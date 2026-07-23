-- Academic calendar: a real holiday list plus a configurable weekly-off
-- pattern, so attendance % can be computed against actual working days
-- instead of just "days someone happened to mark attendance".

CREATE TABLE public.holidays (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    date date NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (school_id, date)
);

-- Weekly-off days as JS Date.getDay() indices (0 = Sunday ... 6 = Saturday),
-- configurable per school so schools with e.g. alternate Saturdays off can
-- represent it. Defaults to Sunday-only.
ALTER TABLE public.schools ADD COLUMN weekly_off_days smallint[] NOT NULL DEFAULT '{0}';

-- schools had RLS enabled with zero policies (same class of bug fixed for
-- subjects in 20260722040000) — it was silently blocking the service-role
-- read added here (GET/PATCH /admission/weekly-off), returning "Cannot
-- coerce the result to a single JSON object" instead of a row. Disabling
-- to match the rest of the schema's convention: authorization enforced at
-- the Express layer, not via Postgres RLS policies.
ALTER TABLE public.schools DISABLE ROW LEVEL SECURITY;
