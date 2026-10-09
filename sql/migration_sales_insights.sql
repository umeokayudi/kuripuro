-- Sales insights + media KPIs (v1.0.11). Additive only, safe to re-run.
-- Stores what the client answered, the objection, the region and the quote decision,
-- and platform numbers (impressions / clicks / conversions) per ad-spend entry,
-- so the dashboards and the AI can explain why deals close or not.

-- What the client said on each contact, tagged so the most common answers can be counted.
alter table public.sales_touchpoints add column if not exists client_response text;
alter table public.sales_touchpoints add column if not exists response_tag text;
alter table public.sales_touchpoints add column if not exists sentiment text;
create index if not exists sales_touchpoints_response_tag_idx on public.sales_touchpoints (response_tag) where response_tag is not null;

-- Region of the client (prefecture / city). Filled from the address when left blank.
alter table public.sales_leads add column if not exists region text;
update public.sales_leads
   set region = substring(address from '(東京都|北海道|(?:京都|大阪)府|[^\s0-9０-９]{2,3}県)')
 where region is null and address is not null
   and substring(address from '(東京都|北海道|(?:京都|大阪)府|[^\s0-9０-９]{2,3}県)') is not null;

-- When a quote was sent and decided, and why.
alter table public.mitsumori add column if not exists sent_at timestamptz;
alter table public.mitsumori add column if not exists decided_at timestamptz;
alter table public.mitsumori add column if not exists decision_reason text;

create or replace function public.mitsumori_status_dates()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
  if new.status in ('accepted', 'declined') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.decided_at := now();
    if new.sent_at is null then new.sent_at := coalesce(new.created_at, now()); end if;
  end if;
  if new.status not in ('accepted', 'declined', 'expired') then new.decided_at := null; end if;
  return new;
end $$;

create or replace trigger mitsumori_status_dates before insert or update of status on public.mitsumori
  for each row execute function public.mitsumori_status_dates();

update public.mitsumori set sent_at = coalesce(sent_at, created_at) where status in ('sent', 'accepted', 'declined', 'expired') and sent_at is null;
update public.mitsumori set decided_at = coalesce(decided_at, created_at) where status in ('accepted', 'declined') and decided_at is null;

-- Platform numbers per spend entry, for CPM / CPC / CTR / CPA.
alter table public.marketing_spend add column if not exists impressions bigint;
alter table public.marketing_spend add column if not exists clicks integer;
alter table public.marketing_spend add column if not exists conversions integer;

-- One row per quote with everything the AI needs: seller, region, stage, timing, price per item, outcome.
create or replace view public.sales_ai_dataset with (security_invoker = true) as
select
  q.id as quote_id, q.quote_number, q.salesperson_id, s.full_name as salesperson,
  l.id as lead_id, coalesce(l.company_name, q.company_name) as company_name, l.industry, l.region, l.source,
  l.stage, l.lost_reason, l.competitor, l.first_contact_date, l.closed_at,
  q.status as quote_status, q.created_at as quote_created_at, q.sent_at, q.decided_at, q.decision_reason,
  q.total, q.subtotal, q.frequency, q.hours_per_visit,
  (select count(*) from public.mitsumori_items i where i.mitsumori_id = q.id) as item_count,
  (select avg(i.unit_price) from public.mitsumori_items i where i.mitsumori_id = q.id) as avg_unit_price,
  extract(day from coalesce(q.decided_at, now()) - coalesce(q.sent_at, q.created_at))::int as days_to_decision,
  (select count(*) from public.sales_touchpoints t where t.lead_id = l.id) as contacts,
  (select string_agg(distinct t.response_tag, ',') from public.sales_touchpoints t where t.lead_id = l.id and t.response_tag is not null) as response_tags
from public.mitsumori q
left join public.sales_leads l on l.id = q.lead_id
left join public.salespeople s on s.id = q.salesperson_id;

-- Run in the SQL Editor (the MCP cannot confirm revokes): keeps the view server-only.
-- revoke all on public.sales_ai_dataset from anon, authenticated;

-- Seller work day: start/end, where, and the automatic end-of-day report.
alter table public.sales_day_reports add column if not exists ai_report text;
alter table public.sales_day_reports add column if not exists day_stats jsonb;
alter table public.sales_day_reports add column if not exists start_location text;
alter table public.sales_day_reports add column if not exists end_location text;
alter table public.sales_day_reports add column if not exists closed_at timestamptz;
-- Messages from the admin to sellers / managers, and when a lead was handed to a seller.
alter table public.sales_notifications add column if not exists sender_name text;
alter table public.sales_leads add column if not exists assigned_at timestamptz;
