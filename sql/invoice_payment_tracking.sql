-- Invoice payment tracking
-- Keeps payment metadata on the invoice and links the generated cashflow entry.
alter table public.faturas
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists cashflow_id uuid;

create index if not exists idx_faturas_status_due_date
  on public.faturas(status, due_date);

create index if not exists idx_faturas_cashflow_id
  on public.faturas(cashflow_id);
