-- v1.0.101 Avisos de atribuição ao funcionário (2026-10-29)
-- Só ADICIONA uma tabela; nada é apagado nem alterado.
-- Para que serve: quando o admin dá, tira ou muda (dia/horário) um job de alguém, o funcionário
-- recebe um aviso no sino do portal e toca em "Ciente". O admin vê na Agenda quem ainda não viu.
-- Sem este SQL o app funciona igual: só não grava os avisos (a tela de Atribuir avisa isso).

create table if not exists public.job_notices (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  kind text not null,                 -- assigned | unassigned | changed
  title text,                         -- "Ibushio — Basic Cleaning" (fica mesmo se o job sumir)
  detail jsonb,                       -- { date, time, old_date, old_time }
  created_at timestamptz not null default now(),
  ack_at timestamptz                  -- quando o funcionário tocou em "Ciente"
);
create index if not exists job_notices_employee_idx on public.job_notices (employee_id, created_at desc);
create index if not exists job_notices_job_idx on public.job_notices (job_id, created_at desc);

-- Mesmo padrão das outras tabelas do app hoje (RLS ligado, política aberta).
-- Quando o login passar para Supabase Auth, trocar por política "só o próprio funcionário".
alter table public.job_notices enable row level security;
drop policy if exists allow_all_job_notices on public.job_notices;
create policy allow_all_job_notices on public.job_notices for all using (true) with check (true);
