-- ============================================================================
-- KuriPuro · DESFAZ a etapa 1 de segurança (volta as regras "liberado para todos")
-- Usar só se, depois de aplicar sql/2026-11-13_seguranca_etapa1_acesso_por_login.sql,
-- alguma tela parar de carregar e for preciso voltar na hora. Não mexe em dados.
-- ============================================================================
begin;
do $$
declare p record; t text;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public' and policyname like 'kp_%' loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_policies q where q.schemaname = 'public' and q.tablename = c.relname)
      and c.relname not in ('ai_memory','ai_messages','google_calendar_accounts','google_calendar_links','google_calendar_settings',
        'marketing_campaigns','marketing_channels','marketing_goals','marketing_spend','push_log','push_subscriptions',
        'sales_commission_rules','sales_contract_submissions','sales_goals','sales_notifications','sales_touchpoints')
  loop
    execute format('create policy %I on public.%I for all using (true) with check (true)', 'allow_all_' || t, t);
  end loop;
end $$;
drop policy if exists kp_photos_select on storage.objects;
drop policy if exists kp_photos_insert on storage.objects;
drop policy if exists kp_photos_update on storage.objects;
drop policy if exists kp_photos_delete on storage.objects;
create policy service_photos_select on storage.objects for select to anon, authenticated using (bucket_id = 'service-photos');
create policy service_photos_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'service-photos');
create policy service_photos_update on storage.objects for update to anon, authenticated using (bucket_id = 'service-photos');
create policy service_photos_delete on storage.objects for delete to anon, authenticated using (bucket_id = 'service-photos');
commit;
