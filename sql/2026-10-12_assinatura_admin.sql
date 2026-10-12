-- v1.0.29: admin's own signature for the "Admin Signature" line of the day report PDF.
-- Additive and safe to re-run. Until this runs, the app keeps the signature on the admin's device only.
alter table public.admins add column if not exists signature_url text;
