-- v1.0.96 Agenda do Dia + local único (2026-10-29)
-- Só ADICIONA tabelas/colunas; nada é apagado. O app funciona antes e depois deste SQL:
-- sem ele, tolerância/teto ficam no padrão (30 min / 2×), o log de "Ajustar tempo" não é gravado
-- (o botão avisa) e o local único é montado só na tela, juntando locations + contratos pelo nome.

-- 1) Configurações do sistema (tolerância do alerta, teto automático)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.app_settings enable row level security;
drop policy if exists allow_all_app_settings on public.app_settings;
create policy allow_all_app_settings on public.app_settings for all using (true) with check (true);
insert into public.app_settings (key, value)
values ('agenda', '{"tolerance_min": 30, "cap_factor": 2}'::jsonb)
on conflict (key) do nothing;

-- 2) Log de ações do admin no job (Ajustar tempo, concluir pelo admin, teto confirmado)
create table if not exists public.job_admin_log (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  action text not null,
  reason text,
  old_value jsonb,
  new_value jsonb,
  admin_name text,
  created_at timestamptz not null default now()
);
create index if not exists job_admin_log_job_idx on public.job_admin_log (job_id, created_at desc);
alter table public.job_admin_log enable row level security;
drop policy if exists allow_all_job_admin_log on public.job_admin_log;
create policy allow_all_job_admin_log on public.job_admin_log for all using (true) with check (true);

-- 3) Duração prevista por job (vazio = vem do contrato do local)
alter table public.jobs add column if not exists expected_minutes integer;

-- 4) Local único: a tabela locations vira o cadastro de local usado por Jobs, Contracts,
--    Manager & stores e Generator. Contratos, jobs e perfis apontam para ela.
alter table public.locations add column if not exists checklist text;
alter table public.locations add column if not exists key_box text;
alter table public.locations add column if not exists area text;
alter table public.service_contracts add column if not exists location_id uuid references public.locations(id);
alter table public.location_profiles add column if not exists location_id uuid references public.locations(id);
alter table public.jobs add column if not exists location_id uuid references public.locations(id);

-- 4a) Cria o local que falta para cada loja de contrato ("Ibushio — AC Cleaning" → loja "Ibushio")
with stores as (
  select distinct on (lower(base)) base, client_id, location_address
  from (
    select trim(regexp_replace(location_name, '\s+(—|-)\s+.*$', '')) as base, client_id, location_address, is_active
    from public.service_contracts
  ) s
  where base <> ''
  order by lower(base), is_active desc
)
insert into public.locations (name, address, client_id, location_type, is_active)
select st.base, st.location_address, st.client_id, 'fixed', true
from stores st
where not exists (select 1 from public.locations l where lower(l.name) = lower(st.base) and l.is_active);

-- 4b) Locais sem cliente herdam o cliente do contrato
update public.locations l set client_id = sc.client_id
from public.service_contracts sc
where l.client_id is null and l.is_active
  and lower(trim(regexp_replace(sc.location_name, '\s+(—|-)\s+.*$', ''))) = lower(l.name);

-- 4c) Liga contratos, jobs e perfis ao local
update public.service_contracts sc set location_id = l.id
from public.locations l
where sc.location_id is null and l.is_active
  and lower(trim(regexp_replace(sc.location_name, '\s+(—|-)\s+.*$', ''))) = lower(l.name);

update public.jobs j set location_id = l.id
from public.locations l
where j.location_id is null and l.is_active
  and lower(trim(regexp_replace(j.title, '\s+—\s+.*$', ''))) = lower(l.name);

update public.location_profiles p set location_id = l.id
from public.locations l
where p.location_id is null and l.is_active and lower(p.location_name) = lower(l.name);
