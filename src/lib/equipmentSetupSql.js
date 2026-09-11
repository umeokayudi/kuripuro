/** Run in Supabase SQL Editor to create equipment_requests */
export const EQUIPMENT_SETUP_SQL = `
create table if not exists equipment_requests (
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
);

alter table equipment_requests enable row level security;
drop policy if exists "allow_all_equipment_requests" on equipment_requests;
create policy "allow_all_equipment_requests" on equipment_requests for all using (true);
create index if not exists idx_equipment_requests_employee on equipment_requests(employee_id, created_at desc);
`.trim()
