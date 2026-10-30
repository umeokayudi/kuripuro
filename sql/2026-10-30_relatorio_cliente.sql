-- v1.0.106 Relatório mensal do cliente (2026-10-30)
-- Só ADICIONA uma tabela; nada é apagado nem alterado.
-- Para que serve: guarda o relatório de cada cliente por mês. "draft" = rascunho (o sistema monta
-- no fechamento do mês; o cliente NÃO vê). "shared" = o admin revisou e compartilhou; o portal do
-- cliente mostra exatamente o conteúdo salvo (content), e cada loja vê só a própria loja.
-- Sem este SQL: a prévia e o PDF já funcionam; só não dá para guardar rascunho nem compartilhar no portal.
-- As notas "visível ao cliente" NÃO precisam de SQL (ficam marcadas no próprio texto da nota).

create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period text not null,                         -- 'AAAA-MM'
  status text not null default 'draft' check (status in ('draft', 'shared')),
  content jsonb not null default '{}'::jsonb,   -- o relatório pronto (sem horários, valores, GPS ou notas internas)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shared_at timestamptz,
  shared_by text,
  unique (client_id, period)
);
create index if not exists client_reports_client_idx on public.client_reports (client_id, period desc);

-- Mesmo padrão das outras tabelas do app hoje (RLS ligado, política aberta).
-- Quando o login passar para Supabase Auth, trocar por "cliente só lê status = 'shared' do próprio client_id".
alter table public.client_reports enable row level security;
drop policy if exists allow_all_client_reports on public.client_reports;
create policy allow_all_client_reports on public.client_reports for all using (true) with check (true);
