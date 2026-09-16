/** SQL — paste once in Supabase SQL Editor (payroll close + contracts + equipment). */
export const SUPABASE_SQL_URL = 'https://supabase.com/dashboard/project/fxsakrshmldmkdmbevna/sql/new'

export const SALARY_SETUP_SQL = `-- KuriPuro payroll / contracts / equipment — run once
create table if not exists employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  employee_name text,
  pdf_url text,
  file_name text,
  extracted_json jsonb,
  retroactive_allowed boolean default false,
  extraction_status text default 'pending',
  applied_at timestamptz,
  uploaded_at timestamptz default now()
);

create table if not exists salary_periods (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  closed_at timestamptz,
  confirm_deadline date,
  pay_date date,
  status text default 'open'
);

create table if not exists salary_statements (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  employee_id uuid references employees(id) on delete cascade,
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

create table if not exists salary_complaints (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  employee_name text,
  period text not null,
  statement_id uuid references salary_statements(id),
  category text,
  description text not null,
  attachment_url text,
  status text default 'pending',
  admin_response text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists salary_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  employee_name text,
  amount numeric(12,2) not null,
  payment_date date,
  description text,
  status text default 'scheduled',
  payment_type text default 'salary',
  is_deduction boolean default false,
  period text,
  job_id uuid,
  notes text,
  received_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists equipment_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
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

alter table employee_contracts enable row level security;
alter table salary_periods enable row level security;
alter table salary_statements enable row level security;
alter table salary_complaints enable row level security;
alter table equipment_requests enable row level security;

drop policy if exists "allow_all_employee_contracts" on employee_contracts;
create policy "allow_all_employee_contracts" on employee_contracts for all using (true);
drop policy if exists "allow_all_salary_periods" on salary_periods;
create policy "allow_all_salary_periods" on salary_periods for all using (true);
drop policy if exists "allow_all_salary_statements" on salary_statements;
create policy "allow_all_salary_statements" on salary_statements for all using (true);
drop policy if exists "allow_all_salary_complaints" on salary_complaints;
create policy "allow_all_salary_complaints" on salary_complaints for all using (true);
drop policy if exists "allow_all_equipment_requests" on equipment_requests;
create policy "allow_all_equipment_requests" on equipment_requests for all using (true);

create index if not exists idx_equipment_requests_employee on equipment_requests(employee_id, created_at desc);

-- One 15th salary transfer per employee per month (weekly advances stay unrestricted)
create unique index if not exists salary_payments_one_salary_per_period
  on salary_payments (employee_id, period)
  where payment_type = 'salary' and coalesce(is_deduction, false) = false;
`.trim()
