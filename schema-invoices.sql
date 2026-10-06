-- Invoice numbers for 請求書 (safe to re-run)
alter table if exists faturas
  add column if not exists invoice_number text;

create unique index if not exists faturas_invoice_number_uidx
  on faturas (invoice_number)
  where invoice_number is not null;
