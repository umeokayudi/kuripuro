-- =============================================
-- KuriPuro by JBM — Supabase Schema
-- Run in Supabase SQL Editor
-- =============================================

-- Employees
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  date_of_birth date,
  address text,
  my_number text,
  contract_type text default 'Full-time',
  hourly_rate numeric(10,2) default 1100,
  bank_name text,
  bank_branch text,
  account_type text default '普通',
  account_number text,
  account_holder_katakana text,
  score integer default 100,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Clients
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  service_type text,
  monthly_revenue numeric(12,2),
  monthly_cost_estimate numeric(12,2),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Check-ins
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  employee_name text,
  client_id uuid references clients(id),
  client_name text,
  checkin_date date not null,
  checkin_type text not null check (checkin_type in ('in','out')),
  checkin_time time not null,
  transport_route text,
  transport_cost numeric(8,2) default 0,
  notes text,
  photo_before_url text,
  photo_during_url text,
  photo_after_url text,
  created_at timestamptz default now()
);

-- Complaints
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  employee_name text,
  client_id uuid references clients(id),
  client_name text,
  complaint_type text not null,
  points_deducted integer not null default 0,
  description text,
  complaint_date date not null default current_date,
  created_at timestamptz default now()
);

-- Payroll
create table if not exists payroll (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  employee_name text,
  period text not null,
  hours_worked numeric(6,2) default 0,
  base_salary numeric(12,2) default 0,
  transport_allowance numeric(10,2) default 0,
  bonus numeric(10,2) default 0,
  deductions numeric(10,2) default 0,
  net_total numeric(12,2) default 0,
  status text default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- Cashflow
create table if not exists cashflow (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income','expense')),
  category text,
  description text,
  amount numeric(12,2) not null,
  entry_date date not null default current_date,
  created_at timestamptz default now()
);

-- Ryoshu (Receipts)
create table if not exists ryoshu (
  id uuid primary key default gen_random_uuid(),
  receipt_number text unique not null,
  recipient text not null,
  service_description text,
  amount_incl_tax numeric(12,2) not null,
  tax_amount numeric(12,2),
  receipt_date date not null,
  pdf_url text,
  created_at timestamptz default now()
);

-- RLS: Enable for all tables (customize per user role)
alter table employees enable row level security;
alter table clients enable row level security;
alter table checkins enable row level security;
alter table complaints enable row level security;
alter table payroll enable row level security;
alter table cashflow enable row level security;
alter table ryoshu enable row level security;

-- Allow all for now (tighten per role later)
create policy "allow_all_employees" on employees for all using (true);
create policy "allow_all_clients" on clients for all using (true);
create policy "allow_all_checkins" on checkins for all using (true);
create policy "allow_all_complaints" on complaints for all using (true);
create policy "allow_all_payroll" on payroll for all using (true);
create policy "allow_all_cashflow" on cashflow for all using (true);
create policy "allow_all_ryoshu" on ryoshu for all using (true);
