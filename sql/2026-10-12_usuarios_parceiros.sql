-- v1.0.35 · Users area, employee role (função) and business partners.
-- Additive only: one new column on employees and one new table. Safe to run twice.

-- Employee role shown as a badge (Employees list, profile, Users area).
-- Holds a preset key (cleaner, leader, supervisor, driver, trainee, office) or free text.
alter table public.employees add column if not exists job_role text;

-- Business partners (parceiros de negócio): suppliers, subcontractors, referrers...
create table if not exists public.business_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'other',
  contact_name text,
  phone text,
  email text,
  website text,
  address text,
  commission_rate numeric,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_partners_category_idx on public.business_partners (category);

-- Same access model as the other admin tables today (see the security notes in the audit).
alter table public.business_partners enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'allow_all_business_partners') then
    create policy allow_all_business_partners on public.business_partners for all using (true) with check (true);
  end if;
end $$;
