/** Run in Supabase SQL Editor (project fxsakrshmldmkdmbevna). Prefer the 3 steps if a full paste rolls back. */

export const SUPABASE_SQL_URL = 'https://supabase.com/dashboard/project/fxsakrshmldmkdmbevna/sql/new'
export const SALES_SQL_FILE_URL = '/schema-sales.sql'

export const SALES_SETUP_STEPS = [
  {
    id: 'leads',
    sql: `create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  stage text not null default 'approach',
  company_name text not null,
  company_kana text,
  address text,
  phone text,
  email text,
  website text,
  industry text,
  locations_count integer,
  contact_name text,
  contact_title text,
  contact_phone text,
  contact_email text,
  contact_line_id text,
  first_contact_date date,
  last_contact_date date,
  next_followup_date date,
  source text,
  needs text,
  still_needed text,
  decision_maker text,
  expected_monthly numeric(12,2),
  expected_start date,
  competitor text,
  notes text,
  lost_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.sales_leads enable row level security;
drop policy if exists "allow_all_sales_leads" on public.sales_leads;
create policy "allow_all_sales_leads" on public.sales_leads for all using (true);
grant all on table public.sales_leads to anon, authenticated, service_role;`,
  },
  {
    id: 'quotes',
    sql: `create table if not exists public.mitsumori (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.sales_leads(id) on delete set null,
  quote_number text unique,
  company_name text not null,
  company_kana text,
  address text,
  phone text,
  email text,
  contact_name text,
  contact_title text,
  contact_phone text,
  contact_email text,
  first_contact_date date,
  needs text,
  still_needed text,
  source text,
  notes text,
  issue_date date,
  valid_until date,
  site_visit_date date,
  expected_start date,
  frequency text,
  hours_per_visit numeric(6,2),
  tax_rate integer default 10,
  subtotal numeric(12,2) default 0,
  tax_amount numeric(12,2) default 0,
  total numeric(12,2) default 0,
  status text default 'draft',
  created_at timestamptz default now()
);

alter table public.mitsumori enable row level security;
drop policy if exists "allow_all_mitsumori" on public.mitsumori;
create policy "allow_all_mitsumori" on public.mitsumori for all using (true);
grant all on table public.mitsumori to anon, authenticated, service_role;`,
  },
  {
    id: 'items',
    sql: `create table if not exists public.mitsumori_items (
  id uuid primary key default gen_random_uuid(),
  mitsumori_id uuid references public.mitsumori(id) on delete cascade,
  description text,
  quantity numeric(10,2) default 1,
  unit_price numeric(12,2) default 0,
  total numeric(12,2) default 0
);

alter table public.mitsumori_items enable row level security;
drop policy if exists "allow_all_mitsumori_items" on public.mitsumori_items;
create policy "allow_all_mitsumori_items" on public.mitsumori_items for all using (true);
grant all on table public.mitsumori_items to anon, authenticated, service_role;
create index if not exists sales_leads_stage_idx on public.sales_leads (stage, next_followup_date);
notify pgrst, 'reload schema';
select to_regclass('public.sales_leads') as sales_leads,
       to_regclass('public.mitsumori') as mitsumori,
       to_regclass('public.mitsumori_items') as mitsumori_items;`,
  },
]

export const SALES_SETUP_SQL = SALES_SETUP_STEPS.map(s => s.sql).join('\n\n')
