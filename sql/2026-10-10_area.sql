-- v1.0.14 · "Área" = area/zone of the serviced location (e.g. Shibuya, Shinbashi).
-- Set on the location (service_contracts.area); every job of that location gets it (jobs.area)
-- so jobs can be grouped/filtered by area and employees routed by zone.
-- Applied on 2026-10-10 to project fxsakrshmldmkdmbevna.

alter table public.service_contracts add column if not exists area text;
alter table public.jobs add column if not exists area text;
create index if not exists jobs_area_date_idx on public.jobs (area, scheduled_date);

-- Base business name of a contract/job title: "Ibushio — AC Cleaning" / "Ibushio - Deep Clean" -> "Ibushio"
create or replace function public.kp_base_location(name text) returns text
language sql immutable as $$
  select trim(regexp_replace(split_part(coalesce(name, ''), ' — ', 1), '\s+-\s+Deep Clean$', '', 'i'))
$$;

-- New jobs inherit the area of their location
create or replace function public.jobs_fill_area() returns trigger
language plpgsql as $$
begin
  if new.area is null or new.area = '' then
    select sc.area into new.area
      from public.service_contracts sc
     where sc.area is not null and sc.area <> ''
       and public.kp_base_location(sc.location_name) = public.kp_base_location(new.title)
     order by (sc.client_id is not distinct from new.client_id) desc, sc.is_active desc nulls last
     limit 1;
  end if;
  return new;
end $$;

create or replace trigger jobs_fill_area before insert on public.jobs
  for each row execute function public.jobs_fill_area();

-- Changing the area of a location updates its sibling contracts and its jobs (past and future)
create or replace function public.service_contracts_propagate_area() returns trigger
language plpgsql as $$
begin
  if new.area is distinct from old.area then
    update public.service_contracts
       set area = new.area
     where id <> new.id
       and public.kp_base_location(location_name) = public.kp_base_location(new.location_name)
       and area is distinct from new.area;
    update public.jobs
       set area = nullif(new.area, '')
     where public.kp_base_location(title) = public.kp_base_location(new.location_name)
       and area is distinct from nullif(new.area, '');
  end if;
  return new;
end $$;

create or replace trigger service_contracts_propagate_area after update of area on public.service_contracts
  for each row when (pg_trigger_depth() < 1) execute function public.service_contracts_propagate_area();

-- Same when a location is created with an area
create or replace function public.service_contracts_area_on_insert() returns trigger
language plpgsql as $$
begin
  if coalesce(new.area, '') <> '' then
    update public.jobs set area = new.area
     where public.kp_base_location(title) = public.kp_base_location(new.location_name) and area is null;
  end if;
  return new;
end $$;

create or replace trigger service_contracts_area_on_insert after insert on public.service_contracts
  for each row execute function public.service_contracts_area_on_insert();
