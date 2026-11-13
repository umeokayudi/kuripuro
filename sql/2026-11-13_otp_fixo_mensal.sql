-- v1.0.256 · On The Planet no modelo fixo mensal por loja (regra do dono, 13/11/2026).
-- NÃO APLICADO. Só rodar com o OK do dono. Mexe só em service_contracts/clients do On The Planet;
-- não toca em jobs, faturas já emitidas, folha nem geração de serviços (a geração não lê estes campos).
-- Resultado: Contratos mostra ¥898.000/mês; fatura mensal = 11 linhas fixas, ¥898.000 + 10% = ¥987.800.
begin;

-- 1) Lojas sem item fixo: o item principal passa a ser o fixo da loja.
update service_contracts s set billing_type = 'fixed_monthly', fixed_monthly = v.fixo, monthly_revenue = v.fixo
from (values ('Ibushio', 15000), ('Nyu Ibushio', 15000), ('Yakiniku Otoko Manmosu', 8000)) as v(loja, fixo), clients c
where c.id = s.client_id and c.company_name = 'On The Planet' and s.is_active and s.location_name = v.loja;

-- 2) Deep Clean e as partes agendadas (Range Hood, AC, Grease Trap, Grill, Stove…): operacionais, já embutidos
--    no fixo → ¥0 no total e fora da fatura. Continuam gerando e registrando os serviços (dias e preço ficam).
update service_contracts s set monthly_revenue = 0
from clients c
where c.id = s.client_id and c.company_name = 'On The Planet' and s.is_active
  and coalesce(s.billing_type, 'per_visit') <> 'fixed_monthly' and coalesce(s.visits_per_month, 0) > 0;

-- 3) Valores do OTP são sem imposto (fatura = ¥898.000 + 10%).
update service_contracts s set price_includes_tax = false
from clients c where c.id = s.client_id and c.company_name = 'On The Planet' and s.is_active;

-- 4) Cópia antiga do total no cliente.
update clients set monthly_revenue = 898000 where company_name = 'On The Planet';

-- Conferência (tem que dar 898000):
select sum(case when s.billing_type = 'fixed_monthly' then s.fixed_monthly else s.monthly_revenue end) as total_mensal
from service_contracts s join clients c on c.id = s.client_id
where c.company_name = 'On The Planet' and s.is_active;

commit;
