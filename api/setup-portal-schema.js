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
  `create table if not exists employee_contracts (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid references employees(id) on delete cascade,
    employee_name text,
    pdf_url text,
    file_name text,
    extracted_json jsonb,
    retroactive_allowed boolean default false,
    extraction_status text default 'pending',
    applied_at timestamptz,
    uploaded_at timestamptz default now()
  )`,
  `create table if not exists salary_periods (
    id uuid primary key default gen_random_uuid(),
    period text not null unique,
    closed_at timestamptz,
    confirm_deadline date,
    pay_date date,
    status text default 'open'
  )`,
  `create table if not exists salary_statements (
    id uuid primary key default gen_random_uuid(),
    period text not null,
    employee_id uuid references employees(id) on delete cascade,
    employee_name text,
    base_salary numeric(12,2) default 0,
    deductions numeric(12,2) default 0,
    bonuses numeric(12,2) default 0,
    net_total numeric(12,2) default 0,
    breakdown jsonb,
    status text default 'pending',
    employee_confirmed_at timestamptz,
    employee_disputed_at timestamptz,
    admin_finalized_at timestamptz,
    created_at timestamptz default now(),
    unique(period, employee_id)
  )`,
  `create table if not exists salary_complaints (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid references employees(id) on delete cascade,
    employee_name text,
    period text not null,
    statement_id uuid references salary_statements(id),
    category text,
    description text not null,
    attachment_url text,
    status text default 'pending',
    admin_response text,
    resolved_at timestamptz,
    created_at timestamptz default now()
  )`,
  `create table if not exists salary_payments (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid references employees(id) on delete cascade,
    employee_name text,
    amount numeric(12,2) not null,
    payment_date date,
    description text,
    status text default 'scheduled',
    payment_type text default 'salary',
    is_deduction boolean default false,
    period text,
    job_id uuid,
    notes text,
    received_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`,
  `alter table employee_contracts enable row level security`,
  `alter table salary_periods enable row level security`,
  `alter table salary_statements enable row level security`,
  `alter table salary_complaints enable row level security`,
  `drop policy if exists "allow_all_employee_contracts" on employee_contracts`,
  `create policy "allow_all_employee_contracts" on employee_contracts for all using (true)`,
  `drop policy if exists "allow_all_salary_periods" on salary_periods`,
  `create policy "allow_all_salary_periods" on salary_periods for all using (true)`,
  `drop policy if exists "allow_all_salary_statements" on salary_statements`,
  `create policy "allow_all_salary_statements" on salary_statements for all using (true)`,
  `drop policy if exists "allow_all_salary_complaints" on salary_complaints`,
  `create policy "allow_all_salary_complaints" on salary_complaints for all using (true)`,
  `create unique index if not exists salary_payments_one_salary_per_period
    on salary_payments (employee_id, period)
    where payment_type = 'salary' and coalesce(is_deduction, false) = false`,
  `alter table salary_payments drop constraint if exists salary_payments_payment_type_check`,
  `alter table salary_payments add constraint salary_payments_payment_type_check
    check (payment_type in ('salary','advance','bonus','deduction','extra','transport','other'))`,
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
