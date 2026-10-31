-- v1.0.126 — Portal language per employee, chosen by the admin (Employees → card → Portal language).
-- true  = portal always in Portuguese, no language switcher
-- false = employee chooses English or Japanese (no Portuguese)
-- Only adds one column; nothing is deleted.
alter table public.employees
  add column if not exists speaks_portuguese boolean not null default false;

-- Starts with the four people who already open the portal in Portuguese.
update public.employees set speaks_portuguese = true
 where id in (
  '4c064fb5-e39d-4086-a798-f6e670730bac', -- Alexandre
  'b62cc1a1-9750-4dbd-8f03-8a4c4aa4d86c', -- Gabriel
  '8772f25f-7bd2-460d-8818-ad3bad3ab541', -- Guilherme
  '3a39b220-9984-41e4-ab61-4cf96b93a99f'  -- Letícia
 );
