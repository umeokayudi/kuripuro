-- v1.0.179 · Sincronizar Google Agenda
-- Só cria tabelas novas; não muda nada que já existe. Pode rodar de novo sem problema.
-- As três tabelas ficam com RLS ligado e SEM policies: só o servidor (service role) lê e grava,
-- então o token do Google nunca chega ao navegador.

create table if not exists public.google_calendar_settings (
  id int primary key default 1 check (id = 1),
  company_tag text not null default 'JBM',          -- vai no título de todo evento: "[JBM] Loja — Basic Cleaning"
  color_id text default '9',                         -- cor do evento no Google (1..11)
  auto_import text not null default 'preview' check (auto_import in ('off', 'preview', 'create')),
  auto_export boolean not null default true,         -- coloca os serviços na agenda de cada um
  days_ahead int not null default 60,
  default_hours numeric not null default 2,
  updated_by text,
  updated_at timestamptz default now()
);
insert into public.google_calendar_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.google_calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('admin', 'employee')),
  owner_id text not null,                            -- admins.id ou employees.id
  owner_name text,
  google_email text not null,
  refresh_token_enc text,                            -- criptografado no servidor (AES-256-GCM)
  calendars jsonb not null default '[]'::jsonb,      -- [{ id, summary, primary, import }]
  write_calendar_id text not null default 'primary',
  import_enabled boolean not null default true,
  export_enabled boolean not null default true,
  export_scope text not null default 'mine' check (export_scope in ('mine', 'all')),
  last_import_at timestamptz,
  last_export_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (owner_kind, owner_id, google_email)
);

create table if not exists public.google_calendar_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.google_calendar_accounts(id) on delete cascade,
  calendar_id text not null,
  google_event_id text not null,
  status text not null check (status in ('pending', 'imported', 'ignored', 'exported')),
  job_id uuid references public.jobs(id) on delete set null,
  draft jsonb,                                       -- sugestão da IA esperando revisão (status pending)
  event_updated text,                                -- "updated" do Google, para saber se mudou
  job_hash text,                                     -- para não reenviar um serviço que não mudou
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (account_id, calendar_id, google_event_id)
);
create index if not exists google_calendar_links_job_idx on public.google_calendar_links (job_id);
create index if not exists google_calendar_links_status_idx on public.google_calendar_links (status);

alter table public.google_calendar_settings enable row level security;
alter table public.google_calendar_accounts enable row level security;
alter table public.google_calendar_links enable row level security;
