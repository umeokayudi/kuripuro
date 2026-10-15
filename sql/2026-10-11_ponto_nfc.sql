-- v1.0.25 · Ponto por NFC: the worker taps an NFC sticker at the location to start and to finish a job.
-- Off by default. Additive only: new tables/columns, nothing existing changes.
-- Same open policy as the other tables (allow_all), since the app reads with the anon key.

-- One row (id = 1) with the global switch.
create table if not exists public.nfc_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  updated_at timestamptz default now()
);
insert into public.nfc_settings (id, enabled) values (1, false) on conflict (id) do nothing;

-- Stickers registered by the admin, one per location (or per client when no location).
create table if not exists public.nfc_tags (
  id uuid primary key default gen_random_uuid(),
  tag_uid text not null unique,          -- serial number, upper-case hex without separators
  label text,
  client_id uuid,
  client_name text,
  location_name text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz default now()
);

-- Per worker: null = follow the global switch, 'on' = always ask, 'off' = never ask.
alter table public.employees
  add column if not exists nfc_clock text;

-- What happened at start and finish of each job.
-- status: ok | other_place | unknown | skipped | no_device
alter table public.jobs
  add column if not exists nfc_start_tag text,
  add column if not exists nfc_start_status text,
  add column if not exists nfc_end_tag text,
  add column if not exists nfc_end_status text;

alter table public.nfc_settings enable row level security;
alter table public.nfc_tags enable row level security;
drop policy if exists allow_all on public.nfc_settings;
create policy allow_all on public.nfc_settings for all using (true) with check (true);
drop policy if exists allow_all on public.nfc_tags;
create policy allow_all on public.nfc_tags for all using (true) with check (true);
