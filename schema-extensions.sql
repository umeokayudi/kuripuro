-- KuriPuro v9 — Run once in Supabase SQL Editor

-- Employee employment contracts (PDF + AI extraction)
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

-- Monthly salary periods (close → confirm → pay)
create table if not exists salary_periods (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  closed_at timestamptz,
  confirm_deadline date,
  pay_date date,
  status text default 'open'
);

-- Per-employee monthly statement
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

-- Employee salary complaints
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

alter table employee_contracts enable row level security;
alter table salary_periods enable row level security;
alter table salary_statements enable row level security;
alter table salary_complaints enable row level security;

create policy if not exists "allow_all_employee_contracts" on employee_contracts for all using (true);
create policy if not exists "allow_all_salary_periods" on salary_periods for all using (true);
create policy if not exists "allow_all_salary_statements" on salary_statements for all using (true);
create policy if not exists "allow_all_salary_complaints" on salary_complaints for all using (true);

-- Service reports (synced from completed jobs)
create table if not exists service_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique,
  employee_id uuid,
  employee_name text,
  client_name text,
  job_title text,
  report_date date,
  time_in text,
  time_out text,
  duration_min integer,
  report_type text,
  notes_out text,
  retro_ai_summary text,
  checklist_done integer,
  checklist_total integer,
  checklist_missed_items text,
  photo_ai_score numeric,
  photo_ai_approved boolean,
  photo_ai_issues text,
  photo_before_url text,
  photo_during_url text,
  photo_after_url text,
  signature_url text,
  job_value numeric,
  pdf_url text,
  created_at timestamptz default now()
);
alter table service_reports enable row level security;
create policy if not exists "allow_all_service_reports" on service_reports for all using (true);
