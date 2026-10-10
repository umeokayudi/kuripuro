-- v1.0.12 · Employee availability (days off, extra work) and weekly plans.
-- Applied on 2026-10-09 to project fxsakrshmldmkdmbevna.

create table if not exists employee_availability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  employee_name text,
  date date not null,
  kind text not null default 'available',   -- available | off | extra
  note text,
  status text not null default 'pending',   -- pending | approved | rejected
  admin_note text,
  decided_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (employee_id, date)
);

create table if not exists employee_week_plans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  employee_name text,
  week_start date not null,                 -- Monday
  note text,
  submitted_at timestamptz default now(),
  unique (employee_id, week_start)
);

alter table employee_availability enable row level security;
alter table employee_week_plans enable row level security;
create policy allow_all on employee_availability for all using (true) with check (true);
create policy allow_all on employee_week_plans for all using (true) with check (true);
