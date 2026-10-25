-- v1.0.83 · Notificações push (Web Push) para admin, funcionários, vendedores e clientes.
-- Rodar UMA vez no Supabase → SQL Editor, só depois do OK do dono.
-- Pode rodar de novo sem problema (tudo é "if not exists" / "or replace").
--
-- O que cria:
--   1. push_subscriptions: um registro por navegador/celular que ativou as notificações.
--   2. push_log: cada aviso enviado (para nunca mandar o mesmo duas vezes).
--   3. Gatilhos: quando entra/muda algo importante (mensagem, folga, orçamento, fatura…),
--      o banco chama https://kuripuro.vercel.app/api/push?op=event com { tabela, id }.
--      O servidor relê a linha e decide quem recebe. O banco não manda texto nenhum.
-- As duas tabelas novas ficam fechadas (RLS sem políticas): só o servidor (service_role) lê e grava.

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  role text not null check (role in ('admin', 'employee', 'salesperson', 'client')),
  user_id uuid not null,
  client_id uuid,
  lang text not null default 'en',
  user_agent text,
  fail_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_role_user_idx on public.push_subscriptions (role, user_id);
create index if not exists push_subscriptions_role_client_idx on public.push_subscriptions (role, client_id);

create table if not exists public.push_log (
  dedupe_key text primary key,
  recipient text,
  sent integer,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_log enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_log from anon, authenticated;

-- Envia { table, op, id, old } para a API. Nunca bloqueia nem desfaz a gravação original:
-- se a chamada falhar, a mensagem/folga/etc. continua salva normalmente.
create or replace function public.kp_push_forward()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_url constant text := 'https://kuripuro.vercel.app/api/push?op=event';
  old_bits jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    old_bits := jsonb_build_object(
      'status', to_jsonb(old) ->> 'status',
      'employee_id', to_jsonb(old) ->> 'employee_id',
      'quote_status', to_jsonb(old) ->> 'quote_status',
      'salesperson_id', to_jsonb(old) ->> 'salesperson_id'
    );
  end if;
  perform net.http_post(
    url := api_url,
    body := jsonb_build_object('table', tg_table_name, 'op', tg_op, 'id', new.id, 'old', old_bits),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.kp_push_forward() from public, anon, authenticated;

-- Novos registros
drop trigger if exists kp_push_ins on public.messages;
create trigger kp_push_ins after insert on public.messages for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.client_messages;
create trigger kp_push_ins after insert on public.client_messages for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.employee_availability;
create trigger kp_push_ins after insert on public.employee_availability for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.jobs;
create trigger kp_push_ins after insert on public.jobs for each row when (new.employee_id is not null) execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.client_requests;
create trigger kp_push_ins after insert on public.client_requests for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.client_complaints;
create trigger kp_push_ins after insert on public.client_complaints for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.faturas;
create trigger kp_push_ins after insert on public.faturas for each row when (new.status = 'sent') execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.salary_complaints;
create trigger kp_push_ins after insert on public.salary_complaints for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.equipment_requests;
create trigger kp_push_ins after insert on public.equipment_requests for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.transport_claims;
create trigger kp_push_ins after insert on public.transport_claims for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.sales_notifications;
create trigger kp_push_ins after insert on public.sales_notifications for each row execute function public.kp_push_forward();
drop trigger if exists kp_push_ins on public.salary_payments;
create trigger kp_push_ins after insert on public.salary_payments for each row when (new.status = 'paid') execute function public.kp_push_forward();

-- Mudanças de situação (só quando o campo que importa muda, não em toda edição)
drop trigger if exists kp_push_upd on public.employee_availability;
create trigger kp_push_upd after update on public.employee_availability for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.jobs;
create trigger kp_push_upd after update on public.jobs for each row
  when (old.status is distinct from new.status or old.employee_id is distinct from new.employee_id) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.client_requests;
create trigger kp_push_upd after update on public.client_requests for each row
  when (old.status is distinct from new.status or old.quote_status is distinct from new.quote_status or old.salesperson_id is distinct from new.salesperson_id)
  execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.client_complaints;
create trigger kp_push_upd after update on public.client_complaints for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.faturas;
create trigger kp_push_upd after update on public.faturas for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.salary_complaints;
create trigger kp_push_upd after update on public.salary_complaints for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.salary_payments;
create trigger kp_push_upd after update on public.salary_payments for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.equipment_requests;
create trigger kp_push_upd after update on public.equipment_requests for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();
drop trigger if exists kp_push_upd on public.transport_claims;
create trigger kp_push_upd after update on public.transport_claims for each row
  when (old.status is distinct from new.status) execute function public.kp_push_forward();

-- Para DESLIGAR tudo de uma vez (se precisar), rode:
--   do $$ declare t text; begin
--     foreach t in array array['messages','client_messages','employee_availability','jobs','client_requests','client_complaints','faturas','salary_complaints','equipment_requests','transport_claims','sales_notifications','salary_payments'] loop
--       execute format('drop trigger if exists kp_push_ins on public.%I', t);
--       execute format('drop trigger if exists kp_push_upd on public.%I', t);
--     end loop; end $$;
