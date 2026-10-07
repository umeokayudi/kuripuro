-- CRM extras for 見積書 (interest + replies). Safe to re-run after sales tables exist.

alter table public.sales_leads add column if not exists interest text;
alter table public.mitsumori add column if not exists interest text;

create table if not exists public.sales_touchpoints (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.sales_leads(id) on delete cascade,
  mitsumori_id uuid references public.mitsumori(id) on delete set null,
  event_type text not null default 'reply',
  happened_at date,
  channel text,
  said_by text,
  body text not null,
  created_at timestamptz default now()
);

alter table public.sales_touchpoints enable row level security;
drop policy if exists "allow_all_sales_touchpoints" on public.sales_touchpoints;
create policy "allow_all_sales_touchpoints" on public.sales_touchpoints for all using (true);
grant all on table public.sales_touchpoints to anon, authenticated, service_role;
create index if not exists sales_touchpoints_lead_idx on public.sales_touchpoints (lead_id, happened_at);
create index if not exists sales_touchpoints_quote_idx on public.sales_touchpoints (mitsumori_id, happened_at);
alter table public.sales_leads add column if not exists site_name text;
alter table public.mitsumori add column if not exists site_name text;
notify pgrst, 'reload schema';
select to_regclass('public.sales_touchpoints') as sales_touchpoints;
