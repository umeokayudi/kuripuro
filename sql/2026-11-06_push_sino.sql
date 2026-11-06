-- v1.0.171 · Todos os avisos do sino (🔔 Aguardando você) viram notificação push para os admins.
-- Rodar DEPOIS de sql/2026-10-25_push_notificacoes.sql. Pode rodar de novo (cron.schedule com o mesmo nome substitui o agendamento).
-- A cada 5 minutos o banco chama /api/push?op=bell; o servidor monta o mesmo sino do admin e
-- manda cada item novo uma vez só (push_log 'bell:<id>'). Primeira vez ou 5+ novos juntos = 1 resumo.
-- Troque <PUSH_BELL_SECRET> pelo mesmo valor da variável PUSH_BELL_SECRET na Vercel.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('kp_push_bell', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://kuripuro.vercel.app/api/push?op=bell',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', '<PUSH_BELL_SECRET>'),
    timeout_milliseconds := 55000
  );
$job$);

-- Para DESLIGAR só o sino:  select cron.unschedule('kp_push_bell');
