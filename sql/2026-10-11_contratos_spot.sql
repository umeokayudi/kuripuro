-- v1.0.21 · Contrato spot: every spot job created in Jobs → New Job gets a stored contract
-- with the location (who, where, when, what, price, terms, signature).
-- Additive only: new table, nothing existing changes. Same open policy as service_contracts/jobs.
-- Applied on 2026-10-11 to project fxsakrshmldmkdmbevna.

create table if not exists public.spot_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text unique,
  job_id uuid references public.jobs(id) on delete set null,
  client_id uuid,
  client_name text,
  location_id uuid,
  location_name text not null,
  location_address text,
  contact_name text,
  contact_phone text,
  service_type text,
  service_date date,
  service_time text,
  employee_id uuid,
  employee_name text,
  price numeric not null default 0,           -- what the location pays
  tax_rate integer not null default 10,
  price_includes_tax boolean not null default true,
  employee_pay numeric not null default 0,    -- spot value paid to the worker
  scope text,
  terms text,
  notes text,
  status text not null default 'draft',       -- draft | signed | cancelled
  signed_by text,
  signature_url text,
  signed_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spot_contracts_job_idx on public.spot_contracts (job_id);
create index if not exists spot_contracts_date_idx on public.spot_contracts (service_date desc);

-- Readable number: SPOT-20261011-0001
create sequence if not exists public.spot_contract_seq;
create or replace function public.spot_contracts_fill() returns trigger
language plpgsql as $$
begin
  if new.contract_number is null or new.contract_number = '' then
    new.contract_number := 'SPOT-' || to_char(coalesce(new.service_date, current_date), 'YYYYMMDD')
      || '-' || lpad(nextval('public.spot_contract_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace trigger spot_contracts_fill before insert or update on public.spot_contracts
  for each row execute function public.spot_contracts_fill();

alter table public.spot_contracts enable row level security;
create policy allow_all_spot_contracts on public.spot_contracts for all using (true);
