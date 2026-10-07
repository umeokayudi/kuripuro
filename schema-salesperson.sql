-- Salesperson portal: hashed logins, daily hours + report, meishi-required approaches.
-- Safe to re-run. Project fxsakrshmldmkdmbevna.

create table if not exists public.salespeople (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  password_hash text not null,
  phone text,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table public.salespeople enable row level security;
drop policy if exists "allow_all_salespeople" on public.salespeople;
create policy "allow_all_salespeople" on public.salespeople for all using (true);
grant all on table public.salespeople to anon, authenticated, service_role;

create table if not exists public.sales_day_reports (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.salespeople(id) on delete cascade,
  work_date date not null,
  hours_worked numeric(6,2) not null default 0,
  started_at text,
  ended_at text,
  areas text,
  summary text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (salesperson_id, work_date)
);

alter table public.sales_day_reports enable row level security;
drop policy if exists "allow_all_sales_day_reports" on public.sales_day_reports;
create policy "allow_all_sales_day_reports" on public.sales_day_reports for all using (true);
grant all on table public.sales_day_reports to anon, authenticated, service_role;
create index if not exists sales_day_reports_sp_idx on public.sales_day_reports (salesperson_id, work_date);

create table if not exists public.sales_field_approaches (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.salespeople(id) on delete cascade,
  day_report_id uuid references public.sales_day_reports(id) on delete set null,
  work_date date not null,
  place text not null,
  company_name text,
  site_name text,
  contact_name text,
  contact_title text,
  contact_phone text,
  contact_email text,
  meishi_photo_url text not null,
  notes text,
  followup_note text,
  followup_date date,
  followup_status text default 'open',
  outcome text,
  created_at timestamptz default now()
);

alter table public.sales_field_approaches enable row level security;
drop policy if exists "allow_all_sales_field_approaches" on public.sales_field_approaches;
create policy "allow_all_sales_field_approaches" on public.sales_field_approaches for all using (true);
grant all on table public.sales_field_approaches to anon, authenticated, service_role;
create index if not exists sales_field_approaches_sp_idx on public.sales_field_approaches (salesperson_id, work_date);
create index if not exists sales_field_approaches_fu_idx on public.sales_field_approaches (salesperson_id, followup_date);

alter table public.sales_leads add column if not exists site_name text;
alter table public.mitsumori add column if not exists site_name text;

notify pgrst, 'reload schema';
select to_regclass('public.salespeople') as salespeople,
       to_regclass('public.sales_day_reports') as sales_day_reports,
       to_regclass('public.sales_field_approaches') as sales_field_approaches;
