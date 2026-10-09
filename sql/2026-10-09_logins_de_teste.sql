-- Kuripuro — contas de teste (uma por tipo de usuário). Senha de todas: Teste@2026
-- Para apagar depois: ver o bloco no final.
insert into public.admins (name, email, password)
select 'TESTE Admin', 'teste.admin@kuripuro.com', 'Teste@2026'
where not exists (select 1 from public.admins where email = 'teste.admin@kuripuro.com');

insert into public.employees (full_name, email, password, is_active, contract_type, salary_type, hourly_rate, score, notes)
select 'TESTE Funcionario', 'teste.funcionario@kuripuro.com', 'Teste@2026', true, 'part', 'hourly', 1200, 100, 'Conta de teste (2026-10-09)'
where not exists (select 1 from public.employees where email = 'teste.funcionario@kuripuro.com');

insert into public.clients (company_name, is_active, notes)
select 'TESTE Cliente', true, 'Conta de teste (2026-10-09)'
where not exists (select 1 from public.clients where company_name = 'TESTE Cliente');

insert into public.client_users (client_id, client_name, location_name, contact_name, email, password, is_active)
select c.id, 'TESTE Cliente', 'TESTE Loja', 'TESTE Contato', 'teste.cliente@kuripuro.com', 'Teste@2026', true
from public.clients c
where c.company_name = 'TESTE Cliente'
  and not exists (select 1 from public.client_users where email = 'teste.cliente@kuripuro.com');

insert into public.salespeople (full_name, email, password_hash, is_active)
select 'TESTE Vendedor', 'teste.vendedor@kuripuro.com',
  'scrypt$0fe03443598d92525598e9831086471e$5ae9227cbf9931650d38bfe025b836214e9774a8131acf96c26ed292d6abfc25d01b0a5c7da2d98341b0e189b15272bdbc71f8c53e0992be047fdbd5d6bd33e2', true
where not exists (select 1 from public.salespeople where email = 'teste.vendedor@kuripuro.com');

-- Apagar as contas de teste:
-- delete from public.client_users where email = 'teste.cliente@kuripuro.com';
-- delete from public.clients where company_name = 'TESTE Cliente';
-- delete from public.employees where email = 'teste.funcionario@kuripuro.com';
-- delete from public.admins where email = 'teste.admin@kuripuro.com';
-- delete from public.salespeople where email = 'teste.vendedor@kuripuro.com';
