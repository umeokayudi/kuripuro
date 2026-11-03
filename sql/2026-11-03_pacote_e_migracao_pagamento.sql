-- v1.0.148 · Pagamento por job para TODOS + pacote mensal (2026-11-03)
-- Rodar DEPOIS de sql/2026-11-02_pagamento_funcionario_job.sql (cria jobs.employee_pay).
-- Só adiciona / preenche campos vazios. Descrições, valores do contrato e status NÃO mudam.
-- Guilherme continua Per Job (mudança feita pelo dono em 03/11) — nada aqui mexe no cadastro dele,
-- além do pacote mensal da Atomic (passo 4), que só é gravado com o seu OK.

-- PASSO 1 — coluna do pacote mensal (lista; vazio = sem pacote)
alter table public.employees add column if not exists pay_packages jsonb;

-- PASSO 2 — PRÉVIA (não grava): por pessoa e valor, o que a migração vai escrever em jobs.employee_pay.
-- Lido de "Pagamento do funcionário (Nome): ¥X" (ponto/vírgula = milhar). Esperado em 03/11:
--   Gabriel:   36 jobs = ¥73.000 (24 × 1.000 + 8 × 3.125 + 4 × 6.000)
--   Guilherme: 213 jobs (2 já cancelados) — básicas ¥1.000, manutenções ¥1.471 / ¥1.470
select employee_name,
       replace(replace(substring(description from 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *([0-9][0-9.,]*)'), '.', ''), ',', '')::integer as pay,
       count(*) as jobs,
       count(*) filter (where status = 'cancelled') as cancelados,
       sum(replace(replace(substring(description from 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *([0-9][0-9.,]*)'), '.', ''), ',', '')::integer) filter (where status <> 'cancelled') as total_sem_cancelados
from public.jobs
where description ~ 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *[0-9]'
group by 1, 2 order by 1, 2;

-- PASSO 3 — grava (só onde employee_pay está vazio; cancelados também recebem, para o histórico).
update public.jobs j
set employee_pay = v.pay, employee_pay_updated_by = 'migração 2026-11-03 (descrição)'
from (
  select id, replace(replace(substring(description from 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *([0-9][0-9.,]*)'), '.', ''), ',', '')::integer as pay
  from public.jobs
  where description ~ 'Pagamento do funcion[áa]rio \([^)]*\): *¥ *[0-9]'
) v
where j.id = v.id and j.employee_pay is null;

-- PASSO 4 — pacote mensal da Atomic Bar do Guilherme (¥35.000/mês, à parte da soma por job).
-- Os jobs da Atomic dele ficam "no pacote" (nunca "a definir", nunca ¥0). Mês inicial: 2026-11.
update public.employees
set pay_packages = '[{"client_name":"Atomic Bar","amount":35000,"from":"2026-11"}]'::jsonb
where id = '8772f25f-7bd2-460d-8818-ad3bad3ab541' and pay_packages is null;   -- Guilherme Henrique

-- PASSO 5 — conferência por pessoa (novembro, sem cancelados).
select employee_name,
       count(*) filter (where employee_pay is not null) as com_valor,
       count(*) filter (where employee_pay is null)     as a_definir_ou_pacote,
       sum(employee_pay)                                as soma_por_job
from public.jobs
where scheduled_date between '2026-11-01' and '2026-11-30' and status <> 'cancelled'
  and employee_name in ('Gabriel Santos Petricevich', 'Guilherme Henrique')
group by 1 order by 1;
