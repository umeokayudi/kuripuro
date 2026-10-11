-- Portal do cliente v1.0.10: responsável, orçamentos, ficha do local e manutenção.
-- Segue o padrão atual do projeto (RLS ligado com política allow_all).

alter table public.clients
  add column if not exists manager_name text,
  add column if not exists manager_email text,
  add column if not exists manager_phone text,
  add column if not exists manager_line_url text,
  add column if not exists manager_photo_url text;

alter table public.client_requests
  add column if not exists request_type text default 'service',
  add column if not exists category text,
  add column if not exists quote_amount numeric,
  add column if not exists quote_note text,
  add column if not exists quote_status text,
  add column if not exists quoted_at timestamptz,
  add column if not exists decided_at timestamptz;

create table if not exists public.location_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  location_name text not null,
  address text,
  area_m2 numeric,
  seats integer,
  ac_units integer,
  grease_trap_count integer,
  grease_trap_size text,
  bathrooms integer,
  exhaust_fans integer,
  range_hoods integer,
  opening_hours text,
  access_notes text,
  notes text,
  updated_by text,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (client_id, location_name)
);

create table if not exists public.location_maintenance (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  location_name text not null,
  item_key text not null,
  last_done date,
  interval_days integer,
  notes text,
  updated_at timestamptz default now(),
  unique (client_id, location_name, item_key)
);

alter table public.location_profiles enable row level security;
alter table public.location_maintenance enable row level security;
drop policy if exists allow_all on public.location_profiles;
create policy allow_all on public.location_profiles for all using (true) with check (true);
drop policy if exists allow_all on public.location_maintenance;
create policy allow_all on public.location_maintenance for all using (true) with check (true);
