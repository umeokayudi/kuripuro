-- Contract billing terms and invoice audit fields
alter table public.service_contracts add column if not exists billing_type text not null default 'per_visit';
alter table public.service_contracts add column if not exists fixed_monthly numeric not null default 0;
alter table public.service_contracts add column if not exists discount_percent numeric not null default 0;
alter table public.service_contracts add column if not exists billing_day integer;
alter table public.service_contracts add column if not exists billing_notes text;

alter table public.fatura_items add column if not exists contract_id uuid;
alter table public.fatura_items add column if not exists discount_percent numeric not null default 0;
alter table public.fatura_items add column if not exists discount_amount numeric not null default 0;
alter table public.fatura_items add column if not exists job_ids text;
