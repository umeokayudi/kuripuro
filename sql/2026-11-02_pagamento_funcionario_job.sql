-- v1.0.131 · Pagamento do funcionário por job (2026-11-02)
-- Só ADICIONA colunas/tabelas; nada existente é apagado ou mudado.
--  1. jobs.employee_pay              → "Pagamento do funcionário (¥)", inteiro, opcional, nunca negativo.
--                                      Separado de jobs.value (Valor do contrato), que NÃO muda.
--     jobs.employee_pay_updated_by   → nome do admin que mexeu por último (o app preenche)
--     jobs.employee_pay_updated_at   → quando (o banco preenche)
--  2. job_pay_audit                  → histórico: toda mudança do pagamento de um job JÁ CONCLUÍDO
--                                      (valor antigo, novo, quem, quando). Gravado pelo próprio banco
--                                      (trigger), então não depende da tela.
--  3. payroll_pay_basis              → no Payroll Close, qual total vale no mês para a pessoa:
--                                      'fixed' (salário fixo) ou 'per_job' (soma por job), com quem
--                                      escolheu e quando. Nunca soma os dois.

alter table public.jobs add column if not exists employee_pay integer;
alter table public.jobs add column if not exists employee_pay_updated_by text;
alter table public.jobs add column if not exists employee_pay_updated_at timestamptz;
do $$ begin
  alter table public.jobs add constraint jobs_employee_pay_not_negative check (employee_pay is null or employee_pay >= 0);
exception when duplicate_object then null; end $$;

create table if not exists public.job_pay_audit (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  employee_id uuid,
  old_pay integer,
  new_pay integer,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists job_pay_audit_job_idx on public.job_pay_audit(job_id, changed_at desc);
alter table public.job_pay_audit enable row level security;
drop policy if exists allow_all_job_pay_audit on public.job_pay_audit;
create policy allow_all_job_pay_audit on public.job_pay_audit for all using (true) with check (true);

create or replace function public.jobs_employee_pay_audit() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.employee_pay is distinct from old.employee_pay then
    new.employee_pay_updated_at := now();
    if old.status = 'completed' then
      insert into public.job_pay_audit(job_id, employee_id, old_pay, new_pay, changed_by)
      values (new.id, new.employee_id, old.employee_pay, new.employee_pay, coalesce(nullif(new.employee_pay_updated_by, ''), 'desconhecido'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_employee_pay_audit on public.jobs;
create trigger trg_jobs_employee_pay_audit before update of employee_pay on public.jobs
  for each row execute function public.jobs_employee_pay_audit();

create table if not exists public.payroll_pay_basis (
  employee_id uuid not null references public.employees(id) on delete cascade,
  period text not null,                         -- 'YYYY-MM'
  basis text not null check (basis in ('fixed', 'per_job')),
  fixed_total integer,                          -- os dois totais no momento da escolha
  per_job_total integer,
  chosen_by text,
  chosen_at timestamptz not null default now(),
  primary key (employee_id, period)
);
alter table public.payroll_pay_basis enable row level security;
drop policy if exists allow_all_payroll_pay_basis on public.payroll_pay_basis;
create policy allow_all_payroll_pay_basis on public.payroll_pay_basis for all using (true) with check (true);
