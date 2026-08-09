-- ═══════════════════════════════════════════════════════════════════
-- Fee module: data model rewrite.
--
-- Replaces the whole fee schema with one designed from what both this codebase
-- and edut learned. Destructive by intent — no school is live.
--
-- The four decisions that shape everything else:
--
-- 1. A PAYMENT IS NOT TIED TO AN INVOICE.
--    The old fee_payments.invoice_id was NOT NULL, so a parent handing over one
--    amount against three invoices produced three payment rows, three receipt
--    numbers, and a receipt that had to be reassembled by string-matching a
--    "-2" suffix. Money arrives as ONE transaction and is ALLOCATED across
--    invoices — edut's shape, and the right one. One payment, one receipt, N
--    allocations.
--
-- 2. A STRUCTURE IS A NAMED, VERSIONED PLAN — not a (class, head, amount) cell.
--    The old flat matrix could not express "Class 5 pays this bundle", could not
--    be versioned, and left no record of what a student was billed under when
--    the amounts later changed. Structures now have lines, apply to classes, and
--    supersede rather than mutate.
--
-- 3. BALANCES ARE MAINTAINED BY THE DATABASE.
--    Kept from this codebase and extended to the allocation model. Application
--    code never writes amount_paid or an open status; triggers derive both
--    inside the transaction that changes them. This is what removes the
--    two-cashier race and makes overpayment impossible.
--
-- 4. MONEY MOVEMENTS ARE POSTED TO A LEDGER.
--    edut's biggest structural advantage and the one thing that cannot be
--    retrofitted later. Every payment, refund and write-off lands in
--    fee_ledger_entries as a double-sided pair.
--
-- Everything this codebase gained that edut lacks is carried forward: optional
-- fees with per-student opt-in, one-off charges as real invoice lines, per-role
-- discount ceilings, year-over-year arrears carry-forward, and period_key
-- billing idempotency enforced by a unique index.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── Out with the old ─────────────────────────────────────────────────
-- Order is irrelevant with CASCADE, but the list is explicit so nothing is
-- dropped by accident. document_counters survives: invoice and receipt numbering
-- is school-wide and already race-free.

DROP TABLE IF EXISTS
    fee_optional_opt_ins, fee_action_requests, fee_installments, fee_arrears,
    fee_discount_limits, fee_discounts, fee_payments, fee_invoices,
    fee_structures, fee_heads, adhoc_fees
    CASCADE;

DROP FUNCTION IF EXISTS public.fee_invoice_derive_status(text, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.fee_payments_apply_to_invoice() CASCADE;
DROP FUNCTION IF EXISTS public.fee_invoices_sync_status() CASCADE;
DROP FUNCTION IF EXISTS public.fee_payment_effective_amount(text, numeric, numeric) CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- CATALOGUE — what the school charges for
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_heads (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id      uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name           text NOT NULL,
    -- Stable identifier for imports and reports; the name is free to change.
    code           text NOT NULL,
    description    text,
    -- A starting figure a structure line can override, so building a new
    -- structure is not 12 blank boxes.
    default_amount numeric(12,2) NOT NULL DEFAULT 0,
    -- Refundable heads (caution money, security deposit) behave differently at
    -- year end; flagged here rather than inferred from the name.
    is_refundable  boolean NOT NULL DEFAULT false,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, code)
);

COMMENT ON TABLE public.fee_heads IS
    'The individual charges a bill is made of — Tuition, Transport, Exam. Each appears as its own line on the invoice and the receipt.';

-- ═══════════════════════════════════════════════════════════════════
-- STRUCTURES — a named billing plan, versioned
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_structures (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    academic_year_id    uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,

    name                text NOT NULL,
    code                text NOT NULL,
    -- How often the plan bills. Drives the billing periods offered.
    frequency           text NOT NULL,

    -- Late fee, expressed as a rule rather than a flat per-day rate (edut's
    -- shape): a school charging 2%/month of the overdue amount could not be
    -- represented before.
    late_fee_mode       text NOT NULL DEFAULT 'none',
    late_fee_value      numeric(12,2) NOT NULL DEFAULT 0,
    late_fee_grace_days integer NOT NULL DEFAULT 0,

    -- Versioning instead of mutation. Editing a live structure would silently
    -- change what students were billed under; a new version supersedes the old
    -- and history stays readable.
    version             integer NOT NULL DEFAULT 1,
    supersedes_id       uuid REFERENCES public.fee_structures(id) ON DELETE SET NULL,
    status              text NOT NULL DEFAULT 'draft',

    created_by          uuid REFERENCES public.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_structures_frequency_check CHECK (
        frequency = ANY (ARRAY['monthly','quarterly','half_yearly','annually','one_time'])),
    CONSTRAINT fee_structures_late_mode_check CHECK (
        late_fee_mode = ANY (ARRAY['none','fixed','per_day','percent_monthly'])),
    CONSTRAINT fee_structures_status_check CHECK (
        status = ANY (ARRAY['draft','active','superseded','archived'])),
    UNIQUE (school_id, academic_year_id, code, version)
);

CREATE TABLE public.fee_structure_lines (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_id uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
    fee_head_id  uuid NOT NULL REFERENCES public.fee_heads(id) ON DELETE RESTRICT,
    amount       numeric(12,2) NOT NULL CHECK (amount >= 0),

    -- Billed only to students who opt in — transport, hostel, a second language.
    -- The flag alone is inert; fee_assignment_optionals records WHO took it.
    is_optional  boolean NOT NULL DEFAULT false,
    sort_order   integer NOT NULL DEFAULT 0,

    UNIQUE (structure_id, fee_head_id)
);

-- Which classes a structure is offered to. A join table rather than a column so
-- one plan can cover several classes without being duplicated per class.
CREATE TABLE public.fee_structure_classes (
    structure_id uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
    class_id     uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    PRIMARY KEY (structure_id, class_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- ASSIGNMENT — which student is on which plan
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_assignments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    structure_id     uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE RESTRICT,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,

    -- Concession bands (edut). Segments who is billed what, independently of
    -- per-student discounts.
    fee_category     text NOT NULL DEFAULT 'general',
    start_date       date,
    status           text NOT NULL DEFAULT 'active',

    assigned_by      uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_assignments_category_check CHECK (
        fee_category = ANY (ARRAY['general','rte','staff_ward','sibling','scholarship'])),
    CONSTRAINT fee_assignments_status_check CHECK (
        status = ANY (ARRAY['active','ended'])),
    -- One live plan per student per year. A second would double every bill.
    UNIQUE (student_id, academic_year_id)
);

-- Who has taken up an optional line. Absence = not billed, so the safe default
-- needs no backfill.
CREATE TABLE public.fee_assignment_optionals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id     uuid NOT NULL REFERENCES public.fee_assignments(id) ON DELETE CASCADE,
    structure_line_id uuid NOT NULL REFERENCES public.fee_structure_lines(id) ON DELETE CASCADE,
    note              text,
    opted_in_by       uuid REFERENCES public.users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),

    UNIQUE (assignment_id, structure_line_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- CONCESSIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_discounts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    -- NULL = applies to every head on the bill.
    fee_head_id     uuid REFERENCES public.fee_heads(id) ON DELETE CASCADE,

    discount_type   text NOT NULL,
    discount_value  numeric(12,2) NOT NULL CHECK (discount_value > 0),
    reason          text NOT NULL,

    approval_status text NOT NULL DEFAULT 'pending',
    requested_by    uuid REFERENCES public.users(id),
    approved_by     uuid REFERENCES public.users(id),
    approved_at     timestamptz,
    valid_from      date,
    valid_until     date,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_discounts_type_check CHECK (discount_type = ANY (ARRAY['percentage','fixed'])),
    CONSTRAINT fee_discounts_status_check CHECK (
        approval_status = ANY (ARRAY['pending','approved','rejected']))
);

-- Per-role ceiling driving auto-approval. edut routes discounts for approval but
-- has no amount threshold; this is what lets an accountant clear a routine
-- sibling concession without the Principal.
CREATE TABLE public.fee_discount_limits (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    role_id             uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    max_single_discount numeric(12,2) NOT NULL DEFAULT 0,
    max_monthly_total   numeric(12,2),
    created_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, role_id)
);

CREATE TABLE public.fee_scholarships (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE CASCADE,
    name             text NOT NULL,
    -- Government / trust / school — a scholarship is funded by someone, and a
    -- discount is not. That is the whole reason this is a separate table.
    funding_source   text NOT NULL DEFAULT 'school',
    amount           numeric(12,2) NOT NULL CHECK (amount > 0),
    awarded_at       date,
    notes            text,
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- INVOICES — the billable document
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_invoices (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    -- NULL for a one-off charge, which belongs to no plan.
    assignment_id    uuid REFERENCES public.fee_assignments(id) ON DELETE SET NULL,

    invoice_number   text NOT NULL,
    -- 'quarterly:Q2', 'monthly:2026-07'. NULL = raised outside a billing run.
    period_key       text,

    invoice_date     date NOT NULL DEFAULT CURRENT_DATE,
    due_date         date,
    line_items       jsonb NOT NULL DEFAULT '[]'::jsonb,

    subtotal         numeric(12,2) NOT NULL DEFAULT 0,
    discount_total   numeric(12,2) NOT NULL DEFAULT 0,
    late_fee         numeric(12,2) NOT NULL DEFAULT 0,
    total_amount     numeric(12,2) NOT NULL DEFAULT 0,

    -- Maintained by trigger from fee_payment_allocations. NEVER written by hand.
    amount_paid      numeric(12,2) NOT NULL DEFAULT 0,
    status           text NOT NULL DEFAULT 'unpaid',

    notes            text,
    created_by       uuid REFERENCES public.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_invoices_status_check CHECK (status = ANY (
        ARRAY['unpaid','partial','paid','cancelled','waived','carried_forward'])),
    UNIQUE (school_id, invoice_number)
);

-- What makes a billing run idempotent: a re-run to pick up newly admitted
-- students bills only them, and a double-submit inserts nothing.
CREATE UNIQUE INDEX fee_invoices_period_uniq
    ON public.fee_invoices (school_id, student_id, academic_year_id, period_key)
    WHERE period_key IS NOT NULL AND status <> 'cancelled';

CREATE INDEX idx_fee_invoices_school_status_due
    ON public.fee_invoices (school_id, status, due_date);
CREATE INDEX idx_fee_invoices_student
    ON public.fee_invoices (student_id, status);

-- ═══════════════════════════════════════════════════════════════════
-- ONE-OFF CHARGES — a trip, a lost book, a re-exam
-- ═══════════════════════════════════════════════════════════════════
--
-- Kept as its own record of WHY, but billed as a real invoice so it is
-- collectable and receiptable like anything else. Settling one by flipping a
-- status field meant cash could cross the counter with no receipt.

CREATE TABLE public.fee_adhoc_charges (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id  uuid REFERENCES public.students(id) ON DELETE CASCADE,
    class_id    uuid REFERENCES public.classes(id) ON DELETE CASCADE,
    fee_head_id uuid REFERENCES public.fee_heads(id) ON DELETE SET NULL,

    title       text NOT NULL,
    description text,
    amount      numeric(12,2) NOT NULL CHECK (amount > 0),
    due_date    date,

    invoice_id  uuid REFERENCES public.fee_invoices(id) ON DELETE SET NULL,
    status      text NOT NULL DEFAULT 'unbilled',

    created_by  uuid REFERENCES public.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_adhoc_status_check CHECK (
        status = ANY (ARRAY['unbilled','billed','cancelled'])),
    CONSTRAINT fee_adhoc_target_check CHECK (student_id IS NOT NULL OR class_id IS NOT NULL)
);

-- ═══════════════════════════════════════════════════════════════════
-- PAYMENTS — one transaction, allocated across invoices
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_payments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id        uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

    receipt_number    text NOT NULL,
    payment_date      timestamptz NOT NULL DEFAULT now(),
    amount            numeric(12,2) NOT NULL CHECK (amount > 0),
    method            text NOT NULL,

    reference         text,
    cheque_number     text,
    cheque_date       date,
    bank_name         text,

    status            text NOT NULL DEFAULT 'captured',
    refunded_amount   numeric(12,2) NOT NULL DEFAULT 0,

    -- Money taken that no invoice claimed yet — a parent paying ahead. Kept as a
    -- credit against the student instead of being refused, which is what edut
    -- does and what a counter actually needs. Maintained by trigger.
    unallocated_amount numeric(12,2) NOT NULL DEFAULT 0,

    notes             text,
    collected_by      uuid REFERENCES public.users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_payments_method_check CHECK (method = ANY (
        ARRAY['cash','cheque','neft','card','upi','online','dd','wallet'])),
    CONSTRAINT fee_payments_status_check CHECK (
        status = ANY (ARRAY['captured','cancelled','refunded'])),
    CONSTRAINT fee_payments_refund_check CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
    UNIQUE (school_id, receipt_number)
);

CREATE INDEX idx_fee_payments_student ON public.fee_payments (student_id, payment_date DESC);
CREATE INDEX idx_fee_payments_school_date ON public.fee_payments (school_id, payment_date DESC);

-- THE JOIN THAT FIXES THE RECEIPT PROBLEM.
-- One payment settles many invoices; each row says how much went where.
CREATE TABLE public.fee_payment_allocations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES public.fee_payments(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
    amount     numeric(12,2) NOT NULL CHECK (amount > 0),
    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (payment_id, invoice_id)
);

CREATE INDEX idx_fee_alloc_invoice ON public.fee_payment_allocations (invoice_id);

-- ═══════════════════════════════════════════════════════════════════
-- LEDGER — every movement of money, double-sided
-- ═══════════════════════════════════════════════════════════════════
--
-- edut's structural advantage, and the one thing that genuinely cannot be
-- retrofitted: bolting a ledger on later means re-deriving journal entries for
-- every payment ever recorded. Deliberately not a full chart of accounts — the
-- account is a stable code, so a real COA can be layered on without a rewrite.

CREATE TABLE public.fee_ledger_entries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    entry_date   timestamptz NOT NULL DEFAULT now(),

    -- 'payment' | 'refund' | 'waiver' | 'writeoff' | 'invoice'
    source_type  text NOT NULL,
    source_id    uuid NOT NULL,
    student_id   uuid REFERENCES public.students(id) ON DELETE SET NULL,

    -- cash / bank / fee_income / late_fee_income / advance / receivable
    account_code text NOT NULL,
    debit        numeric(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit       numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    memo         text,
    created_at   timestamptz NOT NULL DEFAULT now(),

    -- A line is one side or the other, never both and never neither.
    CONSTRAINT fee_ledger_one_side CHECK ((debit > 0) <> (credit > 0))
);

CREATE INDEX idx_fee_ledger_source ON public.fee_ledger_entries (source_type, source_id);
CREATE INDEX idx_fee_ledger_school_date ON public.fee_ledger_entries (school_id, entry_date DESC);

-- ═══════════════════════════════════════════════════════════════════
-- ARREARS — real year-over-year carry-forward
-- ═══════════════════════════════════════════════════════════════════
--
-- edut's `arrears` is a per-student snapshot of the current position. This is a
-- different thing: a specific invoice's remaining balance moved into the next
-- academic year, with the source invoice retired so the same rupees are never
-- counted in both places.

CREATE TABLE public.fee_arrears (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id            uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    from_academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
    to_academic_year_id   uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
    source_invoice_id     uuid REFERENCES public.fee_invoices(id) ON DELETE SET NULL,

    amount                numeric(12,2) NOT NULL CHECK (amount > 0),
    amount_paid           numeric(12,2) NOT NULL DEFAULT 0,
    status                text NOT NULL DEFAULT 'pending',

    notes                 text,
    carried_forward_by    uuid REFERENCES public.users(id),
    carried_forward_at    timestamptz NOT NULL DEFAULT now(),
    cleared_at            timestamptz,

    CONSTRAINT fee_arrears_status_check CHECK (
        status = ANY (ARRAY['pending','partial','cleared','waived'])),
    -- Idempotency: one invoice can only be carried into a given year once.
    UNIQUE (source_invoice_id, to_academic_year_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- REQUESTS — waivers, cancellations, refunds
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE public.fee_action_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    kind          text NOT NULL,
    target_id     uuid NOT NULL,
    student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

    amount        numeric(12,2),
    reason        text NOT NULL,
    status        text NOT NULL DEFAULT 'pending',
    decision_note text,
    requested_by  uuid REFERENCES public.users(id),
    decided_by    uuid REFERENCES public.users(id),
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fee_action_kind_check CHECK (kind = ANY (
        ARRAY['late_fee_waiver','payment_cancel','refund','writeoff'])),
    CONSTRAINT fee_action_status_check CHECK (
        status = ANY (ARRAY['pending','approved','rejected','withdrawn'])),
    CONSTRAINT fee_action_decided_check CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- One open request per target per kind: a double-click must not queue two
-- identical waivers, because approving both applies the waiver twice.
CREATE UNIQUE INDEX fee_action_requests_open_uniq
    ON public.fee_action_requests (school_id, kind, target_id) WHERE status = 'pending';

CREATE INDEX idx_fee_action_school_status
    ON public.fee_action_requests (school_id, status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- INTEGRITY — the database maintains the balances
-- ═══════════════════════════════════════════════════════════════════

CREATE FUNCTION public.fee_payment_effective(
    p_status text, p_amount numeric, p_refunded numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_status = 'cancelled' THEN 0
                ELSE GREATEST(0, p_amount - COALESCE(p_refunded, 0)) END;
$$;

CREATE FUNCTION public.fee_invoice_status(
    p_status text, p_total numeric, p_paid numeric
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    -- Human decisions survive; only the open states are derived.
    SELECT CASE
        WHEN p_status IN ('cancelled','waived','carried_forward') THEN p_status
        WHEN p_paid <= 0              THEN 'unpaid'
        WHEN p_paid >= p_total        THEN 'paid'
        ELSE 'partial'
    END;
$$;

CREATE FUNCTION public.fee_invoices_sync_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.status := public.fee_invoice_status(NEW.status, NEW.total_amount, NEW.amount_paid);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER fee_invoices_sync_status
    BEFORE INSERT OR UPDATE OF total_amount, amount_paid, status
    ON public.fee_invoices FOR EACH ROW
    EXECUTE FUNCTION public.fee_invoices_sync_status();

-- Recompute one invoice from its allocations. Scaled by the payment's own state,
-- so cancelling or refunding a payment flows through without any route knowing.
CREATE FUNCTION public.fee_recalc_invoice(p_invoice_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_paid numeric(12,2); v_total numeric(12,2); v_status text;
BEGIN
    SELECT COALESCE(sum(
             a.amount * CASE WHEN p.amount = 0 THEN 0
                        ELSE public.fee_payment_effective(p.status, p.amount, p.refunded_amount) / p.amount END
           ), 0)
      INTO v_paid
      FROM public.fee_payment_allocations a
      JOIN public.fee_payments p ON p.id = a.payment_id
     WHERE a.invoice_id = p_invoice_id;

    SELECT total_amount, status INTO v_total, v_status
      FROM public.fee_invoices WHERE id = p_invoice_id FOR UPDATE;

    IF v_status NOT IN ('cancelled','waived','carried_forward') AND v_paid > v_total + 0.01 THEN
        RAISE EXCEPTION
            'Allocations exceed the invoice: % against a total of %', v_paid, v_total
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.fee_invoices SET amount_paid = v_paid WHERE id = p_invoice_id;
END;
$$;

-- Keeps a payment's unallocated balance honest. Called from both triggers,
-- because either side can change it: allocating money reduces it, and changing
-- the payment's own amount changes what there is to allocate.
CREATE FUNCTION public.fee_sync_unallocated(p_payment_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_amount numeric(12,2); v_alloc numeric(12,2);
BEGIN
    SELECT amount INTO v_amount FROM public.fee_payments WHERE id = p_payment_id;
    IF v_amount IS NULL THEN RETURN; END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_alloc
      FROM public.fee_payment_allocations WHERE payment_id = p_payment_id;

    IF v_alloc > v_amount + 0.01 THEN
        RAISE EXCEPTION 'Allocated % exceeds the payment of %', v_alloc, v_amount
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.fee_payments
       SET unallocated_amount = GREATEST(0, v_amount - v_alloc)
     WHERE id = p_payment_id
       AND unallocated_amount IS DISTINCT FROM GREATEST(0, v_amount - v_alloc);
END;
$$;

CREATE FUNCTION public.fee_allocations_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('INSERT','UPDATE') THEN
        PERFORM public.fee_recalc_invoice(NEW.invoice_id);
        -- Without this the payment still reports the whole amount as unallocated
        -- after it has been fully applied, so an advance balance appears that
        -- does not exist.
        PERFORM public.fee_sync_unallocated(NEW.payment_id);
    END IF;
    IF TG_OP IN ('UPDATE','DELETE') THEN
        IF TG_OP = 'DELETE' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
            PERFORM public.fee_recalc_invoice(OLD.invoice_id);
        END IF;
        PERFORM public.fee_sync_unallocated(OLD.payment_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER fee_allocations_changed
    AFTER INSERT OR UPDATE OR DELETE ON public.fee_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION public.fee_allocations_changed();

-- A payment changing state (cancelled, refunded) rescales every invoice it
-- touched, and refreshes what it left unallocated.
CREATE FUNCTION public.fee_payment_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_inv uuid;
BEGIN
    PERFORM public.fee_sync_unallocated(NEW.id);

    FOR v_inv IN SELECT invoice_id FROM public.fee_payment_allocations WHERE payment_id = NEW.id
    LOOP PERFORM public.fee_recalc_invoice(v_inv); END LOOP;

    RETURN NULL;
END;
$$;

CREATE TRIGGER fee_payment_changed
    AFTER INSERT OR UPDATE OF status, refunded_amount, amount
    ON public.fee_payments FOR EACH ROW
    EXECUTE FUNCTION public.fee_payment_changed();

COMMIT;
