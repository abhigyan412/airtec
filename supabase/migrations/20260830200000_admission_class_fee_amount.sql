-- Per-class admission fee, settable by the school in advance — same table
-- and inline-edit pattern as entrance_mode/pass_marks_percent (this
-- table's own migration comment already flagged it as the home for
-- future per-class admission settings). NULL means "not configured yet":
-- POST /applications/:id/collect-fee still accepts a typed-in amount as a
-- fallback, but pre-fills from here once a school sets it, the same way
-- POST /applications no longer guesses at anything it doesn't have to.
ALTER TABLE public.admission_class_settings
  ADD COLUMN admission_fee_amount numeric(12,2) CHECK (admission_fee_amount >= 0);
