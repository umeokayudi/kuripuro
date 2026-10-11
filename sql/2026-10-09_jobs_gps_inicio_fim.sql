-- v1.0.7: where the worker was when they started and finished each job.
-- Applied to Supabase on 2026-10-09. Safe to run again.
alter table public.jobs
  add column if not exists start_lat numeric,
  add column if not exists start_lng numeric,
  add column if not exists start_accuracy integer,
  add column if not exists end_lat numeric,
  add column if not exists end_lng numeric,
  add column if not exists end_accuracy integer;
