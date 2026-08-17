-- KuriPuro Client Portal — run once in Supabase SQL Editor

-- Portal login per client company (optionally scoped to one location/restaurant)
create table if not exists client_users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  client_name text,
  location_name text,
  contact_name text not null,
  email text not null unique,
  password text not null,
  is_active boolean default true,
  last_seen timestamptz,
  created_at timestamptz default now()
);

-- Chat between admin and client
create table if not exists client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  client_user_id uuid references client_users(id) on delete set null,
  client_name text,
  location_name text,
  sender text not null check (sender in ('admin', 'client')),
  content text not null,
  read boolean default false,
  created_at timestamptz default now()
);

-- Client complaints about a visit
create table if not exists client_complaints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  client_user_id uuid references client_users(id) on delete set null,
  job_id uuid,
  location_name text,
  employee_name text,
  category text default 'quality',
  description text not null,
  status text default 'open',
  admin_response text,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- Specific cleaning / service requests from client
create table if not exists client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  client_user_id uuid references client_users(id) on delete set null,
  location_name text,
  description text not null,
  preferred_date date,
  status text default 'pending',
  admin_notes text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

alter table service_reports add column if not exists client_id uuid references clients(id);
alter table service_reports add column if not exists location_name text;
alter table service_reports add column if not exists photo_comment text;

alter table client_users enable row level security;
alter table client_messages enable row level security;
alter table client_complaints enable row level security;
alter table client_requests enable row level security;

create policy if not exists "allow_all_client_users" on client_users for all using (true);
create policy if not exists "allow_all_client_messages" on client_messages for all using (true);
create policy if not exists "allow_all_client_complaints" on client_complaints for all using (true);
create policy if not exists "allow_all_client_requests" on client_requests for all using (true);

create index if not exists idx_client_messages_client on client_messages(client_id, created_at);
create index if not exists idx_client_complaints_client on client_complaints(client_id, created_at desc);
create index if not exists idx_client_requests_client on client_requests(client_id, created_at desc);
create index if not exists idx_jobs_client_date on jobs(client_id, scheduled_date);
