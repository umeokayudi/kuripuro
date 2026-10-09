-- KuriPuro sales workflow additions.
-- Review and apply manually after the application branch is approved.
-- This file is intentionally not executed against Supabase.

alter table public.sales_leads
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null;

alter table public.mitsumori
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null;

alter table public.sales_leads
  add column if not exists marketing_channel_id uuid,
  add column if not exists marketing_campaign_id uuid,
  add column if not exists business_card_object_path text;

alter table public.sales_field_approaches
  add column if not exists lead_id uuid references public.sales_leads(id) on delete set null,
  add column if not exists travel_cost numeric(12,2) not null default 0 check (travel_cost >= 0),
  add column if not exists duration_minutes integer not null default 0 check (duration_minutes >= 0),
  add column if not exists hours_spent numeric(6,2) not null default 0 check (hours_spent >= 0),
  add column if not exists meeting_transcript text,
  add column if not exists meeting_summary text,
  add column if not exists ai_next_step text,
  add column if not exists audio_object_path text;

alter table public.sales_day_reports
  add column if not exists travel_cost numeric(12,2) not null default 0 check (travel_cost >= 0);

create table if not exists public.sales_commission_rules (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null unique references public.salespeople(id) on delete cascade,
  commission_type text not null check (commission_type in ('percent', 'fixed')),
  commission_value numeric(12,2) not null default 0 check (commission_value >= 0),
  percent_basis text not null default 'base_monthly' check (percent_basis in ('base_monthly', 'contract_total')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_contract_submissions (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.salespeople(id) on delete restrict,
  lead_id uuid not null references public.sales_leads(id) on delete restrict,
  quote_id uuid references public.mitsumori(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'changes_requested', 'active', 'rejected')),
  company_name text not null,
  site_name text not null,
  address text,
  contact_name text,
  service_type text not null default 'Basic Cleaning',
  billing_type text not null default 'fixed_monthly' check (billing_type in ('fixed_monthly', 'per_visit')),
  base_monthly_amount numeric(12,2) not null check (base_monthly_amount >= 0),
  commission_type text not null check (commission_type in ('percent', 'fixed')),
  commission_value numeric(12,2) not null check (commission_value >= 0),
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  client_monthly_total numeric(12,2) not null check (client_monthly_total >= base_monthly_amount),
  price_per_visit numeric(12,2) not null default 0 check (price_per_visit >= 0),
  visits_per_month integer not null default 0 check (visits_per_month >= 0),
  hours_per_visit numeric(6,2) not null default 2 check (hours_per_visit >= 0),
  days_of_week text[] not null default '{}',
  billing_day integer not null default 10 check (billing_day between 1 and 28),
  tax_rate integer not null default 10 check (tax_rate between 0 and 100),
  signed_pdf_object_path text,
  signed_pdf_name text,
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  service_contract_id uuid references public.service_contracts(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signed_pdf_required_before_review check (status in ('draft', 'changes_requested') or signed_pdf_object_path is not null)
);

create table if not exists public.sales_notifications (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid references public.salespeople(id) on delete cascade,
  audience text not null check (audience in ('seller', 'admin')),
  event_type text not null,
  title text not null,
  body text not null default '',
  lead_id uuid references public.sales_leads(id) on delete cascade,
  contract_submission_id uuid references public.sales_contract_submissions(id) on delete cascade,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_audience_owner check ((audience = 'seller' and salesperson_id is not null) or audience = 'admin')
);
alter table public.sales_notifications add column if not exists dedupe_key text;

create table if not exists public.marketing_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  channel_type text not null check (channel_type in ('paid_ads', 'organic_social', 'referral', 'website', 'event', 'outbound', 'other')),
  platform text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.marketing_channels(id) on delete restrict,
  name text not null,
  objective text not null default '',
  budget numeric(12,2) not null default 0 check (budget >= 0),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  spent_on date not null default current_date,
  amount numeric(12,2) not null check (amount >= 0),
  description text not null default '',
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.sales_leads add constraint sales_leads_marketing_channel_fkey foreign key (marketing_channel_id) references public.marketing_channels(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sales_leads add constraint sales_leads_marketing_campaign_fkey foreign key (marketing_campaign_id) references public.marketing_campaigns(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists sales_leads_salesperson_followup_idx
  on public.sales_leads (salesperson_id, next_followup_date) where stage not in ('won', 'lost');
create index if not exists sales_approaches_salesperson_date_idx
  on public.sales_field_approaches (salesperson_id, work_date desc);
create index if not exists sales_contracts_review_queue_idx
  on public.sales_contract_submissions (status, submitted_at desc);
create unique index if not exists sales_day_reports_seller_date_unique_idx
  on public.sales_day_reports (salesperson_id, work_date);
create index if not exists sales_notifications_audience_date_idx
  on public.sales_notifications (audience, salesperson_id, created_at desc);
create unique index if not exists sales_notifications_dedupe_key_idx
  on public.sales_notifications (dedupe_key) where dedupe_key is not null;

alter table public.sales_commission_rules enable row level security;
alter table public.sales_contract_submissions enable row level security;
alter table public.sales_notifications enable row level security;
alter table public.marketing_channels enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_spend enable row level security;

-- These records are read/written only by the authenticated server API using its
-- server-side service key. No anonymous or browser role is granted table access.
revoke all on public.sales_commission_rules from anon, authenticated;
revoke all on public.sales_contract_submissions from anon, authenticated;
revoke all on public.sales_notifications from anon, authenticated;
revoke all on public.marketing_channels from anon, authenticated;
revoke all on public.marketing_campaigns from anon, authenticated;
revoke all on public.marketing_spend from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-private', 'sales-private', false, 20971520, array['application/pdf','image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/mpeg','audio/wav'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/mpeg','audio/wav'];

-- The private bucket deliberately has no anon/authenticated policies. The API
-- validates seller/admin sessions and accesses objects server-side.
