-- Marketing site lead capture (docs/marketing-site/plan.md §9): every
-- "Book a demo", home-page short form and free-trial request lands here via
-- POST /api/public/leads.
--
-- No school_id: these are prospects, not tenants, and nothing in the
-- tenant-scoped code paths reads this table.
--
-- `form` records which form sent the row:
--   full  — /contact: every field the demo form asks for
--   short — home-page CTA: name, school, phone only, so role and city are
--           null until the sales call fills them in
--   trial — /free-trial: the school picked exactly one module to try free,
--           stored in trial_module (and mirrored into modules)
create table if not exists marketing_leads (
  id uuid primary key default gen_random_uuid(),
  form text not null check (form in ('full', 'short', 'trial')),
  name text not null,
  role text,
  school_name text not null,
  city text,
  state text,
  phone text not null,
  email text,
  student_strength text,
  board text,
  modules text[] not null default '{}',
  trial_module text,
  message text,
  source_path text,          -- page the form was submitted from
  utm jsonb,                 -- utm_source / utm_medium / utm_campaign if present
  consent_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'demo_booked', 'trial_started', 'won', 'lost', 'spam')),
  created_at timestamptz not null default now(),
  constraint marketing_leads_trial_has_module check (form <> 'trial' or trial_module is not null),
  constraint marketing_leads_full_has_role_city check (form <> 'full' or (role is not null and city is not null))
);

create index if not exists marketing_leads_created_at_idx on marketing_leads (created_at desc);
create index if not exists marketing_leads_status_idx on marketing_leads (status);

-- No policies: only the backend's service role reads or writes this table.
-- The anon and authenticated keys (used by the apps' browsers) see nothing.
alter table marketing_leads enable row level security;
