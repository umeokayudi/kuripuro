-- v1.0.98 Fechar job manualmente no Live Track (2026-10-29)
-- Só ADICIONA 3 colunas na tabela jobs; nada é apagado nem alterado nos dados existentes.
-- Para que serve: guardar o carimbo de auditoria quando o admin fecha um job que o funcionário
-- esqueceu de finalizar ("fechado manualmente por <admin> em <data/hora>, motivo: ...").
-- O carimbo aparece na Agenda do Dia e no Reports.
-- Sem este SQL o botão "Fechar manualmente" já funciona (o job fecha como concluído, com a duração
-- certa, e o funcionário recebe a mensagem), mas o carimbo não fica gravado no job.
-- O histórico detalhado (job_admin_log, action = 'manual_close') vem do SQL 2026-10-29_agenda_do_dia.sql.

alter table public.jobs add column if not exists closed_manually_by text;          -- nome do admin
alter table public.jobs add column if not exists closed_manually_at timestamptz;   -- quando fechou
alter table public.jobs add column if not exists closed_manually_note text;        -- motivo (vazio = esquecimento de finalizar)
