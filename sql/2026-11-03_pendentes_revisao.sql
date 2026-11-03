-- v1.0.133 · Pendentes da revisão de 03/11/2026 — SQL NOT applied yet: needs the user's explicit OK.
-- Only ADDS columns / one table; nothing is deleted. The app already works before it runs
-- (name/e-mail rule for tests, local browser memory for discarded suggestions, "Excluir" waits for it).

-- 4 · "é teste": kept in the database, never counted in any total / active list / report.
alter table employees     add column if not exists is_test boolean not null default false;
alter table clients       add column if not exists is_test boolean not null default false;
alter table client_users  add column if not exists is_test boolean not null default false;
alter table salespeople   add column if not exists is_test boolean not null default false;
alter table jobs          add column if not exists is_test boolean not null default false;
-- mark the existing test records (names / e-mails starting with "TESTE" / "Test")
update employees    set is_test = true where full_name ~* '^(teste?|test)\M' or split_part(coalesce(email,''),'@',1) ~* '^(teste?|test)\M';
update clients      set is_test = true where company_name ~* '^(teste?|test)\M';
update client_users set is_test = true where coalesce(client_name,'') ~* '^(teste?|test)\M' or coalesce(contact_name,'') ~* '^(teste?|test)\M' or split_part(coalesce(email,''),'@',1) ~* '^(teste?|test)\M';
update salespeople  set is_test = true where full_name ~* '^(teste?|test)\M' or split_part(coalesce(email,''),'@',1) ~* '^(teste?|test)\M';
update jobs         set is_test = true where coalesce(employee_name,'') ~* '^(teste?|test)\M' or coalesce(client_name,'') ~* '^(teste?|test)\M';

-- 1 · payroll: who the admin took out of a month (everyone active is in by default).
alter table salary_periods add column if not exists excluded_ids uuid[] not null default '{}';

-- 7 · Schedule Generator: a discarded suggestion never comes back (per date / store / type), with undo.
create table if not exists schedule_dismissals (
  id uuid primary key default gen_random_uuid(),
  dismiss_key text not null unique,        -- '<date>|<store>|<type>' (same key as the preview)
  scheduled_date date not null,
  location_name text,
  service_type text,
  title text,
  employee_id uuid,
  dismissed_by text,
  dismissed_at timestamptz not null default now()
);
alter table schedule_dismissals enable row level security;
-- same open policy as the other admin tables of the app (anon key + admin session in the browser)
drop policy if exists schedule_dismissals_all on schedule_dismissals;
create policy schedule_dismissals_all on schedule_dismissals for all using (true) with check (true);
