-- v1.0.131 · Migração única: pagamento do Gabriel em novembro/2026 sai da descrição para o campo.
-- Rodar SÓ depois de sql/2026-11-02_pagamento_funcionario_job.sql.
-- Lê "Pagamento do funcionário (Gabriel): ¥1.000 — ..." (ponto = separador de milhar) e preenche
-- jobs.employee_pay. A descrição NÃO é mexida. Só preenche quem está vazio.

-- PASSO 1 — prévia (não grava nada): job a job, valor lido.
select id, scheduled_date, title,
       nullif(replace(substring(description from 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *([0-9][0-9.,]*)'), '.', ''), '')::integer as pay_lido
from public.jobs
where employee_id = 'b62cc1a1-9750-4dbd-8f03-8a4c4aa4d86c'   -- Gabriel Santos Petricevich
  and scheduled_date between '2026-11-01' and '2026-11-30'
order by scheduled_date, scheduled_time;

-- PASSO 2 — grava (o app usa o nome abaixo na auditoria, caso algum job já esteja concluído).
update public.jobs j
set employee_pay = v.pay, employee_pay_updated_by = 'migração 2026-11-02 (descrição)'
from (
  select id, replace(replace(substring(description from 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *([0-9][0-9.,]*)'), '.', ''), ',', '')::integer as pay
  from public.jobs
  where employee_id = 'b62cc1a1-9750-4dbd-8f03-8a4c4aa4d86c'
    and scheduled_date between '2026-11-01' and '2026-11-30'
    and description ~ 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *[0-9]'
) v
where j.id = v.id and j.employee_pay is null;

-- PASSO 3 — conferência: tem que dar 36 jobs e ¥73.000 (24 × 1.000 + 4 × 6.000 + 8 × 3.125).
select count(*) filter (where employee_pay is not null) as jobs_com_valor,
       count(*) filter (where employee_pay is null)     as jobs_sem_valor,
       sum(employee_pay)                                as total,
       count(*) filter (where employee_pay = 1000) as de_1000,
       count(*) filter (where employee_pay = 6000) as de_6000,
       count(*) filter (where employee_pay = 3125) as de_3125
from public.jobs
where employee_id = 'b62cc1a1-9750-4dbd-8f03-8a4c4aa4d86c'
  and scheduled_date between '2026-11-01' and '2026-11-30';
