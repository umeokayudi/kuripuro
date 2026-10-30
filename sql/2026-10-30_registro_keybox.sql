-- v1.0.107 · Registro de quem revelou um código de key box (aditivo, não mexe em dados existentes).
-- Sem esta tabela o app continua funcionando: o código fica mascarado e o registro é só ignorado.
create table if not exists public.key_reveal_log (
  id uuid primary key default gen_random_uuid(),
  viewer_id text,
  viewer_name text,
  viewer_role text not null,
  source text not null,          -- 'contract', 'job', 'place', 'agenda', 'employee_job'
  ref_id text,                   -- id do contrato / job / local
  ref_label text,                -- nome do local, para ler o registro sem abrir outra tela
  created_at timestamptz not null default now()
);
create index if not exists key_reveal_log_created_idx on public.key_reveal_log (created_at desc);
alter table public.key_reveal_log enable row level security;
drop policy if exists allow_all_key_reveal_log on public.key_reveal_log;
create policy allow_all_key_reveal_log on public.key_reveal_log for all using (true) with check (true);
