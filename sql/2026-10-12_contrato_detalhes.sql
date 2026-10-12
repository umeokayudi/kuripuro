-- v1.0.36 · Detalhes do contrato (endereço escrito, responsável, 作業内容 em japonês e observações por item).
-- Somente aditivo. Desfazer:
--   alter table public.spot_contracts drop column if exists contract_details;
--   alter table public.service_contracts drop column if exists contract_details;
alter table public.spot_contracts add column if not exists contract_details jsonb not null default '{}'::jsonb;
alter table public.service_contracts add column if not exists contract_details jsonb not null default '{}'::jsonb;
