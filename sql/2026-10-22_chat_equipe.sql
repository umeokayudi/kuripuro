-- v1.0.72 · Chat between employees, their leader and the office (diretoria).
-- Adds only: one nullable column on employees + one new table. Nothing is deleted or rewritten.

-- Leader of each employee, chosen by the admin (Employees > profile > Edit).
alter table public.employees
  add column if not exists leader_id uuid references public.employees(id) on delete set null;

-- Direct messages between two employees (the office chat stays in public.messages).
create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  from_employee_id uuid not null references public.employees(id) on delete cascade,
  to_employee_id uuid not null references public.employees(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint team_messages_not_self check (from_employee_id <> to_employee_id)
);

create index if not exists team_messages_to_idx on public.team_messages (to_employee_id, created_at desc);
create index if not exists team_messages_from_idx on public.team_messages (from_employee_id, created_at desc);

-- Same access model as public.messages today (allow_all_messages).
alter table public.team_messages enable row level security;
drop policy if exists allow_all_team_messages on public.team_messages;
create policy allow_all_team_messages on public.team_messages for all using (true) with check (true);
