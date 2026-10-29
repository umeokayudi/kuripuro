-- v1.0.102 · OPCIONAL (precisa do OK do dono). Só ADICIONA índices; não apaga nem muda dados.
-- Para que serve: deixa a busca global ("Kodama") e as telas de jobs mais rápidas.
-- O app já funciona sem isto (a busca nova não depende destes índices).
create extension if not exists pg_trgm;
create index if not exists jobs_title_trgm_idx on public.jobs using gin (title gin_trgm_ops);
create index if not exists jobs_scheduled_date_idx on public.jobs (scheduled_date);
create index if not exists jobs_employee_date_idx on public.jobs (employee_id, scheduled_date);
create index if not exists jobs_client_date_idx on public.jobs (client_id, scheduled_date);
create index if not exists clients_company_trgm_idx on public.clients using gin (company_name gin_trgm_ops);
