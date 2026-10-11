-- Kuripuro rebuild — colunas que o app usa e que não existiam no banco (2026-10-09).
-- Tudo aditivo (add column if not exists). Rodar uma vez no Supabase SQL Editor.

-- Perfil do funcionário seleciona hire_date: sem ela a tela inteira do perfil falha.
alter table public.employees add column if not exists hire_date date;

-- Relatórios de serviço sincronizados a partir dos trabalhos concluídos (src/lib/jobReport.js).
alter table public.service_reports add column if not exists job_id uuid;
alter table public.service_reports add column if not exists job_title text;
alter table public.service_reports add column if not exists duration_min integer;
alter table public.service_reports add column if not exists report_type text;
alter table public.service_reports add column if not exists retro_ai_summary text;
alter table public.service_reports add column if not exists checklist_done integer;
alter table public.service_reports add column if not exists checklist_total integer;
alter table public.service_reports add column if not exists checklist_missed_items text;
alter table public.service_reports add column if not exists photo_ai_score numeric;
alter table public.service_reports add column if not exists photo_ai_approved boolean;
alter table public.service_reports add column if not exists photo_ai_issues text;
alter table public.service_reports add column if not exists signature_url text;
alter table public.service_reports add column if not exists job_value numeric;
-- O app grava horários formatados ("09:30" ou "—"): guardar como texto (a tabela está vazia).
alter table public.service_reports alter column time_in type text using time_in::text;
alter table public.service_reports alter column time_out type text using time_out::text;
create unique index if not exists service_reports_job_id_key on public.service_reports(job_id) where job_id is not null;

-- Recibos (Ryoshu.jsx) lista por issue_date e grava estes campos.
alter table public.ryoshu add column if not exists client_id uuid;
alter table public.ryoshu add column if not exists client_name text;
alter table public.ryoshu add column if not exists amount numeric;
alter table public.ryoshu add column if not exists total_amount numeric;
alter table public.ryoshu add column if not exists tax_rate integer;
alter table public.ryoshu add column if not exists description text;
alter table public.ryoshu add column if not exists issue_date date;
alter table public.ryoshu add column if not exists status text default 'issued';
