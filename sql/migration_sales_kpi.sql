-- KuriPuro sales & marketing KPIs: real close dates and monthly marketing targets.
-- Run AFTER sql/migration_sales_followups_goals.sql. Additive only.

-- When a lead was won or lost, so time-to-close and monthly wins are exact.
alter table public.sales_leads add column if not exists closed_at timestamptz;

create or replace function public.sales_leads_closed_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.stage in ('won', 'lost') then
    if tg_op = 'INSERT' or old.stage is distinct from new.stage or new.closed_at is null then
      new.closed_at := coalesce(case when tg_op = 'UPDATE' and old.stage = new.stage then old.closed_at end, now());
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end $$;

create or replace trigger sales_leads_closed_at before insert or update of stage on public.sales_leads
  for each row execute function public.sales_leads_closed_at();

update public.sales_leads set closed_at = coalesce(updated_at, created_at)
  where stage in ('won', 'lost') and closed_at is null;

create index if not exists sales_leads_closed_idx on public.sales_leads (stage, closed_at desc);

-- Monthly marketing targets set by admin (replaces the per-browser targets).
create table if not exists public.marketing_goals (
  id uuid primary key default gen_random_uuid(),
  period_month text not null unique check (period_month ~ '^[0-9]{4}-[0-9]{2}$'),
  leads integer not null default 0 check (leads >= 0),
  won integer not null default 0 check (won >= 0),
  spend numeric(12,2) not null default 0 check (spend >= 0),
  max_cpl numeric(12,2) not null default 0 check (max_cpl >= 0),
  revenue numeric(12,2) not null default 0 check (revenue >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.marketing_goals enable row level security;
revoke all on public.marketing_goals from anon, authenticated;
