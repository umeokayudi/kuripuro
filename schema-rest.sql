-- Remaining tables (salary close, equipment, employee PDF contracts, invoice numbers)
-- Sales tables already exist. Safe to re-run.

create table if not exists public.salary_periods (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  closed_at timestamptz,
  confirm_deadline date,
  pay_date date,
  status text default 'open'
);

create table if not exists public.salary_statements (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  employee_id uuid references public.employees(id) on delete cascade,
  employee_name text,
  base_salary numeric(12,2) default 0,
  deductions numeric(12,2) default 0,
  bonuses numeric(12,2) default 0,
  net_total numeric(12,2) default 0,
  breakdown jsonb,
  status text default 'pending',
  employee_confirmed_at timestamptz,
  employee_disputed_at timestamptz,
  admin_finalized_at timestamptz,
  created_at timestamptz default now(),
  unique(period, employee_id)
);

create table if not exists public.salary_complaints (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  employee_name text,
  period text not null,
  statement_id uuid references public.salary_statements(id),
  category text,
  description text not null,
  attachment_url text,
  status text default 'pending',
  admin_response text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.equipment_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  employee_name text,
  category text default 'other',
  item_name text not null,
  quantity integer default 1,
  reason text not null,
  photo_url text,
  status text default 'pending',
  admin_note text,
  reviewed_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  employee_name text,
  pdf_url text,
  file_name text,
  extracted_json jsonb,
  retroactive_allowed boolean default false,
  extraction_status text default 'pending',
  applied_at timestamptz,
  uploaded_at timestamptz default now()
);

alter table public.salary_periods enable row level security;
alter table public.salary_statements enable row level security;
alter table public.salary_complaints enable row level security;
alter table public.equipment_requests enable row level security;
alter table public.employee_contracts enable row level security;

drop policy if exists "allow_all_salary_periods" on public.salary_periods;
create policy "allow_all_salary_periods" on public.salary_periods for all using (true);
drop policy if exists "allow_all_salary_statements" on public.salary_statements;
create policy "allow_all_salary_statements" on public.salary_statements for all using (true);
drop policy if exists "allow_all_salary_complaints" on public.salary_complaints;
create policy "allow_all_salary_complaints" on public.salary_complaints for all using (true);
drop policy if exists "allow_all_equipment_requests" on public.equipment_requests;
create policy "allow_all_equipment_requests" on public.equipment_requests for all using (true);
drop policy if exists "allow_all_employee_contracts" on public.employee_contracts;
create policy "allow_all_employee_contracts" on public.employee_contracts for all using (true);

grant all on table public.salary_periods to anon, authenticated, service_role;
grant all on table public.salary_statements to anon, authenticated, service_role;
grant all on table public.salary_complaints to anon, authenticated, service_role;
grant all on table public.equipment_requests to anon, authenticated, service_role;
grant all on table public.employee_contracts to anon, authenticated, service_role;

create index if not exists idx_equipment_requests_employee on public.equipment_requests(employee_id, created_at desc);

alter table if exists public.faturas add column if not exists invoice_number text;
create unique index if not exists faturas_invoice_number_uidx
  on public.faturas (invoice_number)
  where invoice_number is not null;

notify pgrst, 'reload schema';

select to_regclass('public.salary_periods') as salary_periods,
       to_regclass('public.salary_statements') as salary_statements,
       to_regclass('public.salary_complaints') as salary_complaints,
       to_regclass('public.equipment_requests') as equipment_requests,
       to_regclass('public.employee_contracts') as employee_contracts;
