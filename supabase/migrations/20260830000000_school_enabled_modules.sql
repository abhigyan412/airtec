-- Which parts of the ERP a school has actually bought.
--
-- Until now the product assumed every school runs every module, and the
-- sidebar reflects that: most items are gated on a permission, but
-- Dashboard, My Attendance, My Leave, My Payslips and My Documents are
-- gated on nothing at all, and Academic Calendar is gated on a role name.
-- Those show up for everybody.
--
-- That is fine while every customer takes the whole suite. It stops being
-- fine the moment a school signs up for the timetable alone: a teacher
-- there logs in and is offered payslips the school does not run, leave it
-- does not track, and a dashboard of empty fee widgets. Trimming their
-- role's permissions does not help, because those items never checked a
-- permission in the first place.
--
-- NULL means every module, so nothing changes for any existing school and
-- no backfill is needed. A school with an explicit list gets only what is
-- on it. The server still enforces per-permission access exactly as
-- before — this decides what is *offered*, not what is *allowed*, and the
-- two are deliberately separate concerns.

ALTER TABLE public.schools
    ADD COLUMN enabled_modules text[];

COMMENT ON COLUMN public.schools.enabled_modules IS
  'Modules this school has enabled, matching the module keys the sidebar '
  'tags its entries with (timetable, students, fees, exams, hr, ...). '
  'NULL means all of them — the default, and what every school created '
  'before this column existed gets.';
