-- KuriPuro sales CRM: contact history, follow-up alerts and monthly goals.
-- Run AFTER sql/migration_sales_workflow.sql. Review and apply manually;
-- this file is intentionally not executed against Supabase by the app.

-- Each contact with a lead (visit, call, LINE, email...) with the date it happened.
alter table public.sales_touchpoints
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null,
  add column if not exists next_followup_date date;

create index if not exists sales_touchpoints_lead_date_idx
  on public.sales_touchpoints (lead_id, happened_at desc);
create index if not exists sales_touchpoints_salesperson_date_idx
  on public.sales_touchpoints (salesperson_id, happened_at desc);

-- Monthly targets per seller, set by admin and shown in the seller portal.
create table if not exists public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.salespeople(id) on delete cascade,
  period_month text not null check (period_month ~ '^[0-9]{4}-[0-9]{2}$'),
  approaches integer not null default 0 check (approaches >= 0),
  contacts integer not null default 0 check (contacts >= 0),
  leads integer not null default 0 check (leads >= 0),
  quotes integer not null default 0 check (quotes >= 0),
  contracts integer not null default 0 check (contracts >= 0),
  revenue numeric(12,2) not null default 0 check (revenue >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (salesperson_id, period_month)
);

-- Only the server API (service key, after checking the seller/admin session)
-- reads or writes these. The browser key gets nothing.
alter table public.sales_goals enable row level security;
revoke all on public.sales_goals from anon, authenticated;

drop policy if exists allow_all_sales_touchpoints on public.sales_touchpoints;
revoke all on public.sales_touchpoints from anon, authenticated;
