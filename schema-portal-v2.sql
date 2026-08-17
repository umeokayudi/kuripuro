-- KuriPuro Portal v2 — run once in Supabase SQL Editor
-- Requires schema-client-portal.sql (client_users, client_messages, etc.)

-- Internal employee evaluations (0–100 score, Umeoka team only)
create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  employee_name text,
  job_id uuid,
  job_title text,
  type text not null check (type in ('positive', 'complaint')),
  stars integer check (stars between 1 and 5),
  points_change integer not null default 0,
  category text,
  description text,
  eval_date date not null default current_date,
  created_at timestamptz default now()
);

-- Client service quality ratings (1–5 stars, visible on master dashboard)
create table if not exists client_ratings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  client_user_id uuid references client_users(id) on delete set null,
  job_id uuid not null,
  employee_name text,
  location_name text,
  stars integer not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz default now(),
  unique(job_id)
);

-- Client compliments (positive feedback, does not affect internal score)
create table if not exists client_compliments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  client_user_id uuid references client_users(id) on delete set null,
  job_id uuid,
  location_name text,
  employee_name text,
  message text not null,
  status text default 'new' check (status in ('new', 'read', 'archived')),
  admin_response text,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- Training videos per location (YouTube unlisted URL + checklist)
alter table service_contracts add column if not exists training_video_url text;
alter table service_contracts add column if not exists training_checklist text;

-- Ticket number for client requests
alter table client_requests add column if not exists ticket_number text;

create index if not exists idx_evaluations_employee on evaluations(employee_id, created_at desc);
create index if not exists idx_client_ratings_client on client_ratings(client_id, created_at desc);
create index if not exists idx_client_ratings_stars on client_ratings(stars, created_at desc);
create index if not exists idx_client_compliments_client on client_compliments(client_id, created_at desc);

alter table evaluations enable row level security;
alter table client_ratings enable row level security;
alter table client_compliments enable row level security;

create policy if not exists "allow_all_evaluations" on evaluations for all using (true);
create policy if not exists "allow_all_client_ratings" on client_ratings for all using (true);
create policy if not exists "allow_all_client_compliments" on client_compliments for all using (true);
