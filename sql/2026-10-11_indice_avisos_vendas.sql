-- 2026-10-11 (v1.0.19) — aplicado no Supabase em 2026-10-11.
-- O índice único antigo de sales_notifications.dedupe_key é parcial (WHERE dedupe_key IS NOT NULL),
-- e o upsert com onConflict 'dedupe_key' (api/_sales-reminders.js) falhava com 42P10.
-- Um índice único completo resolve; valores nulos continuam permitidos várias vezes.
create unique index if not exists sales_notifications_dedupe_key_uniq
  on public.sales_notifications (dedupe_key);
