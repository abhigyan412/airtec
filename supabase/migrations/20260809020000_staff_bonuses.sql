-- One-off staff bonuses (festival bonus, performance incentive, etc.) —
-- distinct from salary_structures' recurring monthly components. A row
-- here is scoped to a specific month/year and gets picked up by
-- POST /hrms/payslips/generate for that month exactly once (one row per
-- user per month — a second award in the same month means editing the
-- existing row's amount/reason, not stacking rows), the same way
-- staff_profiles.pending_leave_encashment_days is picked up at
-- generation time rather than paid out separately.

CREATE TABLE public.staff_bonuses (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
    year integer NOT NULL,
    amount numeric NOT NULL CHECK (amount > 0),
    reason text NOT NULL,
    created_by uuid REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_bonuses_user_month_year_key ON public.staff_bonuses (user_id, month, year);
CREATE INDEX staff_bonuses_school_month_year_idx ON public.staff_bonuses (school_id, month, year);

-- RLS stays off, matching this schema's established convention —
-- authorization is enforced in Express (requirePermissionV2), not at
-- the database.

-- ── Payslip-side columns to record what was actually paid out ────────
-- Same treatment as leave_encashment: a distinct earnings line added on
-- top of gross at generation time, not folded into gross_salary itself
-- (so PF/PT/TDS, all computed off gross, stay unaffected by a one-off
-- bonus — matching how leave_encashment already works).
ALTER TABLE public.payslips ADD COLUMN bonus_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN bonus_reason text;
