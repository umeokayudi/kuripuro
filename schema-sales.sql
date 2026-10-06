-- KuriPuro sales pipeline — アプローチ / フォローアップ / 見積書
-- Safe to re-run.

create table if not exists sales_leads (
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

create table if not exists mitsumori (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references sales_leads(id) on delete set null,
  quote_number text,
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

create table if not exists mitsumori_items (
  id uuid primary key default gen_random_uuid(),
  mitsumori_id uuid references mitsumori(id) on delete cascade,
  description text,
  quantity numeric(10,2) default 1,
  unit_price numeric(12,2) default 0,
  total numeric(12,2) default 0
);

alter table sales_leads enable row level security;
alter table mitsumori enable row level security;
alter table mitsumori_items enable row level security;

drop policy if exists "allow_all_sales_leads" on sales_leads;
create policy "allow_all_sales_leads" on sales_leads for all using (true) with check (true);

drop policy if exists "allow_all_mitsumori" on mitsumori;
create policy "allow_all_mitsumori" on mitsumori for all using (true) with check (true);

drop policy if exists "allow_all_mitsumori_items" on mitsumori_items;
create policy "allow_all_mitsumori_items" on mitsumori_items for all using (true) with check (true);

create index if not exists sales_leads_stage_idx on sales_leads (stage, next_followup_date);
create unique index if not exists mitsumori_quote_number_uidx
  on mitsumori (quote_number)
  where quote_number is not null;
