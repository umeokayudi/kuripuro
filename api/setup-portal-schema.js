// Cria tabelas do portal do cliente no Supabase (DDL)
// Requer SUPABASE_DB_URL na Vercel (Settings → Database → Connection string URI)

import { requireAdminSecretStrict } from './_auth.js'

const STATEMENTS = [
  `create table if not exists client_users (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete cascade not null,
    client_name text,
    location_name text,
    contact_name text not null,
    email text not null unique,
    password text not null,
    is_active boolean default true,
    last_seen timestamptz,
    created_at timestamptz default now()
  )`,
  `create table if not exists client_messages (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete cascade not null,
    client_user_id uuid references client_users(id) on delete set null,
    client_name text,
    location_name text,
    sender text not null check (sender in ('admin', 'client')),
    content text not null,
    read boolean default false,
    created_at timestamptz default now()
  )`,
  `create table if not exists client_complaints (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete cascade not null,
    client_user_id uuid references client_users(id) on delete set null,
    job_id uuid,
    location_name text,
    employee_name text,
    category text default 'quality',
    description text not null,
    status text default 'open',
    admin_response text,
    created_at timestamptz default now(),
    resolved_at timestamptz
  )`,
  `create table if not exists client_requests (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete cascade not null,
    client_user_id uuid references client_users(id) on delete set null,
    location_name text,
    description text not null,
    preferred_date date,
    status text default 'pending',
    admin_notes text,
    ticket_number text,
    created_at timestamptz default now(),
    completed_at timestamptz
  )`,
  `create table if not exists client_ratings (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete cascade not null,
    client_user_id uuid references client_users(id) on delete set null,
    job_id uuid not null,
    employee_name text,
    location_name text,
    stars integer not null check (stars between 1 and 5),
    comment text,
    created_at timestamptz default now(),
    unique(job_id)
  )`,
  `create table if not exists client_compliments (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete cascade not null,
    client_user_id uuid references client_users(id) on delete set null,
    job_id uuid,
    location_name text,
    employee_name text,
    message text not null,
    status text default 'new' check (status in ('new', 'read', 'archived')),
    admin_response text,
    created_at timestamptz default now(),
    resolved_at timestamptz
  )`,
  `alter table client_complaints add column if not exists photo_url text`,
  `alter table client_ratings add column if not exists photo_url text`,
  `alter table service_reports add column if not exists client_id uuid references clients(id)`,
  `alter table service_reports add column if not exists location_name text`,
  `alter table service_reports add column if not exists photo_comment text`,
  `alter table service_contracts add column if not exists training_video_url text`,
  `alter table service_contracts add column if not exists training_checklist text`,
  `alter table client_users enable row level security`,
  `alter table client_messages enable row level security`,
  `alter table client_complaints enable row level security`,
  `alter table client_requests enable row level security`,
  `alter table client_ratings enable row level security`,
  `alter table client_compliments enable row level security`,
  `drop policy if exists "allow_all_client_users" on client_users`,
  `create policy "allow_all_client_users" on client_users for all using (true)`,
  `drop policy if exists "allow_all_client_messages" on client_messages`,
  `create policy "allow_all_client_messages" on client_messages for all using (true)`,
  `drop policy if exists "allow_all_client_complaints" on client_complaints`,
  `create policy "allow_all_client_complaints" on client_complaints for all using (true)`,
  `drop policy if exists "allow_all_client_requests" on client_requests`,
  `create policy "allow_all_client_requests" on client_requests for all using (true)`,
  `drop policy if exists "allow_all_client_ratings" on client_ratings`,
  `create policy "allow_all_client_ratings" on client_ratings for all using (true)`,
  `drop policy if exists "allow_all_client_compliments" on client_compliments`,
  `create policy "allow_all_client_compliments" on client_compliments for all using (true)`,
  `create index if not exists idx_client_messages_client on client_messages(client_id, created_at)`,
  `create index if not exists idx_client_complaints_client on client_complaints(client_id, created_at desc)`,
  `create index if not exists idx_client_requests_client on client_requests(client_id, created_at desc)`,
  `create index if not exists idx_client_ratings_client on client_ratings(client_id, created_at desc)`,
  `create index if not exists idx_jobs_client_date on jobs(client_id, scheduled_date)`,
  `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
   values ('service-photos', 'service-photos', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
   on conflict (id) do update set public = true`,
  `drop policy if exists "service_photos_select" on storage.objects`,
  `create policy "service_photos_select" on storage.objects for select to anon, authenticated using (bucket_id = 'service-photos')`,
  `drop policy if exists "service_photos_insert" on storage.objects`,
  `create policy "service_photos_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'service-photos')`,
  `drop policy if exists "service_photos_update" on storage.objects`,
  `create policy "service_photos_update" on storage.objects for update to anon, authenticated using (bucket_id = 'service-photos')`,
  `drop policy if exists "service_photos_delete" on storage.objects`,
  `create policy "service_photos_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'service-photos')`,
  `create table if not exists equipment_requests (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid references employees(id) on delete cascade,
    employee_name text,
    category text default 'other',
    item_name text not null,
    quantity integer default 1,
    reason text not null,
    photo_url text,
    status text default 'pending',
    admin_note text,
    reviewed_at timestamptz,
    fulfilled_at timestamptz,
    created_at timestamptz default now()
  )`,
  `alter table equipment_requests enable row level security`,
  `drop policy if exists "allow_all_equipment_requests" on equipment_requests`,
  `create policy "allow_all_equipment_requests" on equipment_requests for all using (true)`,
  `create index if not exists idx_equipment_requests_employee on equipment_requests(employee_id, created_at desc)`,
  `create table if not exists public.sales_leads (
    id uuid primary key default gen_random_uuid(),
    stage text not null default 'approach',
    company_name text not null,
    company_kana text,
    address text,
    phone text,
    email text,
    website text,
    industry text,
    locations_count integer,
    contact_name text,
    contact_title text,
    contact_phone text,
    contact_email text,
    contact_line_id text,
    first_contact_date date,
    last_contact_date date,
    next_followup_date date,
    source text,
    needs text,
    still_needed text,
    decision_maker text,
    expected_monthly numeric(12,2),
    expected_start date,
    competitor text,
    notes text,
    lost_reason text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`,
  `alter table public.sales_leads enable row level security`,
  `drop policy if exists "allow_all_sales_leads" on public.sales_leads`,
  `create policy "allow_all_sales_leads" on public.sales_leads for all using (true)`,
  `grant all on table public.sales_leads to anon, authenticated, service_role`,
  `create table if not exists public.mitsumori (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.sales_leads(id) on delete set null,
    quote_number text unique,
    company_name text not null,
    company_kana text,
    address text,
    phone text,
    email text,
    contact_name text,
    contact_title text,
    contact_phone text,
    contact_email text,
    first_contact_date date,
    needs text,
    still_needed text,
    source text,
    notes text,
    issue_date date,
    valid_until date,
    site_visit_date date,
    expected_start date,
    frequency text,
    hours_per_visit numeric(6,2),
    tax_rate integer default 10,
    subtotal numeric(12,2) default 0,
    tax_amount numeric(12,2) default 0,
    total numeric(12,2) default 0,
    status text default 'draft',
    created_at timestamptz default now()
  )`,
  `alter table public.mitsumori enable row level security`,
  `drop policy if exists "allow_all_mitsumori" on public.mitsumori`,
  `create policy "allow_all_mitsumori" on public.mitsumori for all using (true)`,
  `grant all on table public.mitsumori to anon, authenticated, service_role`,
  `create table if not exists public.mitsumori_items (
    id uuid primary key default gen_random_uuid(),
    mitsumori_id uuid references public.mitsumori(id) on delete cascade,
    description text,
    quantity numeric(10,2) default 1,
    unit_price numeric(12,2) default 0,
    total numeric(12,2) default 0
  )`,
  `alter table public.mitsumori_items enable row level security`,
  `drop policy if exists "allow_all_mitsumori_items" on public.mitsumori_items`,
  `create policy "allow_all_mitsumori_items" on public.mitsumori_items for all using (true)`,
  `grant all on table public.mitsumori_items to anon, authenticated, service_role`,
  `create index if not exists sales_leads_stage_idx on public.sales_leads (stage, next_followup_date)`,
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  if (!requireAdminSecretStrict(req, res)) return

  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  if (!dbUrl) {
    return res.status(503).json({
      error: 'SUPABASE_DB_URL not configured',
      hint: 'Add your Supabase connection string (URI) to Vercel env vars, or run setup-portal-all.sql in Supabase SQL Editor',
      sqlFile: 'setup-portal-all.sql',
      sqlEditor: 'https://supabase.com/dashboard/project/fxsakrshmldmkdmbevna/sql/new',
    })
  }

  let sql
  try {
    const mod = await import('postgres')
    const postgres = mod.default || mod
    sql = postgres(dbUrl, { ssl: 'require', max: 1 })
    for (const statement of STATEMENTS) {
      await sql.unsafe(statement)
    }
    await sql.end({ timeout: 5 })
    return res.status(200).json({ ok: true, message: 'Portal + storage configurados com sucesso' })
  } catch (err) {
    if (sql) {
      try { await sql.end({ timeout: 1 }) } catch {}
    }
    return res.status(500).json({ error: err.message || 'Migration failed' })
  }
}
