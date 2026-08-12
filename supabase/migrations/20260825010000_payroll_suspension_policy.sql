-- Payroll Phase 0 audit, Stage 1.4: suspended staff were being generated a
-- full payslip with nobody having decided that should happen — Generate
-- only ever excluded resigned/terminated. Give schools an explicit,
-- configurable policy instead of an accidental default.
--
-- 'exclude' matches the safe default (same treatment as resigned/
-- terminated); a school opts into 'full' or 'partial' deliberately via
-- Payroll Settings.

alter table public.schools
  add column if not exists suspension_pay_policy text not null default 'exclude'
    check (suspension_pay_policy in ('exclude', 'full', 'partial')),
  add column if not exists suspension_pay_percent numeric not null default 0
    check (suspension_pay_percent >= 0 and suspension_pay_percent <= 100);
