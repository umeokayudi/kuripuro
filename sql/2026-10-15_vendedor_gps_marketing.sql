-- v1.0.45: seller portal + marketing portal.
-- Safe to run more than once. Nothing is deleted or rewritten.

-- 1) Where each new lead was registered (GPS from the seller's phone) and the
--    Google Maps link the seller pastes for the shop.
alter table public.sales_leads add column if not exists gps_lat double precision;
alter table public.sales_leads add column if not exists gps_lng double precision;
alter table public.sales_leads add column if not exists gps_accuracy real;
alter table public.sales_leads add column if not exists gps_captured_at timestamptz;
alter table public.sales_leads add column if not exists maps_url text;

-- 2) Sales logins can be "sales" (seller portal) or "marketing" (marketing portal).
--    Every existing login stays "sales".
alter table public.salespeople add column if not exists team text not null default 'sales';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'salespeople_team_check') then
    alter table public.salespeople add constraint salespeople_team_check check (team in ('sales', 'marketing'));
  end if;
end $$;

-- Undo (only if needed):
-- alter table public.sales_leads drop column gps_lat, drop column gps_lng, drop column gps_accuracy, drop column gps_captured_at, drop column maps_url;
-- alter table public.salespeople drop constraint salespeople_team_check, drop column team;
