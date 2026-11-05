-- v1.0.156 "Já fiz" — registrar serviço esquecido (2026-11-05)
-- Só ADICIONA 3 colunas na tabela jobs; nada é apagado nem alterado nos dados existentes.
-- Para que serve: gravar no próprio job QUEM registrou pelo "Já fiz", com que papel (funcionário/admin)
-- e QUANDO registrou. As horas informadas já ficam em started_at / completed_at / retro_time_min.
-- Sem este SQL o "Já fiz" já funciona: o job fica concluído com o selo "Retroativo" e a auditoria
-- completa fica no arquivo service-photos/jobs/<id>/ja_fiz.json (lido pela ficha do Relatório).
-- Precisa do OK do Umeoka antes de rodar.

alter table public.jobs add column if not exists retro_registered_by text;          -- nome de quem registrou
alter table public.jobs add column if not exists retro_registered_role text;        -- 'employee' | 'admin'
alter table public.jobs add column if not exists retro_registered_at timestamptz;   -- quando registrou
