-- v1.0.151 · Shift do dia: marca por dia específico, auditada (quem marcou e quando).
-- NÃO APLICADO — rodar só com o OK do dono. O app funciona sem ele:
--   · as marcas ✅ Confirmado / ✕ Não posso / ＋ Trabalho extra já são gravadas em employee_availability
--     (kind 'confirmed' | 'off' | 'extra'; a coluna kind não tem restrição, nada muda nas linhas atuais);
--   · sem este SQL, "quem marcou" fica só na nota do admin (admin_note = 'Marcado pelo admin …').
-- Com ele: colunas marked_by / marked_by_role + histórico imutável de cada marca (inserir/mudar/apagar).

alter table public.employee_availability
  add column if not exists marked_by text,
  add column if not exists marked_by_role text check (marked_by_role is null or marked_by_role in ('employee', 'admin'));

create table if not exists public.employee_availability_log (
  id bigint generated always as identity primary key,
  availability_id uuid,
  employee_id uuid,
  employee_name text,
  date date,
  action text not null,            -- insert | update | delete
  kind text,
  status text,
  note text,
  old_kind text,
  old_status text,
  marked_by text,
  marked_by_role text,
  at timestamptz not null default now()
);
create index if not exists employee_availability_log_emp_date on public.employee_availability_log (employee_id, date);

create or replace function public.log_employee_availability() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into employee_availability_log (availability_id, employee_id, employee_name, date, action, old_kind, old_status, marked_by, marked_by_role)
    values (old.id, old.employee_id, old.employee_name, old.date, 'delete', old.kind, old.status, old.marked_by, old.marked_by_role);
    return old;
  end if;
  insert into employee_availability_log (availability_id, employee_id, employee_name, date, action, kind, status, note, old_kind, old_status, marked_by, marked_by_role)
  values (new.id, new.employee_id, new.employee_name, new.date, lower(tg_op), new.kind, new.status, new.note,
          case when tg_op = 'UPDATE' then old.kind end, case when tg_op = 'UPDATE' then old.status end,
          new.marked_by, new.marked_by_role);
  return new;
end $$;

drop trigger if exists employee_availability_log_trg on public.employee_availability;
create trigger employee_availability_log_trg after insert or update or delete on public.employee_availability
  for each row execute function public.log_employee_availability();

-- the log is read-only for the app (only the trigger writes; nobody edits or deletes history)
alter table public.employee_availability_log enable row level security;
drop policy if exists employee_availability_log_read on public.employee_availability_log;
create policy employee_availability_log_read on public.employee_availability_log for select using (true);
