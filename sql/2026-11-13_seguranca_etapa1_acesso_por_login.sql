-- ============================================================================
-- KuriPuro · SEGURANÇA ETAPA 1 · o banco só responde a quem está logado
-- ----------------------------------------------------------------------------
-- NÃO APLICADO. Só rodar com o OK do dono, e SÓ DEPOIS de:
--   1) a versão v1.0.234 (ou mais nova) estar em produção;
--   2) a variável SUPABASE_JWT_SECRET estar na Vercel (Production e Preview)
--      — é o "JWT Secret" do painel do Supabase (Settings → API);
--   3) todo mundo ter entrado de novo uma vez (o app pede sozinho).
-- Rodar antes disso deixa as telas vazias para quem ainda não recebeu a chave.
--
-- Hoje: qualquer pessoa na internet com a chave pública (que está na página)
-- lê e altera 53 tabelas, inclusive senhas.
-- Depois deste script:
--   • sem login            → nada;
--   • admin                → tudo, como hoje;
--   • funcionário/vendedor → como hoje, MENOS o caixa da empresa e os dados de
--                            salário dos colegas (só os próprios);
--   • cliente              → só as linhas do próprio cliente.
-- Não apaga nem altera nenhum dado: só troca as regras de acesso.
-- Para voltar atrás: rodar sql/2026-11-13_seguranca_etapa1_DESFAZER.sql
-- ============================================================================

begin;

-- Quem está falando (lido da chave que o servidor entrega no login) ------------
create or replace function public.kp_claims() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function public.kp_role() returns text language sql stable as $$
  select coalesce(public.kp_claims() ->> 'app_role', '')
$$;
create or replace function public.kp_uid() returns uuid language sql stable as $$
  select nullif(public.kp_claims() ->> 'sub', '')::uuid
$$;
create or replace function public.kp_client() returns uuid language sql stable as $$
  select nullif(public.kp_claims() ->> 'client_id', '')::uuid
$$;
create or replace function public.kp_admin() returns boolean language sql stable as $$
  select public.kp_role() = 'admin'
$$;
create or replace function public.kp_staff() returns boolean language sql stable as $$
  select public.kp_role() in ('admin', 'employee', 'salesperson')
$$;
-- Nome da empresa do cliente logado (para orçamentos, que não têm client_id).
create or replace function public.kp_client_name() returns text language sql stable security definer set search_path = public as $$
  select lower(trim(company_name)) from public.clients where id = public.kp_client()
$$;
-- Vendedores ligados ao cliente logado (o portal mostra nome e telefone deles).
create or replace function public.kp_client_sellers() returns setof uuid language sql stable security definer set search_path = public as $$
  select salesperson_id from public.clients where id = public.kp_client() and salesperson_id is not null
  union select salesperson_id from public.service_contracts where client_id = public.kp_client() and salesperson_id is not null
  union select salesperson_id from public.client_requests where client_id = public.kp_client() and salesperson_id is not null
$$;

do $$
declare
  t text;
  p record;
  -- só o admin (caixa e números da empresa; nenhuma tela de funcionário, vendedor ou cliente usa)
  admin_only text[] := array['cashflow','business_partners','ryoshu','payroll','salary_advances','jbm_financeiro','jbm_saques','hr_placements'];
  -- admin vê tudo; o funcionário só as próprias linhas (coluna employee_id)
  own_employee text[] := array['salary_statements','salary_payments','salary_complaints','payroll_pay_basis','transport_claims'];
  -- o cliente lê e escreve só as linhas do próprio client_id
  client_rw text[] := array['client_messages','client_requests','client_ratings','client_complaints','client_compliments','location_profiles','location_maintenance','facility_recommendations'];
  -- o cliente só lê as linhas do próprio client_id
  client_ro text[] := array['service_contracts','locations','faturas','facility_models','facility_service_log'];
begin
  -- 1) tira as regras "liberado para todos" (allow_all…) das tabelas do app
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and (policyname like 'allow_all%' or policyname like 'kp_%')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  -- 2) equipe: toda tabela do app passa a exigir login da equipe (inclusive alguma que estivesse sem trava)
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_policies q where q.schemaname = 'public' and q.tablename = c.relname)
      -- tabelas que já eram só do servidor continuam só do servidor
      and c.relname not in ('ai_memory','ai_messages','google_calendar_accounts','google_calendar_links','google_calendar_settings',
        'marketing_campaigns','marketing_channels','marketing_goals','marketing_spend','push_log','push_subscriptions',
        'sales_commission_rules','sales_contract_submissions','sales_goals','sales_notifications','sales_touchpoints')
  loop
    execute format('alter table public.%I enable row level security', t);
    if t = any(admin_only) then
      execute format('create policy kp_admin on public.%I for all to authenticated using (public.kp_admin()) with check (public.kp_admin())', t);
    elsif t = any(own_employee) then
      execute format('create policy kp_admin on public.%I for all to authenticated using (public.kp_admin()) with check (public.kp_admin())', t);
      execute format('create policy kp_own on public.%I for all to authenticated using (public.kp_role() = ''employee'' and employee_id = public.kp_uid()) with check (public.kp_role() = ''employee'' and employee_id = public.kp_uid())', t);
    else
      execute format('create policy kp_team on public.%I for all to authenticated using (public.kp_staff()) with check (public.kp_staff())', t);
    end if;
  end loop;

  -- 3) cliente: só o que é dele
  foreach t in array client_rw loop
    if to_regclass('public.' || t) is not null then
      execute format('create policy kp_client on public.%I for all to authenticated using (public.kp_role() = ''client'' and client_id = public.kp_client()) with check (public.kp_role() = ''client'' and client_id = public.kp_client())', t);
    end if;
  end loop;
  foreach t in array client_ro loop
    if to_regclass('public.' || t) is not null then
      execute format('create policy kp_client on public.%I for select to authenticated using (public.kp_role() = ''client'' and client_id = public.kp_client())', t);
    end if;
  end loop;
end $$;

-- cliente: a própria empresa, os próprios logins, os próprios serviços
create policy kp_client on public.clients for select to authenticated
  using (public.kp_role() = 'client' and id = public.kp_client());
create policy kp_client on public.client_users for select to authenticated
  using (public.kp_role() = 'client' and client_id = public.kp_client());
create policy kp_client_self on public.client_users for update to authenticated
  using (public.kp_role() = 'client' and id = public.kp_uid())
  with check (public.kp_role() = 'client' and id = public.kp_uid() and client_id = public.kp_client());
create policy kp_client on public.jobs for select to authenticated
  using (public.kp_role() = 'client' and (client_id = public.kp_client()
    or (client_id is null and lower(trim(client_name)) = public.kp_client_name())));
create policy kp_client on public.salespeople for select to authenticated
  using (public.kp_role() = 'client' and id in (select public.kp_client_sellers()));
-- orçamentos enviados ao cliente (a tabela não tem client_id: vale o nome da empresa)
create policy kp_client on public.mitsumori for select to authenticated
  using (public.kp_role() = 'client' and status in ('sent','accepted','declined','done')
    and public.kp_client_name() <> '' and (lower(company_name) like '%' || public.kp_client_name() || '%' or public.kp_client_name() like '%' || lower(trim(company_name)) || '%'));
create policy kp_client_answer on public.mitsumori for update to authenticated
  using (public.kp_role() = 'client' and status = 'sent'
    and public.kp_client_name() <> '' and (lower(company_name) like '%' || public.kp_client_name() || '%' or public.kp_client_name() like '%' || lower(trim(company_name)) || '%'))
  with check (public.kp_role() = 'client' and status in ('accepted','declined'));
create policy kp_client on public.mitsumori_items for select to authenticated
  using (public.kp_role() = 'client' and exists (select 1 from public.mitsumori m where m.id = mitsumori_id));

-- quando o cliente responde um orçamento, o lead daquele orçamento muda de etapa
create policy kp_client_quote on public.sales_leads for update to authenticated
  using (public.kp_role() = 'client' and exists (select 1 from public.mitsumori m where m.lead_id = sales_leads.id))
  with check (public.kp_role() = 'client');

-- 4) fotos e vídeos (bucket service-photos): só logado; apagar, só a equipe
drop policy if exists service_photos_select on storage.objects;
drop policy if exists service_photos_insert on storage.objects;
drop policy if exists service_photos_update on storage.objects;
drop policy if exists service_photos_delete on storage.objects;
drop policy if exists kp_photos_select on storage.objects;
drop policy if exists kp_photos_insert on storage.objects;
drop policy if exists kp_photos_update on storage.objects;
drop policy if exists kp_photos_delete on storage.objects;
create policy kp_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'service-photos' and public.kp_role() <> '');
create policy kp_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'service-photos' and public.kp_role() <> '');
create policy kp_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'service-photos' and public.kp_role() <> '');
create policy kp_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'service-photos' and public.kp_staff());

commit;

-- Conferir depois de rodar (deve listar só regras kp_…):
--   select tablename, policyname, cmd from pg_policies where schemaname in ('public','storage') order by 1, 2;
